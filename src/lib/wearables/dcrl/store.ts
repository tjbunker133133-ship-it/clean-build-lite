import type {
  DcrlDeviceRecord,
  DcrlDeviceType,
  DcrlDiagnostics,
  DcrlDynamicState,
  DcrlThrottleRecord,
} from './types'
import { DCRL_STATIC_REGISTRY, defaultDynamicState, staticProfileFor } from './registry'

const MAX_RECENT = 20
const PHONE_DEVICE_ID = 'host-phone'

let devices = new Map<string, DcrlDeviceRecord>()

let diagnostics: DcrlDiagnostics = {
  updatedAt: 0,
  devices: [],
  lastThrottle: null,
  recentThrottles: [],
}

type Listener = (d: DcrlDiagnostics) => void
const listeners = new Set<Listener>()

function syncDiagnostics(): void {
  diagnostics = {
    ...diagnostics,
    updatedAt: Date.now(),
    devices: [...devices.values()].sort((a, b) => a.type.localeCompare(b.type)),
  }
  for (const fn of listeners) {
    try {
      fn(diagnostics)
    } catch {
      /* ignore */
    }
  }
}

export function getDcrlDiagnostics(): DcrlDiagnostics {
  return diagnostics
}

export function subscribeDcrlDiagnostics(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function listDcrlDevices(): DcrlDeviceRecord[] {
  return [...devices.values()]
}

export function getDcrlDevice(deviceId: string): DcrlDeviceRecord | null {
  return devices.get(deviceId) ?? null
}

export function getDcrlDeviceByType(type: DcrlDeviceType): DcrlDeviceRecord | null {
  for (const record of devices.values()) {
    if (record.type === type) return record
  }
  return null
}

export function upsertDcrlDevice(input: {
  deviceId: string
  type: DcrlDeviceType
  displayName: string
  dynamic?: Partial<DcrlDynamicState>
}): DcrlDeviceRecord {
  const existing = devices.get(input.deviceId)
  const staticProfile = staticProfileFor(input.type)
  const dynamic = {
    ...(existing?.dynamic ?? defaultDynamicState(true)),
    present: true,
    ...input.dynamic,
  }
  const record: DcrlDeviceRecord = {
    deviceId: input.deviceId,
    type: input.type,
    displayName: input.displayName,
    static: staticProfile,
    dynamic,
    updatedAt: Date.now(),
  }
  devices.set(input.deviceId, record)
  syncDiagnostics()
  return record
}

export function patchDcrlDynamic(
  deviceId: string,
  patch: Partial<DcrlDynamicState>,
): DcrlDeviceRecord | null {
  const existing = devices.get(deviceId)
  if (!existing) return null
  const record: DcrlDeviceRecord = {
    ...existing,
    dynamic: { ...existing.dynamic, ...patch },
    updatedAt: Date.now(),
  }
  devices.set(deviceId, record)
  syncDiagnostics()
  return record
}

export function patchDcrlDynamicByType(
  type: DcrlDeviceType,
  patch: Partial<DcrlDynamicState>,
): DcrlDeviceRecord | null {
  const record = getDcrlDeviceByType(type)
  if (!record) return null
  return patchDcrlDynamic(record.deviceId, patch)
}

export function recordDcrlThrottle(record: Omit<DcrlThrottleRecord, 'ts'>): void {
  const entry: DcrlThrottleRecord = { ...record, ts: Date.now() }
  diagnostics = {
    ...diagnostics,
    updatedAt: entry.ts,
    lastThrottle: entry,
    recentThrottles: [...diagnostics.recentThrottles, entry].slice(-MAX_RECENT),
  }
  for (const fn of listeners) {
    try {
      fn(diagnostics)
    } catch {
      /* ignore */
    }
  }
}

export function seedPhoneHostDevice(): DcrlDeviceRecord {
  return upsertDcrlDevice({
    deviceId: PHONE_DEVICE_ID,
    type: 'phone',
    displayName: 'Mission HUD Host',
    dynamic: {
      present: true,
      connected: true,
      authenticated: true,
      reachable: typeof navigator !== 'undefined' ? navigator.onLine : true,
      foreground: typeof document !== 'undefined' ? document.visibilityState === 'visible' : true,
    },
  })
}

export function ensureDcrlDeviceSlot(type: DcrlDeviceType, displayName: string): DcrlDeviceRecord {
  const existing = getDcrlDeviceByType(type)
  if (existing) return existing
  return upsertDcrlDevice({
    deviceId: `slot-${type}`,
    type,
    displayName,
    dynamic: defaultDynamicState(false),
  })
}

export function _resetDcrlStoreForTests(): void {
  devices = new Map()
  diagnostics = {
    updatedAt: 0,
    devices: [],
    lastThrottle: null,
    recentThrottles: [],
  }
  syncDiagnostics()
}

let installed = false

export function installDcrlDiagnostics(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  seedPhoneHostDevice()
  const w = window as Window & {
    __hudDcrl?: DcrlDiagnostics
    __hudDcrlGet?: () => DcrlDiagnostics
  }
  w.__hudDcrl = diagnostics
  w.__hudDcrlGet = () => diagnostics
  subscribeDcrlDiagnostics((d) => {
    w.__hudDcrl = d
  })
}

export { PHONE_DEVICE_ID, DCRL_STATIC_REGISTRY }
