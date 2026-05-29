/**
 * Bluetooth / BLE and browser PWAs (Android Chrome).
 *
 * Web Bluetooth can talk to BLE peripherals (heart rate, beacons) but does not
 * expose a general-purpose peer-to-peer mesh API comparable to native
 * Bluetooth Classic or Wi‑Fi Direct. Mission waypoint sync needs a reliable
 * bidirectional byte stream — WebRTC over LAN/hotspot is the supported path.
 *
 * A future native shell (Capacitor) could add Android Nearby Connections or
 * BLE GATT custom service for discovery; this module documents that boundary.
 */

export type BluetoothMeshCapability = {
  available: boolean
  reason: string
}

export function getBluetoothMeshCapability(): BluetoothMeshCapability {
  const hasWebBluetooth =
    typeof navigator !== 'undefined' && 'bluetooth' in navigator
  if (!hasWebBluetooth) {
    return {
      available: false,
      reason: 'Web Bluetooth not exposed in this browser build.',
    }
  }
  return {
    available: false,
    reason:
      'Web Bluetooth is for peripherals only, not multi-tablet mission sync. Use Mission Link (Wi‑Fi / hotspot WebRTC).',
  }
}
