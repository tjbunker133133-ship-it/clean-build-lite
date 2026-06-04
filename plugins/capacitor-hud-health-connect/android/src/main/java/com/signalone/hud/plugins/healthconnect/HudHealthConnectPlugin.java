package com.signalone.hud.plugins.healthconnect;

import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.PermissionController;
import androidx.health.connect.client.permission.HealthPermission;
import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.records.StepsRecord;
import androidx.health.connect.client.request.ReadRecordsRequest;
import androidx.health.connect.client.response.ReadRecordsResponse;
import androidx.health.connect.client.time.TimeRangeFilter;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "HudHealthConnect")
public class HudHealthConnectPlugin extends Plugin {
  private static final String TAG = "HudHealthConnect";

  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private ActivityResultLauncher<Set<String>> permissionLauncher;
  private PluginCall pendingPermissionCall;

  private static final Set<String> READ_PERMISSIONS =
      Set.of(
          HealthPermission.getReadPermission(HeartRateRecord.class),
          HealthPermission.getReadPermission(StepsRecord.class));

  private HealthConnectClient clientOrNull() {
    try {
      int status = HealthConnectClient.getSdkStatus(getContext());
      if (status != HealthConnectClient.SDK_AVAILABLE) {
        return null;
      }
      return HealthConnectClient.getOrCreate(getContext());
    } catch (Exception e) {
      Log.w(TAG, "HealthConnectClient unavailable", e);
      return null;
    }
  }

  private String mapSdkStatus(int status) {
    if (status == HealthConnectClient.SDK_AVAILABLE) {
      return "available";
    }
    if (status == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
      return "provider_update_required";
    }
    return "unavailable";
  }

  private void ensurePermissionLauncher() {
    if (permissionLauncher != null) {
      return;
    }
    if (!(getActivity() instanceof ComponentActivity)) {
      return;
    }
    ComponentActivity activity = (ComponentActivity) getActivity();
    permissionLauncher =
        activity.registerForActivityResult(
            PermissionController.createRequestPermissionResultContract(),
            granted -> {
              PluginCall call = pendingPermissionCall;
              pendingPermissionCall = null;
              if (call == null) {
                return;
              }
              JSObject ret = new JSObject();
              JSArray arr = new JSArray();
              for (String p : granted) {
                arr.put(p);
              }
              ret.put("granted", arr);
              call.resolve(ret);
            });
  }

  @PluginMethod
  public void getAvailability(PluginCall call) {
    int status = HealthConnectClient.getSdkStatus(getContext());
    boolean granted = false;
    HealthConnectClient client = clientOrNull();
    if (client != null) {
      try {
        Set<String> existing = client.getPermissionController().getGrantedPermissions();
        granted = existing.containsAll(READ_PERMISSIONS);
      } catch (Exception e) {
        Log.w(TAG, "getGrantedPermissions failed", e);
      }
    }
    JSObject ret = new JSObject();
    ret.put("platform", "android");
    ret.put("sdkStatus", mapSdkStatus(status));
    ret.put("permissionsGranted", granted);
    ret.put("advisoryOnly", true);
    call.resolve(ret);
  }

  @PluginMethod
  public void requestPermissions(PluginCall call) {
    HealthConnectClient client = clientOrNull();
    if (client == null) {
      call.reject("Health Connect is not available on this device. Install or update the Health Connect app.");
      return;
    }
    try {
      Set<String> existing = client.getPermissionController().getGrantedPermissions();
      if (existing.containsAll(READ_PERMISSIONS)) {
        JSObject ret = new JSObject();
        JSArray arr = new JSArray();
        for (String p : READ_PERMISSIONS) {
          arr.put(p);
        }
        ret.put("granted", arr);
        call.resolve(ret);
        return;
      }
    } catch (Exception e) {
      call.reject("Could not read Health Connect permissions: " + e.getMessage());
      return;
    }

    if (!(getActivity() instanceof ComponentActivity)) {
      call.reject("Activity not ready for Health Connect permission UI.");
      return;
    }
    ensurePermissionLauncher();
    if (permissionLauncher == null) {
      call.reject("Could not open Health Connect permission UI.");
      return;
    }
    pendingPermissionCall = call;
    getActivity()
        .runOnUiThread(
            () -> {
              try {
                permissionLauncher.launch(READ_PERMISSIONS);
              } catch (Exception e) {
                pendingPermissionCall = null;
                call.reject("Permission request failed: " + e.getMessage());
              }
            });
  }

  @PluginMethod
  public void readSnapshot(PluginCall call) {
    HealthConnectClient client = clientOrNull();
    if (client == null) {
      JSObject ret = emptySnapshot(false);
      ret.put("error", "Health Connect not available.");
      call.resolve(ret);
      return;
    }
    executor.execute(
        () -> {
          try {
            Set<String> existing = client.getPermissionController().getGrantedPermissions();
            if (!existing.containsAll(READ_PERMISSIONS)) {
              JSObject ret = emptySnapshot(false);
              ret.put("error", "Allow heart rate and steps in Health Connect first.");
              resolveOnUi(call, ret);
              return;
            }
            JSObject ret = readSnapshotInternal(client);
            ret.put("permissionsGranted", true);
            ret.put("advisoryOnly", true);
            resolveOnUi(call, ret);
          } catch (Exception e) {
            Log.w(TAG, "readSnapshot failed", e);
            JSObject ret = emptySnapshot(false);
            ret.put("error", e.getMessage() != null ? e.getMessage() : "read failed");
            resolveOnUi(call, ret);
          }
        });
  }

  private void resolveOnUi(PluginCall call, JSObject ret) {
    if (getActivity() != null) {
      getActivity().runOnUiThread(() -> call.resolve(ret));
    } else {
      call.resolve(ret);
    }
  }

  private JSObject emptySnapshot(boolean permissionsGranted) {
    JSObject ret = new JSObject();
    ret.put("heartRateBpm", null);
    ret.put("heartRateRecordedAt", null);
    ret.put("stepsToday", null);
    ret.put("stepsRecordedAt", null);
    ret.put("permissionsGranted", permissionsGranted);
    ret.put("advisoryOnly", true);
    return ret;
  }

  private JSObject readSnapshotInternal(HealthConnectClient client) throws Exception {
    Instant now = Instant.now();
    Instant dayStart =
        LocalDate.now(ZoneId.systemDefault())
            .atStartOfDay(ZoneId.systemDefault())
            .toInstant();
    TimeRangeFilter today = TimeRangeFilter.between(dayStart, now);
    TimeRangeFilter lastDay = TimeRangeFilter.between(now.minusSeconds(86400), now);

    JSObject ret = emptySnapshot(true);

    ReadRecordsRequest<StepsRecord> stepsReq =
        new ReadRecordsRequest.Builder<>(StepsRecord.class)
            .setTimeRangeFilter(today)
            .build();
    ReadRecordsResponse<StepsRecord> stepsResp = client.readRecords(stepsReq).get();
    long stepsSum = 0;
    Instant stepsLatest = null;
    for (StepsRecord rec : stepsResp.getRecords()) {
      stepsSum += rec.getCount();
      if (stepsLatest == null || rec.getEndTime().isAfter(stepsLatest)) {
        stepsLatest = rec.getEndTime();
      }
    }
    if (stepsSum > 0) {
      ret.put("stepsToday", stepsSum);
      if (stepsLatest != null) {
        ret.put("stepsRecordedAt", stepsLatest.toString());
      }
    }

    ReadRecordsRequest<HeartRateRecord> hrReq =
        new ReadRecordsRequest.Builder<>(HeartRateRecord.class)
            .setTimeRangeFilter(lastDay)
            .setAscendingOrder(false)
            .setPageSize(5)
            .build();
    ReadRecordsResponse<HeartRateRecord> hrResp = client.readRecords(hrReq).get();
    List<HeartRateRecord> hrRecords = hrResp.getRecords();
    for (HeartRateRecord rec : hrRecords) {
      if (rec.getSamples() == null || rec.getSamples().isEmpty()) {
        continue;
      }
      long bpm = rec.getSamples().get(rec.getSamples().size() - 1).getBeatsPerMinute();
      ret.put("heartRateBpm", bpm);
      ret.put("heartRateRecordedAt", rec.getEndTime().toString());
      break;
    }

    return ret;
  }

  /** Optional: open Health Connect app for linking ring / watch sources. */
  @PluginMethod
  public void openHealthConnectSettings(PluginCall call) {
    try {
      Intent intent = new Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      try {
        Intent market =
            new Intent(
                Intent.ACTION_VIEW,
                Uri.parse("market://details?id=com.google.android.apps.healthdata"));
        market.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(market);
        call.resolve();
      } catch (Exception e2) {
        call.reject("Could not open Health Connect: " + e.getMessage());
      }
    }
  }

  @Override
  protected void handleOnDestroy() {
    executor.shutdownNow();
    super.handleOnDestroy();
  }
}
