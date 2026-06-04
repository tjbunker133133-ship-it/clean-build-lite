/**
 * One-click wearable connection — auto-detect, silent fallback, persistent state.
 * Phone remains system of record; no pairing jargon exposed to operator.
 */

import { refreshHealthConnectCache } from '../healthConnectClient'
import { getDeviceProfile } from '../../../runtime/deviceProfile'
import type { WearableAdapter, WearableCapability } from './types'
import type { WalRuntime } from './walRuntime'
import { createDefaultWalAdapterRegistry, listAdapterCapabilities } from './walRegistry'
import { WAL_CONNECTION_STORAGE_KEY } from './walRuntimeConfig'

export type WalConnectionState = {
  connected: boolean
  lastConnectedAt: number | null
  activeAdapterIds: string[]
  autoReconnect: boolean
}

export type WalDeviceProbe = {
  adapterId: string
  displayName: string
  kind: string
  available: boolean
  authenticated: boolean
  capabilities: WearableCapability[]
  platformNote?: string
}

export type ConnectWearableResult = {
  ok: boolean
  message: string
  probes: WalDeviceProbe[]
  connectedAdapterIds: string[]
}

const DEFAULT_CONNECTION: WalConnectionState = {
  connected: false,
  lastConnectedAt: null,
  activeAdapterIds: [],
  autoReconnect: true,
}

export function loadWalConnectionState(): WalConnectionState {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_CONNECTION }
  try {
    const raw = localStorage.getItem(WAL_CONNECTION_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CONNECTION }
    return { ...DEFAULT_CONNECTION, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_CONNECTION }
  }
}

export function saveWalConnectionState(state: WalConnectionState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(WAL_CONNECTION_STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* quota / private mode */
  }
}

export async function probeWearableDevices(
  adapters: WearableAdapter[] = createDefaultWalAdapterRegistry(),
): Promise<WalDeviceProbe[]> {
  const profile = getDeviceProfile()
  const probes: WalDeviceProbe[] = []

  for (const adapter of adapters) {
    const caps = adapter.capabilities
    let available = true

    if (caps.identity.kind === 'android_health_connect') {
      const snap = await refreshHealthConnectCache()
      available = snap.nativeEligible && snap.sdkStatus === 'available'
    }
    if (caps.identity.kind === 'ios_healthkit') {
      available = profile.isIOS
    }
    if (caps.identity.kind === 'smart_ring' || caps.identity.kind === 'smart_glasses') {
      available = false /* future slot — silent fallback */
    }
    if (caps.identity.kind === 'generic_fallback') {
      available = true
    }

    let authenticated = false
    if (available) {
      try {
        authenticated = await adapter.authenticate()
      } catch {
        authenticated = false
      }
    }

    probes.push({
      adapterId: caps.identity.adapterId,
      displayName: caps.identity.displayName,
      kind: caps.identity.kind,
      available,
      authenticated,
      capabilities: caps.capabilities,
      platformNote: caps.platformNote,
    })
  }

  return probes
}

/** Pick adapters to activate — prefer authenticated, skip unavailable stubs silently. */
export function selectConnectableAdapters(probes: WalDeviceProbe[]): string[] {
  const ids: string[] = []
  const priority = [
    'android_health_connect',
    'notification_mirror',
    'ios_healthkit',
    'ios_notification_mirror',
    'android_notification_mirror',
    'generic_fallback',
  ]

  for (const kind of priority) {
    const match = probes.find((p) => p.kind === kind && p.available && (p.authenticated || kind.includes('notification')))
    if (match && !ids.includes(match.adapterId)) ids.push(match.adapterId)
  }

  if (ids.length === 0) {
    const fallback = probes.find((p) => p.adapterId === 'generic_fallback')
    if (fallback) ids.push(fallback.adapterId)
  }

  return ids
}

export function connectionStatusLabel(probes: WalDeviceProbe[]): string {
  const active = probes.filter((p) => p.authenticated)
  if (active.some((p) => p.kind === 'android_health_connect')) return 'Watch or ring vitals linked'
  if (active.some((p) => p.kind.includes('notification'))) return 'Phone alerts ready for watch mirror'
  if (probes.some((p) => p.available && !p.authenticated)) return 'Tap Connect to finish setup'
  return 'Phone-only mode — companion optional'
}

/**
 * @deprecated Prefer runConnectWearableFlow for 1-tap UX.
 */
export async function connectWearables(
  runtime: WalRuntime,
  options: {
    adapters?: WearableAdapter[]
    requestNotifications?: boolean
    linkHealthConnect?: boolean
  } = {},
): Promise<ConnectWearableResult> {
  const { runConnectWearableFlow } = await import('./walDeviceConnect')
  const result = await runConnectWearableFlow(runtime)
  if (result.phase === 'error') {
    return {
      ok: false,
      message: result.errorMessage ?? 'Phone-only mode active',
      probes: [],
      connectedAdapterIds: [],
    }
  }
  return {
    ok: true,
    message: result.classification?.headline ?? 'Ready',
    probes: [],
    connectedAdapterIds: [...runtime.getStatus().startedAdapterIds],
  }
}

export async function disconnectWearables(runtime: WalRuntime): Promise<void> {
  await runtime.stop()
  saveWalConnectionState({
    ...loadWalConnectionState(),
    connected: false,
    activeAdapterIds: [],
  })
}

export function listCapabilitiesSummary(adapters: WearableAdapter[] = createDefaultWalAdapterRegistry()): string[] {
  const caps = listAdapterCapabilities(adapters)
  const set = new Set<string>()
  for (const c of caps) {
    for (const cap of c.capabilities) set.add(cap)
  }
  return [...set]
}
