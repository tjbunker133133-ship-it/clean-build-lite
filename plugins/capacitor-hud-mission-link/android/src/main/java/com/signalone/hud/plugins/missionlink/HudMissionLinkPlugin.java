package com.signalone.hud.plugins.missionlink;

import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "HudMissionLink")
public class HudMissionLinkPlugin extends Plugin {
  private static final String TAG = "HudMissionLink";
  private static final String SERVICE_TYPE = "_signalone-hud._tcp.";
  /** Joiner sends this byte first when fetching an offer (not an answer). */
  private static final byte FETCH_OFFER_BYTE = 'G';

  private final ExecutorService executor = Executors.newCachedThreadPool();
  private NsdManager nsdManager;
  private NsdManager.RegistrationListener registrationListener;
  private NsdManager.DiscoveryListener discoveryListener;
  private ServerSocket serverSocket;
  private int serverPort;
  private String advertisingPayload = "";
  private String advertisingJoinCode = "";
  private String discoveryJoinCode = "";
  private final AtomicBoolean discovering = new AtomicBoolean(false);
  private HudMissionLinkNearby nearby;

  @Override
  public void load() {
    super.load();
    nearby =
        new HudMissionLinkNearby(
            getContext(),
            (joinCode, payload, endpointId, transport) ->
                emitPayload(joinCode, payload, null, null, endpointId, transport));
  }

  @PluginMethod
  public void getPlatformInfo(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("available", true);
    ret.put("platform", "android");
    ret.put("discoveryMethod", "android-nsd-nearby");
    call.resolve(ret);
  }

  @PluginMethod
  public void startAdvertising(PluginCall call) {
    String joinCode = call.getString("joinCode", "");
    String payload = call.getString("payload", "");
    if (joinCode.isEmpty() || payload.isEmpty()) {
      call.reject("joinCode and payload required");
      return;
    }
    advertisingJoinCode = normalizeCode(joinCode);
    advertisingPayload = payload;
    stopAdvertisingInternal();
    executor.execute(
        () -> {
          try {
            serverSocket = new ServerSocket(0);
            serverPort = serverSocket.getLocalPort();
            registerNsdService(advertisingJoinCode);
            acceptLoop();
            if (nearby != null) {
              nearby.startAdvertising(advertisingJoinCode, advertisingPayload);
            }
            call.resolve();
          } catch (Exception e) {
            Log.e(TAG, "startAdvertising failed", e);
            call.reject(e.getMessage());
          }
        });
  }

  @PluginMethod
  public void stopAdvertising(PluginCall call) {
    stopAdvertisingInternal();
    call.resolve();
  }

  @PluginMethod
  public void startDiscovery(PluginCall call) {
    String joinCode = call.getString("joinCode", "");
    if (joinCode.isEmpty()) {
      call.reject("joinCode required");
      return;
    }
    discoveryJoinCode = normalizeCode(joinCode);
    stopDiscoveryInternal();
    discovering.set(true);
    nsdManager = (NsdManager) getContext().getSystemService(android.content.Context.NSD_SERVICE);
    discoveryListener =
        new NsdManager.DiscoveryListener() {
          @Override
          public void onStartDiscoveryFailed(String serviceType, int errorCode) {
            Log.w(TAG, "onStartDiscoveryFailed " + errorCode);
          }

          @Override
          public void onStopDiscoveryFailed(String serviceType, int errorCode) {
            Log.w(TAG, "onStopDiscoveryFailed " + errorCode);
          }

          @Override
          public void onDiscoveryStarted(String serviceType) {
            Log.d(TAG, "discovery started");
          }

          @Override
          public void onDiscoveryStopped(String serviceType) {
            Log.d(TAG, "discovery stopped");
          }

          @Override
          public void onServiceFound(NsdServiceInfo service) {
            if (!discovering.get()) return;
            if (!SERVICE_TYPE.equals(service.getServiceType())) return;
            nsdManager.resolveService(
                service,
                new NsdManager.ResolveListener() {
                  @Override
                  public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                    Log.w(TAG, "resolve failed " + errorCode);
                  }

                  @Override
                  public void onServiceResolved(NsdServiceInfo serviceInfo) {
                    String txt = serviceInfo.getServiceName();
                    String normalized = txt != null ? txt.replace("-", "").toUpperCase() : "";
                    String expected = "HUD-O-" + discoveryJoinCode;
                    if (!normalized.contains(expected) && !normalized.endsWith(discoveryJoinCode)) {
                      return;
                    }
                    fetchPayload(serviceInfo);
                  }
                });
          }

          @Override
          public void onServiceLost(NsdServiceInfo service) {
            /* ignore */
          }
        };
    nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener);
    if (nearby != null) {
      nearby.startDiscovery(discoveryJoinCode);
    }
    call.resolve();
  }

  @PluginMethod
  public void sendNearbyPayload(PluginCall call) {
    String endpointId = call.getString("endpointId", "");
    String payload = call.getString("payload", "");
    if (endpointId.isEmpty() || payload.isEmpty()) {
      call.reject("endpointId and payload required");
      return;
    }
    if (nearby == null) {
      call.reject("nearby unavailable");
      return;
    }
    nearby.sendPayload(endpointId, payload);
    call.resolve();
  }

  @PluginMethod
  public void stopDiscovery(PluginCall call) {
    stopDiscoveryInternal();
    call.resolve();
  }

  @PluginMethod
  public void sendPayloadToHost(PluginCall call) {
    String host = call.getString("host", "");
    int port = call.getInt("port", 0);
    String payload = call.getString("payload", "");
    if (host.isEmpty() || port <= 0 || payload.isEmpty()) {
      call.reject("host, port, and payload required");
      return;
    }
    executor.execute(
        () -> {
          try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), 8000);
            PrintWriter out =
                new PrintWriter(
                    new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true);
            out.print(payload);
            out.flush();
            socket.shutdownOutput();
            call.resolve();
          } catch (Exception e) {
            Log.w(TAG, "sendPayloadToHost failed", e);
            call.reject(e.getMessage());
          }
        });
  }

  private void acceptLoop() {
    executor.execute(
        () -> {
          while (serverSocket != null && !serverSocket.isClosed()) {
            try {
              Socket client = serverSocket.accept();
              handleClient(client);
            } catch (Exception e) {
              if (serverSocket != null && !serverSocket.isClosed()) {
                Log.w(TAG, "accept error", e);
              }
              break;
            }
          }
        });
  }

  /** Fetch = joiner sends G then reads offer. Answer = joiner sends full payload only. */
  private void handleClient(Socket client) {
    executor.execute(
        () -> {
          try {
            InputStream in = client.getInputStream();
            int first = in.read();
            if (first == FETCH_OFFER_BYTE) {
              PrintWriter out =
                  new PrintWriter(
                      new OutputStreamWriter(client.getOutputStream(), StandardCharsets.UTF_8),
                      true);
              out.print(advertisingPayload);
              out.flush();
              client.close();
              return;
            }
            if (first >= 0) {
              ByteArrayOutputStream baos = new ByteArrayOutputStream();
              baos.write(first);
              byte[] buf = new byte[4096];
              int n;
              while ((n = in.read(buf)) > 0) {
                baos.write(buf, 0, n);
              }
              String inbound = baos.toString(StandardCharsets.UTF_8).trim();
              client.close();
              if (!inbound.isEmpty()) {
                emitPayload(advertisingJoinCode, inbound, null, null, null, "wifi-lan");
              }
              return;
            }
            PrintWriter out =
                new PrintWriter(
                    new OutputStreamWriter(client.getOutputStream(), StandardCharsets.UTF_8), true);
            out.print(advertisingPayload);
            out.flush();
            client.close();
          } catch (Exception e) {
            Log.w(TAG, "handleClient error", e);
            try {
              client.close();
            } catch (Exception ignored) {
              /* ignore */
            }
          }
        });
  }

  private void registerNsdService(String joinCode) {
    nsdManager = (NsdManager) getContext().getSystemService(android.content.Context.NSD_SERVICE);
    NsdServiceInfo serviceInfo = new NsdServiceInfo();
    serviceInfo.setServiceName("HUD-O-" + joinCode);
    serviceInfo.setServiceType(SERVICE_TYPE);
    serviceInfo.setPort(serverPort);
    registrationListener =
        new NsdManager.RegistrationListener() {
          @Override
          public void onRegistrationFailed(NsdServiceInfo serviceInfo, int errorCode) {
            Log.w(TAG, "registration failed " + errorCode);
          }

          @Override
          public void onUnregistrationFailed(NsdServiceInfo serviceInfo, int errorCode) {
            Log.w(TAG, "unregistration failed " + errorCode);
          }

          @Override
          public void onServiceRegistered(NsdServiceInfo serviceInfo) {
            Log.d(TAG, "service registered on port " + serverPort);
          }

          @Override
          public void onServiceUnregistered(NsdServiceInfo serviceInfo) {
            Log.d(TAG, "service unregistered");
          }
        };
    nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener);
  }

  private void fetchPayload(NsdServiceInfo serviceInfo) {
    executor.execute(
        () -> {
          String host =
              serviceInfo.getHost() != null ? serviceInfo.getHost().getHostAddress() : "";
          int port = serviceInfo.getPort();
          try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(serviceInfo.getHost(), port), 8000);
            OutputStreamWriter osw =
                new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8);
            osw.write(FETCH_OFFER_BYTE);
            osw.flush();
            socket.shutdownOutput();
            BufferedReader reader =
                new BufferedReader(
                    new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[4096];
            int n;
            while ((n = reader.read(buf)) > 0) {
              sb.append(buf, 0, n);
            }
            String payload = sb.toString().trim();
            if (payload.isEmpty()) return;
            emitPayload(discoveryJoinCode, payload, host, port, null, "wifi-lan");
          } catch (Exception e) {
            Log.w(TAG, "fetchPayload failed", e);
          }
        });
  }

  private void emitPayload(
      String joinCode,
      String payload,
      String fromAddress,
      Integer fromPort,
      String endpointId,
      String transport) {
    JSObject data = new JSObject();
    data.put("joinCode", joinCode);
    data.put("payload", payload);
    data.put("transport", transport != null ? transport : "unknown");
    if (fromAddress != null) data.put("fromAddress", fromAddress);
    if (fromPort != null) data.put("fromPort", fromPort);
    if (endpointId != null) data.put("endpointId", endpointId);
    notifyListeners("payloadReceived", data);
  }

  private static String normalizeCode(String joinCode) {
    return joinCode.replace("-", "").trim().toUpperCase();
  }

  private void stopAdvertisingInternal() {
    try {
      if (nsdManager != null && registrationListener != null) {
        nsdManager.unregisterService(registrationListener);
      }
    } catch (Exception e) {
      Log.w(TAG, "unregister", e);
    }
    registrationListener = null;
    try {
      if (serverSocket != null) serverSocket.close();
    } catch (Exception e) {
      Log.w(TAG, "close socket", e);
    }
    serverSocket = null;
    if (nearby != null) {
      nearby.stopAdvertising();
    }
  }

  private void stopDiscoveryInternal() {
    discovering.set(false);
    try {
      if (nsdManager != null && discoveryListener != null) {
        nsdManager.stopServiceDiscovery(discoveryListener);
      }
    } catch (Exception e) {
      Log.w(TAG, "stop discovery", e);
    }
    discoveryListener = null;
    if (nearby != null) {
      nearby.stopDiscovery();
    }
  }

  @Override
  protected void handleOnDestroy() {
    stopAdvertisingInternal();
    stopDiscoveryInternal();
    if (nearby != null) {
      nearby.stopAll();
    }
    executor.shutdownNow();
    super.handleOnDestroy();
  }
}
