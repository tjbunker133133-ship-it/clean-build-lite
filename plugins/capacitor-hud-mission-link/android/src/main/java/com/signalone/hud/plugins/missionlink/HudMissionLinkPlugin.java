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
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
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

  @PluginMethod
  public void getPlatformInfo(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("available", true);
    ret.put("platform", "android");
    ret.put("discoveryMethod", "android-nsd");
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
    advertisingJoinCode = joinCode;
    advertisingPayload = payload;
    stopAdvertisingInternal();
    executor.execute(() -> {
      try {
        serverSocket = new ServerSocket(0);
        serverPort = serverSocket.getLocalPort();
        registerNsdService(joinCode);
        acceptLoop();
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
    discoveryJoinCode = joinCode.replace("-", "").trim().toUpperCase();
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
                    if (!normalized.contains(discoveryJoinCode) && !discoveryJoinCode.isEmpty()) {
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
    call.resolve();
  }

  @PluginMethod
  public void stopDiscovery(PluginCall call) {
    stopDiscoveryInternal();
    call.resolve();
  }

  private void acceptLoop() {
    executor.execute(
        () -> {
          while (serverSocket != null && !serverSocket.isClosed()) {
            try {
              Socket client = serverSocket.accept();
              PrintWriter out =
                  new PrintWriter(
                      new OutputStreamWriter(client.getOutputStream(), StandardCharsets.UTF_8),
                      true);
              out.print(advertisingPayload);
              out.flush();
              client.close();
            } catch (Exception e) {
              if (serverSocket != null && !serverSocket.isClosed()) {
                Log.w(TAG, "accept error", e);
              }
              break;
            }
          }
        });
  }

  private void registerNsdService(String joinCode) {
    nsdManager = (NsdManager) getContext().getSystemService(android.content.Context.NSD_SERVICE);
    NsdServiceInfo serviceInfo = new NsdServiceInfo();
    serviceInfo.setServiceName("HUD-" + joinCode.replace("-", ""));
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
          try (Socket socket = new Socket(serviceInfo.getHost(), serviceInfo.getPort());
              BufferedReader reader =
                  new BufferedReader(
                      new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[4096];
            int n;
            while ((n = reader.read(buf)) > 0) {
              sb.append(buf, 0, n);
            }
            String payload = sb.toString().trim();
            if (payload.isEmpty()) return;
            JSObject data = new JSObject();
            data.put("joinCode", discoveryJoinCode);
            data.put("payload", payload);
            data.put("fromAddress", serviceInfo.getHost() != null ? serviceInfo.getHost().getHostAddress() : "");
            notifyListeners("payloadReceived", data);
          } catch (Exception e) {
            Log.w(TAG, "fetchPayload failed", e);
          }
        });
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
  }

  @Override
  protected void handleOnDestroy() {
    stopAdvertisingInternal();
    stopDiscoveryInternal();
    executor.shutdownNow();
    super.handleOnDestroy();
  }
}
