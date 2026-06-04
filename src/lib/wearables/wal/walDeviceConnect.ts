/**
 * 1-tap wearable connect — discover, classify, attach, ready.
 * No wizard, no device picker, no technical language in UI copy.
 */

import { requestNotificationPermission } from '../../devicePermissions'
import { requestHealthConnectPermissions, refreshHealthConnectCache } from '../healthConnectClient'
import { getDeviceProfile } from '../../../runtime/deviceProfile'
import type { WearableCapability } from './types'
import type { WalRuntime } from './walRuntime'
import type { InferredWearableType } from './walRuntime'
import {
  probeWearableDevices,
  loadWalConnectionState,
  saveWalConnectionState,
  selectConnectableAdapters,
  type WalDeviceProbe,
} from './walConnection'
import { createDefaultWalAdapterRegistry } from './walRegistry'

export type ConnectWearableUiPhase = 'idle' | 'searching' | 'ready' | 'partial' | 'error'

export type WearableClassification = {
  type: InferredWearableType
  /** Operator-facing headline — no technical terms */
  headline: string
  adapterIds: string[]
  capabilities: WearableCapability[]
}

export type ConnectWearableReadyCard = {
  variant: 'success' | 'partial'
  title: string
  watchLine: string
  signalsLine: string
  notificationsLine: string
  primaryButton: 'Done' | 'Continue'
  classification: WearableClassification
}

export type ConnectWearableFlowResult = {
  phase: ConnectWearableUiPhase
  card: ConnectWearableReadyCard | null
  errorMessage: string | null
  classification: WearableClassification | null
}

const SEARCH_MIN_MS = 600
const SEARCH_MAX_MS = 2800

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function notificationsGranted(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

/** Auto-classify detected hardware — no user input. */
export function classifyWearables(probes: WalDeviceProbe[]): WearableClassification {
  const authed = probes.filter((p) => p.authenticated && p.available)
  const adapterIds = selectConnectableAdapters(probes)

  const glasses = authed.find((p) => p.kind === 'smart_glasses')
  if (glasses) {
    return {
      type: 'glasses',
      headline: 'Display device available',
      adapterIds: [glasses.adapterId],
      capabilities: glasses.capabilities,
    }
  }

  const ring = authed.find((p) => p.kind === 'smart_ring')
  if (ring) {
    return {
      type: 'ring',
      headline: 'Biometric sensor found',
      adapterIds: [ring.adapterId],
      capabilities: ring.capabilities,
    }
  }

  const hc = authed.find((p) => p.kind === 'android_health_connect')
  const healthkit = authed.find((p) => p.kind === 'ios_healthkit')
  const notif = probes.find(
    (p) =>
      (p.kind === 'android_notification_mirror' || p.kind === 'ios_notification_mirror') &&
      p.available &&
      (p.authenticated || notificationsGranted()),
  )

  const vitals = hc ?? healthkit

  if (vitals && notif) {
    return {
      type: 'watch',
      headline: 'Watch connected',
      adapterIds: adapterIds.filter((id) =>
        probes.some(
          (p) =>
            p.adapterId === id &&
            (p.kind === 'android_health_connect' ||
              p.kind === 'ios_healthkit' ||
              p.kind.includes('notification')),
        ),
      ),
      capabilities: mergeCapabilities([vitals, notif]),
    }
  }

  if (vitals) {
    return {
      type: 'ring',
      headline: 'Biometric sensor found',
      adapterIds: [vitals.adapterId],
      capabilities: vitals.capabilities,
    }
  }

  if (notif) {
    return {
      type: 'watch',
      headline: 'Watch connected',
      adapterIds: notif.adapterId ? [notif.adapterId] : adapterIds,
      capabilities: notif.capabilities,
    }
  }

  const fallback = probes.find((p) => p.adapterId === 'generic_fallback')
  return {
    type: 'phone_only',
    headline: 'Phone-only mode active',
    adapterIds: fallback ? [fallback.adapterId] : [],
    capabilities: fallback?.capabilities ?? [],
  }
}

function mergeCapabilities(probes: WalDeviceProbe[]): WearableCapability[] {
  const set = new Set<WearableCapability>()
  for (const p of probes) {
    for (const c of p.capabilities) set.add(c)
  }
  return [...set]
}

export function buildReadyCard(
  classification: WearableClassification,
  notificationsOk: boolean,
  signalsActive: boolean,
): ConnectWearableReadyCard {
  const isPhoneOnly = classification.type === 'phone_only'
  const partial = isPhoneOnly || !signalsActive

  if (partial) {
    return {
      variant: 'partial',
      title: 'Limited Wearable Support',
      watchLine:
        classification.type === 'watch'
          ? 'Connected'
          : classification.type === 'ring'
            ? 'Sensor linked'
            : classification.type === 'glasses'
              ? 'Display ready'
              : 'Phone only',
      signalsLine: signalsActive ? 'Active' : 'Phone only',
      notificationsLine: notificationsOk ? 'Enabled' : 'Not enabled',
      primaryButton: 'Continue',
      classification,
    }
  }

  return {
    variant: 'success',
    title: 'Wearable Ready',
    watchLine:
      classification.type === 'watch'
        ? 'Connected'
        : classification.type === 'ring'
          ? 'Sensor linked'
          : classification.type === 'glasses'
            ? 'Display ready'
            : '—',
    signalsLine: 'Active',
    notificationsLine: notificationsOk ? 'Enabled' : 'Not enabled',
    primaryButton: 'Done',
    classification,
  }
}

async function discoverWearables(): Promise<WalDeviceProbe[]> {
  const profile = getDeviceProfile()

  await requestNotificationPermission()

  if (profile.isAndroid) {
    try {
      await requestHealthConnectPermissions()
      await refreshHealthConnectCache()
    } catch {
      /* silent — phone-only fallback */
    }
  }

  const adapters = createDefaultWalAdapterRegistry()
  const started = Date.now()
  const probes = await probeWearableDevices(adapters)
  const elapsed = Date.now() - started
  if (elapsed < SEARCH_MIN_MS) {
    await delay(SEARCH_MIN_MS - elapsed)
  }
  return probes
}

export type RunConnectWearableFlowOptions = {
  onPhase?: (phase: ConnectWearableUiPhase) => void
}

/**
 * Single entry: 1 tap → discover → classify → attach → stabilize.
 * Does not trigger escalation during pairing.
 */
export async function runConnectWearableFlow(
  runtime: WalRuntime,
  options: RunConnectWearableFlowOptions = {},
): Promise<ConnectWearableFlowResult> {
  const setPhase = (phase: ConnectWearableUiPhase) => options.onPhase?.(phase)

  setPhase('searching')

  try {
    const searchBudget = delay(SEARCH_MAX_MS)
    const probes = await discoverWearables()
    await searchBudget

    const classification = classifyWearables(probes)
    const notifOk = notificationsGranted()

    if (classification.type === 'phone_only' && classification.adapterIds.length === 0) {
      setPhase('error')
      return {
        phase: 'error',
        card: null,
        errorMessage: 'Wearable unavailable. Phone mode active.',
        classification,
      }
    }

    const attachResult = await runtime.attachDevice({
      type: classification.type,
      capabilities: classification.capabilities,
      mode: 'balanced',
      adapterIds: classification.adapterIds,
    })

    if (!attachResult.ok) {
      setPhase('error')
      return {
        phase: 'error',
        card: null,
        errorMessage: 'Wearable unavailable. Phone mode active.',
        classification,
      }
    }

    await runtime.stabilizeConnection()

    saveWalConnectionState({
      connected: true,
      lastConnectedAt: Date.now(),
      activeAdapterIds: attachResult.adapterIds,
      autoReconnect: true,
    })

    const signalsActive = attachResult.adapterIds.some((id) => id !== 'generic_fallback')
    const card = buildReadyCard(classification, notifOk, signalsActive)
    const phase = card.variant === 'success' ? 'ready' : 'partial'
    setPhase(phase)

    return {
      phase,
      card,
      errorMessage: null,
      classification,
    }
  } catch {
    setPhase('error')
    return {
      phase: 'error',
      card: null,
      errorMessage: 'Wearable unavailable. Phone mode active.',
      classification: null,
    }
  }
}

/** UI copy while searching — only string exposed during discover. */
export const CONNECT_WEARABLE_SEARCH_LABEL = 'Searching for wearable...'

export const CONNECT_WEARABLE_ERROR_LABEL = 'Wearable unavailable. Phone mode active.'

/**
 * Restore session without discover UI — used on panel remount when already connected.
 */
export async function silentReconnectWearable(runtime: WalRuntime): Promise<boolean> {
  const saved = loadWalConnectionState()
  if (!saved.connected || saved.activeAdapterIds.length === 0) return false

  try {
    const attachResult = await runtime.attachDevice({
      type: 'phone_only',
      capabilities: [],
      mode: 'balanced',
      adapterIds: saved.activeAdapterIds,
    })
    if (!attachResult.ok) return false
    await runtime.stabilizeConnection()
    return true
  } catch {
    return false
  }
}
