package com.signalone.hud.plugins.missionlink;

import android.content.Context;
import android.util.Log;

import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Google Nearby Connections — Bluetooth / Wi‑Fi Direct / LAN without manual pairing.
 * Exchanges mission bundles as byte payloads after a P2P link is established.
 */
public class HudMissionLinkNearby {
  private static final String TAG = "HudMissionLinkNearby";
  private static final String SERVICE_ID = "com.signalone.hud.missionlink";

  public interface PayloadListener {
    void onPayload(String joinCode, String payload, String endpointId, String transport);
  }

  private final Context context;
  private final PayloadListener listener;
  private ConnectionsClient client;
  private String joinCodeNorm = "";
  private String outboundPayload = "";
  private final AtomicBoolean advertising = new AtomicBoolean(false);
  private final AtomicBoolean discovering = new AtomicBoolean(false);

  public HudMissionLinkNearby(Context context, PayloadListener listener) {
    this.context = context.getApplicationContext();
    this.listener = listener;
    this.client = Nearby.getConnectionsClient(this.context);
  }

  private final PayloadCallback payloadCallback =
      new PayloadCallback() {
        @Override
        public void onPayloadReceived(String endpointId, Payload payload) {
          if (payload.getType() != Payload.Type.BYTES) return;
          byte[] bytes = payload.asBytes();
          if (bytes == null || bytes.length == 0) return;
          String text = new String(bytes, StandardCharsets.UTF_8).trim();
          if (text.isEmpty()) return;
          listener.onPayload(joinCodeNorm, text, endpointId, "nearby");
        }

        @Override
        public void onPayloadTransferUpdate(String endpointId, PayloadTransferUpdate update) {
          /* progress optional */
        }
      };

  private final ConnectionLifecycleCallback connectionLifecycle =
      new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(String endpointId, ConnectionInfo info) {
          client.acceptConnection(endpointId, payloadCallback);
        }

        @Override
        public void onConnectionResult(String endpointId, ConnectionResolution resolution) {
          if (!resolution.getStatus().isSuccess()) {
            Log.w(TAG, "connection failed " + resolution.getStatus());
            return;
          }
          if (!outboundPayload.isEmpty()) {
            sendBytes(endpointId, outboundPayload);
          }
        }

        @Override
        public void onDisconnected(String endpointId) {
          Log.d(TAG, "nearby disconnected " + endpointId);
        }
      };

  public void startAdvertising(String joinCode, String payload) {
    joinCodeNorm = normalize(joinCode);
    outboundPayload = payload != null ? payload : "";
    stopAll();
    advertising.set(true);
    String endpointName = "HUD-O-" + joinCodeNorm;
    AdvertisingOptions options =
        new AdvertisingOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build();
    client.startAdvertising(
        endpointName,
        SERVICE_ID,
        connectionLifecycle,
        options)
        .addOnSuccessListener(unused -> Log.d(TAG, "nearby advertising " + endpointName))
        .addOnFailureListener(e -> Log.w(TAG, "nearby advertise failed", e));
  }

  public void startDiscovery(String joinCode) {
    joinCodeNorm = normalize(joinCode);
    outboundPayload = "";
    stopDiscoveryOnly();
    discovering.set(true);
    DiscoveryOptions options =
        new DiscoveryOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build();
    client.startDiscovery(
        SERVICE_ID,
        new com.google.android.gms.nearby.connection.EndpointDiscoveryCallback() {
          @Override
          public void onEndpointFound(String endpointId, DiscoveredEndpointInfo info) {
            String name = info.getEndpointName();
            if (name == null) return;
            String norm = name.replace("-", "").toUpperCase();
            if (!norm.contains("HUD-O-" + joinCodeNorm) && !norm.endsWith(joinCodeNorm)) {
              return;
            }
            client.requestConnection(
                endpointId,
                SERVICE_ID,
                connectionLifecycle)
                .addOnFailureListener(e -> Log.w(TAG, "requestConnection failed", e));
          }

          @Override
          public void onEndpointLost(String endpointId) {
            /* ignore */
          }
        },
        options)
        .addOnSuccessListener(unused -> Log.d(TAG, "nearby discovery started"))
        .addOnFailureListener(e -> Log.w(TAG, "nearby discovery failed", e));
  }

  public void sendPayload(String endpointId, String payload) {
    if (endpointId == null || endpointId.isEmpty() || payload == null || payload.isEmpty()) return;
    sendBytes(endpointId, payload);
  }

  private void sendBytes(String endpointId, String payload) {
    byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
    client.sendPayload(endpointId, Payload.fromBytes(bytes))
        .addOnFailureListener(e -> Log.w(TAG, "sendPayload failed", e));
  }

  public void stopAll() {
    stopDiscoveryOnly();
    stopAdvertisingOnly();
    try {
      client.stopAllEndpoints();
    } catch (Exception e) {
      Log.w(TAG, "stopAllEndpoints", e);
    }
  }

  public void stopAdvertising() {
    stopAdvertisingOnly();
  }

  public void stopDiscovery() {
    stopDiscoveryOnly();
  }

  private void stopAdvertisingOnly() {
    if (!advertising.getAndSet(false)) return;
    try {
      client.stopAdvertising();
    } catch (Exception e) {
      Log.w(TAG, "stopAdvertising", e);
    }
  }

  private void stopDiscoveryOnly() {
    if (!discovering.getAndSet(false)) return;
    try {
      client.stopDiscovery();
    } catch (Exception e) {
      Log.w(TAG, "stopDiscovery", e);
    }
  }

  private static String normalize(String joinCode) {
    return joinCode.replace("-", "").trim().toUpperCase();
  }
}
