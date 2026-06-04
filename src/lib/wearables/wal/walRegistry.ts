import { androidHealthConnectAdapter } from './adapters/androidHealthConnectAdapter'
import { notificationMirrorAdapter } from './adapters/notificationMirrorAdapter'
import {
  genericFallbackAdapter,
  iosHealthKitAdapter,
  smartGlassesAdapter,
  smartRingAdapter,
} from './adapters/stubs'
import type { WearableAdapter } from './types'

/** Registered adapters — phone is system of record; wearables are signal sources only. */
export function createDefaultWalAdapterRegistry(): WearableAdapter[] {
  return [
    androidHealthConnectAdapter,
    notificationMirrorAdapter,
    iosHealthKitAdapter,
    smartRingAdapter,
    smartGlassesAdapter,
    genericFallbackAdapter,
  ]
}

export function listAdapterCapabilities(adapters: WearableAdapter[]): WearableAdapter['capabilities'][] {
  return adapters.map((a) => a.capabilities)
}
