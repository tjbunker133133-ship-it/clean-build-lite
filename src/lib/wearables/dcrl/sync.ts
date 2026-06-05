/**
 * DCRL dynamic sync — observes public runtime signals without modifying WAL/WCEL.
 * Independent from environment configuration.
 */

import { loadWalConnectionState } from '../wal/walConnection'
import { runtimePollIntervalMs } from '../../../runtime/runtimeActivityPolicy'
import type { DcrlNotificationPermission } from './types'
import {
  ensureDcrlDeviceSlot,
  patchDcrlDynamic,
  patchDcrlDynamicByType,
  PHONE_DEVICE_ID,
  seedPhoneHostDevice,
} from './store'

const LOW_BATTERY_PCT = 15

let syncStarted = false
let syncTimer: ReturnType<typeof setInterval> | null = null

function rescheduleSyncTimer(): void {
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = setInterval(runDcrlDynamicSync, runtimePollIntervalMs('dcrl_sync'))
}

async function bindBatteryListener(): Promise<void> {
  try {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; addEventListener: (e: string, fn: () => void) => void }>
    }
    if (!nav.getBattery) return
    const battery = await nav.getBattery()
    applyBatterySignal(Math.round(battery.level * 100))
    battery.addEventListener('levelchange', () => {
      applyBatterySignal(Math.round(battery.level * 100))
    })
  } catch {
    /* unsupported */
  }
}

function readNotificationPermission(): DcrlNotificationPermission {
  if (typeof Notification === 'undefined') return 'unsupported'
  switch (Notification.permission) {
    case 'granted':
      return 'granted'
    case 'denied':
      return 'denied'
    default:
      return 'default'
  }
}

function syncPhoneHost(): void {
  patchDcrlDynamic(PHONE_DEVICE_ID, {
    reachable: typeof navigator !== 'undefined' ? navigator.onLine : true,
    foreground: typeof document !== 'undefined' ? document.visibilityState === 'visible' : true,
    notificationPermission: readNotificationPermission(),
  })
}

function syncWearableSlotsFromWal(): void {
  const wal = loadWalConnectionState()
  ensureDcrlDeviceSlot('watch', 'Companion Watch')
  ensureDcrlDeviceSlot('ring', 'Smart Ring')
  ensureDcrlDeviceSlot('glasses', 'Smart Glasses')

  patchDcrlDynamicByType('watch', {
    present: true,
    connected: wal.connected,
    authenticated: wal.connected,
    streaming: wal.connected,
    lastSeenAt: wal.lastConnectedAt,
    notificationPermission: readNotificationPermission(),
  })

  const hasRing = wal.activeAdapterIds.some((id) => id.toLowerCase().includes('ring'))
  const hasGlasses = wal.activeAdapterIds.some((id) => id.toLowerCase().includes('glass'))

  patchDcrlDynamicByType('ring', {
    present: hasRing || wal.connected,
    connected: hasRing,
    authenticated: hasRing,
    streaming: hasRing,
    lastSeenAt: hasRing ? Date.now() : null,
  })

  patchDcrlDynamicByType('glasses', {
    present: hasGlasses,
    connected: hasGlasses,
    authenticated: hasGlasses,
    streaming: hasGlasses,
    lastSeenAt: hasGlasses ? Date.now() : null,
  })
}

function applyBatterySignal(pct: number | null): void {
  const batteryLow = pct != null && pct <= LOW_BATTERY_PCT
  patchDcrlDynamic(PHONE_DEVICE_ID, { batteryPct: pct, batteryLow })
  patchDcrlDynamicByType('watch', { batteryPct: pct, batteryLow })
}

export function ingestDcrlBatteryPct(pct: number | null): void {
  applyBatterySignal(pct)
}

export function runDcrlDynamicSync(): void {
  seedPhoneHostDevice()
  syncPhoneHost()
  syncWearableSlotsFromWal()
}

function onVisibilityChange(): void {
  syncPhoneHost()
  rescheduleSyncTimer()
}

function onOnlineChange(): void {
  syncPhoneHost()
  syncWearableSlotsFromWal()
}

export function startDcrlDynamicSync(): void {
  if (syncStarted || typeof window === 'undefined') return
  syncStarted = true
  runDcrlDynamicSync()
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('online', onOnlineChange)
  window.addEventListener('offline', onOnlineChange)
  rescheduleSyncTimer()
  void bindBatteryListener()
}

export function stopDcrlDynamicSync(): void {
  if (!syncStarted || typeof window === 'undefined') return
  syncStarted = false
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('online', onOnlineChange)
  window.removeEventListener('offline', onOnlineChange)
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}

export function _resetDcrlDynamicSyncForTests(): void {
  stopDcrlDynamicSync()
  syncStarted = false
}
