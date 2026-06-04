/**
 * Android Health Connect adapter — raw signal normalization only.
 * Wraps existing read-only healthConnectClient; no SOS logic.
 */

import { readHealthConnectSnapshot, refreshHealthConnectCache } from '../../healthConnectClient'
import type { WearableAdapter, WearableAdapterCapabilities, WearableSignal, WearableSignalHandler } from '../types'

let handler: WearableSignalHandler | null = null

function snapshotToSignals(sourceDevice: string, snap: Awaited<ReturnType<typeof readHealthConnectSnapshot>>): WearableSignal[] {
  const now = Date.now()
  const out: WearableSignal[] = []
  if (snap.heartRateBpm != null) {
    out.push({
      type: 'heart_rate',
      value: snap.heartRateBpm,
      timestamp: snap.heartRateRecordedAt ? Date.parse(snap.heartRateRecordedAt) || now : now,
      sourceDevice,
      confidence: snap.permissionsGranted ? 0.9 : 0.3,
    })
  } else if (snap.permissionsGranted) {
    out.push({
      type: 'heart_rate',
      value: 0,
      timestamp: now,
      sourceDevice,
      confidence: 0.5,
    })
  }
  if (snap.stepsToday != null) {
    out.push({
      type: 'motion',
      value: { steps: snap.stepsToday },
      timestamp: snap.stepsRecordedAt ? Date.parse(snap.stepsRecordedAt) || now : now,
      sourceDevice,
      confidence: 0.8,
    })
  }
  return out
}

const capabilities: WearableAdapterCapabilities = {
  identity: {
    adapterId: 'android_health_connect',
    kind: 'android_health_connect',
    displayName: 'Health Connect (Android)',
    authenticated: false,
  },
  capabilities: ['heart_rate', 'steps', 'motion'],
  platformNote: 'Requires Capacitor Android field APK',
}

export const androidHealthConnectAdapter: WearableAdapter = {
  capabilities,

  async authenticate() {
    const snap = await refreshHealthConnectCache()
    const ok = snap.nativeEligible && snap.sdkStatus === 'available'
    capabilities.identity.authenticated = ok && snap.permissionsGranted
    return capabilities.identity.authenticated
  },

  async startStreaming(onSignal) {
    if (handler != null) return /* prevent duplicate listeners */
    handler = onSignal
    const snap = await refreshHealthConnectCache()
    for (const s of snapshotToSignals(capabilities.identity.adapterId, snap)) {
      handler(s)
    }
  },

  async stopStreaming() {
    handler = null
  },

  async pollSignals() {
    const snap = await readHealthConnectSnapshot()
    return snapshotToSignals(capabilities.identity.adapterId, snap)
  },
}

export function emitHealthConnectPollToHandler(): void {
  if (!handler) return
  void readHealthConnectSnapshot().then((snap) => {
    if (!handler) return
    for (const s of snapshotToSignals(capabilities.identity.adapterId, snap)) {
      handler(s)
    }
  })
}
