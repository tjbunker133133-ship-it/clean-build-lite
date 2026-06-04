/**
 * Bluetooth / mission bundle transfer on field tablets.
 *
 * Web Bluetooth cannot do tablet-to-tablet mesh. On the Android Capacitor app,
 * operators use the system Share sheet (Share join link) to send the bundle
 * over Bluetooth to a paired device. Wi‑Fi hotspot + mission code is preferred.
 */

import { getNativeLinkPlatform } from './nativeLink'

export type BluetoothMeshCapability = {
  available: boolean
  reason: string
}

let nativePlatformCache: Awaited<ReturnType<typeof getNativeLinkPlatform>> | null = null

export async function getBluetoothMeshCapabilityAsync(): Promise<BluetoothMeshCapability> {
  if (!nativePlatformCache) nativePlatformCache = await getNativeLinkPlatform()
  if (nativePlatformCache.discoveryMethod === 'android-nsd-nearby') {
    return {
      available: true,
      reason:
        'Bluetooth/Nearby auto-discovery is on (no manual pairing). Wi‑Fi hotspot is tried first; Share still works as backup.',
    }
  }
  if (nativePlatformCache.available) {
    return {
      available: true,
      reason:
        'Rebuild APK with latest plugin for Bluetooth/Nearby. Wi‑Fi code + Share sheet still work.',
    }
  }
  return getBluetoothMeshCapability()
}

export function getBluetoothMeshCapability(): BluetoothMeshCapability {
  return {
    available: false,
    reason:
      'Android field app: Wi‑Fi + Bluetooth/Nearby discovery, then stable mesh. Browser: Share / QR / paste bundle.',
  }
}
