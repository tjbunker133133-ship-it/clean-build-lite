/**
 * Health Connect bridge (Android field APK only). Read-only advisory vitals.
 * Does not affect GPS truth, SOS, deadman, or rescue dispatch.
 */

import type { HealthConnectSdkStatus, HealthConnectUiSnapshot } from './healthConnectFormat'
import {
  getWearablesHealthCache,
  setWearablesHealthCache,
} from './wearablesHealthCache'

export type { HealthConnectUiSnapshot }

export function getHealthConnectCache(): HealthConnectUiSnapshot | null {
  return getWearablesHealthCache()
}

export function clearHealthConnectCache(): void {
  setWearablesHealthCache(null)
}

function setCache(snap: HealthConnectUiSnapshot | null): void {
  setWearablesHealthCache(snap)
}

function isCapacitorAndroid(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (
    window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string }
    }
  ).Capacitor
  return Boolean(cap?.isNativePlatform?.() && cap.getPlatform?.() === 'android')
}

async function getPlugin() {
  if (!isCapacitorAndroid()) return null
  try {
    const mod = await import('@signal-one/capacitor-hud-health-connect')
    return mod.HudHealthConnect
  } catch {
    return null
  }
}

function mapSdkStatus(raw: string): HealthConnectSdkStatus {
  if (raw === 'available') return 'available'
  if (raw === 'provider_update_required') return 'provider_update_required'
  if (raw === 'unavailable') return 'unavailable'
  return 'not_android'
}

function toUi(
  avail: {
    sdkStatus: string
    permissionsGranted: boolean
    platform: string
  },
  snap?: {
    heartRateBpm?: number | null
    heartRateRecordedAt?: string | null
    stepsToday?: number | null
    stepsRecordedAt?: string | null
    permissionsGranted?: boolean
    error?: string
  },
): HealthConnectUiSnapshot {
  return {
    nativeEligible: isCapacitorAndroid(),
    sdkStatus: avail.platform === 'android' ? mapSdkStatus(avail.sdkStatus) : 'not_android',
    permissionsGranted: Boolean(snap?.permissionsGranted ?? avail.permissionsGranted),
    heartRateBpm: snap?.heartRateBpm ?? null,
    heartRateRecordedAt: snap?.heartRateRecordedAt ?? null,
    stepsToday: snap?.stepsToday ?? null,
    stepsRecordedAt: snap?.stepsRecordedAt ?? null,
    error: snap?.error,
  }
}

export async function refreshHealthConnectCache(): Promise<HealthConnectUiSnapshot> {
  const plugin = await getPlugin()
  if (!plugin) {
    const empty: HealthConnectUiSnapshot = {
      nativeEligible: false,
      sdkStatus: 'not_android',
      permissionsGranted: false,
      heartRateBpm: null,
      heartRateRecordedAt: null,
      stepsToday: null,
      stepsRecordedAt: null,
    }
    setCache(empty)
    return empty
  }
  const avail = await plugin.getAvailability()
  let snap: HealthConnectUiSnapshot = toUi(avail)
  if (avail.sdkStatus === 'available' && avail.permissionsGranted) {
    const read = await plugin.readSnapshot()
    snap = toUi(avail, read)
  }
  setCache(snap)
  return snap
}

export async function requestHealthConnectPermissions(): Promise<{
  ok: boolean
  message: string
}> {
  const plugin = await getPlugin()
  if (!plugin) {
    return { ok: false, message: 'Health Connect requires the Android field APK.' }
  }
  const avail = await plugin.getAvailability()
  if (avail.sdkStatus !== 'available') {
    return {
      ok: false,
      message:
        avail.sdkStatus === 'provider_update_required'
          ? 'Update the Health Connect app from Play Store, then try again.'
          : 'Health Connect is not available on this device.',
    }
  }
  try {
    await plugin.requestPermissions()
    await refreshHealthConnectCache()
    return {
      ok: getWearablesHealthCache()?.permissionsGranted ?? false,
      message: getWearablesHealthCache()?.permissionsGranted
        ? 'Health Connect permissions granted.'
        : 'Open Health Connect and allow heart rate and steps for Signal One HUD.',
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Permission request failed.'
    return { ok: false, message: msg }
  }
}

export async function readHealthConnectSnapshot(): Promise<HealthConnectUiSnapshot> {
  const plugin = await getPlugin()
  if (!plugin) {
    return refreshHealthConnectCache()
  }
  const avail = await plugin.getAvailability()
  const read = await plugin.readSnapshot()
  const snap = toUi(avail, read)
  setCache(snap)
  return snap
}

export async function openHealthConnectApp(): Promise<{ ok: boolean; message: string }> {
  const plugin = await getPlugin()
  if (!plugin) {
    return { ok: false, message: 'Android field APK only.' }
  }
  try {
    await plugin.openHealthConnectSettings()
    return { ok: true, message: 'Opened Health Connect.' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not open Health Connect.'
    return { ok: false, message: msg }
  }
}
