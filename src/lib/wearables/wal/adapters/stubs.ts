/**
 * Future-ready stubs — authenticate false, no signals until native SDK wired.
 */

import type { WearableAdapter, WearableAdapterCapabilities } from '../types'

function stubAdapter(
  id: string,
  kind: WearableAdapterCapabilities['identity']['kind'],
  name: string,
  caps: WearableAdapterCapabilities['capabilities'],
  note: string,
): WearableAdapter {
  const capabilities: WearableAdapterCapabilities = {
    identity: { adapterId: id, kind, displayName: name, authenticated: false },
    capabilities: caps,
    platformNote: note,
  }
  return {
    capabilities,
    async authenticate() {
      return false
    },
    async startStreaming() {},
    async stopStreaming() {},
  }
}

export const iosHealthKitAdapter = stubAdapter(
  'ios_healthkit',
  'ios_healthkit',
  'HealthKit (iOS)',
  ['heart_rate', 'motion'],
  'Tier 2+: native Capacitor HealthKit plugin required',
)

export const smartRingAdapter = stubAdapter(
  'smart_ring',
  'smart_ring',
  'Smart ring',
  ['heart_rate', 'sleep', 'battery'],
  'Tier 3: vendor SDK adapter slot',
)

export const smartGlassesAdapter = stubAdapter(
  'smart_glasses',
  'smart_glasses',
  'Smart glasses',
  ['display_out', 'notification_out'],
  'Tier 3: display/audio projection only — no sensing',
)

export const genericFallbackAdapter = stubAdapter(
  'generic_fallback',
  'generic_fallback',
  'Generic fallback',
  ['battery'],
  'Phone battery + manual triggers only',
)
