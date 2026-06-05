/**
 * Authoritative wearable pipeline: WAL → DCRL (shape) → WCEL (block) → send.
 * DCRL never blocks. WCEL is the only blocking authority.
 */

import type { EscalationProjection, EscalationState, OutputChannelKind } from '../wal/types'
import { validateEscalationProjection } from '../wcel/validate'
import type { WcelViolation } from '../wcel/types'
import {
  createWatchRestrictedFallbackProfile,
  getDeviceCapability,
  resolveDeviceIdForChannel,
} from './capability'
import type { DcrlDeviceType } from './types'
import { channelOwnerDevice } from './throttle'

export type WearableOutboundPayload = {
  status?: string
  summary?: string
  alertLevel?: string
  timestamp?: number
  directionHint?: string
  alert?: string
  title?: string
  body?: string
  urgency?: EscalationProjection['urgency']
  state?: EscalationState
}

export type SafeProjectResult =
  | { blocked: true; reason: string; details?: WcelViolation[] }
  | { blocked: false; sent: boolean; reason?: string }

export type SendToDeviceResult = { ok: boolean; reason?: string }

export type SendToDeviceHandler = (
  deviceId: string,
  payload: WearableOutboundPayload,
  channel: OutputChannelKind,
  projection: EscalationProjection,
) => Promise<SendToDeviceResult>

let sendHandlerOverride: SendToDeviceHandler | null = null
let fallbackLogged = false
let wcelEnforcementAvailable = true

export function _setSendToDeviceHandlerForTests(handler: SendToDeviceHandler | null): void {
  sendHandlerOverride = handler
}

export function _setWcelEnforcementAvailableForTests(available: boolean): void {
  wcelEnforcementAvailable = available
}

export function _resetSafeProjectForTests(): void {
  sendHandlerOverride = null
  fallbackLogged = false
  wcelEnforcementAvailable = true
}

export function isWcelEnforcementAvailable(): boolean {
  return wcelEnforcementAvailable
}

function logDcrlFallback(): void {
  if (fallbackLogged) return
  fallbackLogged = true
  try {
    if (typeof console !== 'undefined') {
      console.warn('[hud-dcrl] dcrl_missing_fallback_safe_mode')
    }
  } catch {
    /* ignore */
  }
}

const WATCH_DEGRADED_PAYLOAD: WearableOutboundPayload = {
  status: 'degraded',
  summary: 'Limited connection',
  alertLevel: 'warning',
  timestamp: Date.now(),
}

export function escalationToWearablePayload(projection: EscalationProjection): WearableOutboundPayload {
  return {
    status: projection.state,
    summary: projection.body,
    alertLevel: projection.urgency,
    timestamp: Date.now(),
    title: projection.title,
    body: projection.body,
    urgency: projection.urgency,
    state: projection.state,
  }
}

/** DCRL contract shaping — transforms only, never blocks. */
export function throttleWearablePayload(
  deviceType: DcrlDeviceType,
  payload: WearableOutboundPayload,
): WearableOutboundPayload {
  if (deviceType === 'watch') {
    return {
      status: payload.status ?? 'ok',
      summary: payload.summary ?? 'Status update',
      alertLevel: payload.alertLevel ?? 'info',
      timestamp: Date.now(),
    }
  }

  if (deviceType === 'glasses') {
    return {
      directionHint: payload.directionHint,
      alert: payload.alert,
    }
  }

  if (deviceType === 'ring') {
    return {}
  }

  return payload
}

/**
 * DCRL capability shaping — downgrade/strip/format only.
 * Missing registry → watch-restricted safe mode (never throws or blocks).
 */
export function applyDcrlShaping(
  deviceId: string,
  payload: WearableOutboundPayload,
  channel: OutputChannelKind,
): WearableOutboundPayload {
  const deviceType = channelOwnerDevice(channel)
  if (deviceType === 'phone') return payload

  let profile = getDeviceCapability(deviceId)
  if (!profile) {
    logDcrlFallback()
    profile = createWatchRestrictedFallbackProfile(deviceId)
    return { ...WATCH_DEGRADED_PAYLOAD, timestamp: Date.now() }
  }

  let working: WearableOutboundPayload = { ...payload }

  if (
    (profile.state.connected === false || profile.derived.isUnavailable) &&
    profile.deviceType === 'watch'
  ) {
    working = { ...WATCH_DEGRADED_PAYLOAD, timestamp: Date.now() }
  } else if (profile.derived.isUnavailable && profile.deviceType === 'glasses') {
    working = {
      directionHint: payload.directionHint,
      alert: payload.alert ?? 'caution',
    }
  }

  if (profile.derived.isThrottled && profile.deviceType !== 'watch' && profile.deviceType !== 'glasses') {
    working = throttleWearablePayload(profile.deviceType, working)
  }

  return throttleWearablePayload(deviceType, working)
}

export function wearablePayloadToProjection(
  payload: WearableOutboundPayload,
  channel: OutputChannelKind,
  base: EscalationProjection,
): EscalationProjection {
  if (payload.directionHint != null || payload.alert != null) {
    const hint = payload.directionHint ?? payload.alert ?? 'alert'
    return {
      ...base,
      title: hint.slice(0, 16),
      body: (payload.alert ?? hint).slice(0, 32),
      channels: [channel],
    }
  }

  const summary = payload.summary ?? payload.body ?? base.body
  const title = payload.summary ?? payload.title ?? base.title
  return {
    ...base,
    title: title.slice(0, 64),
    body: summary.slice(0, 180),
    channels: [channel],
  }
}

/** WCEL wrapper — sole blocking authority; internals unchanged. */
export function enforceWearableProjection(
  channel: OutputChannelKind,
  projection: EscalationProjection,
): { allowed: boolean; violations: WcelViolation[] } {
  if (!wcelEnforcementAvailable) {
    return {
      allowed: false,
      violations: [
        {
          code: 'unknown_channel',
          device: channelOwnerDevice(channel),
          channel,
          message: 'wcel enforcement unavailable — fail closed',
        },
      ],
    }
  }
  const scoped: EscalationProjection = { ...projection, channels: [channel] }
  const result = validateEscalationProjection(scoped)
  return {
    allowed: result.verdict === 'allow',
    violations: result.violations,
  }
}

async function defaultSendToDevice(
  _deviceId: string,
  payload: WearableOutboundPayload,
  channel: OutputChannelKind,
  projection: EscalationProjection,
): Promise<SendToDeviceResult> {
  if (channel !== 'watch_notification') {
    return { ok: false, reason: 'unsupported_channel' }
  }
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return { ok: false, reason: 'notification_unavailable' }
  }

  const title = payload.title ?? payload.summary ?? projection.title
  const body = payload.body ?? payload.summary ?? projection.body
  const tag = 'signal-one-wal-escalation'

  try {
    if ('serviceWorker' in navigator && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification(title, {
        body,
        tag,
        icon: '/hud-icon-192.png',
      })
      return { ok: true }
    }
  } catch {
    /* fallback */
  }

  try {
    if (Notification.permission === 'granted') {
      new Notification(title, { body, tag })
      return { ok: true }
    }
  } catch {
    /* ignore */
  }

  return { ok: false, reason: 'notification_not_granted' }
}

async function sendToDevice(
  deviceId: string,
  payload: WearableOutboundPayload,
  channel: OutputChannelKind,
  projection: EscalationProjection,
): Promise<SendToDeviceResult> {
  const handler = sendHandlerOverride ?? defaultSendToDevice
  return handler(deviceId, payload, channel, projection)
}

/**
 * Single wearable dispatch entry — DCRL shape → WCEL block → send.
 */
export async function safeProjectToWearable(
  deviceId: string,
  payload: WearableOutboundPayload,
  channel: OutputChannelKind,
  baseProjection: EscalationProjection,
): Promise<SafeProjectResult> {
  if (!isWcelEnforcementAvailable()) {
    return { blocked: true, reason: 'wcel_unavailable' }
  }

  const shaped = applyDcrlShaping(deviceId, payload, channel)
  const projection = wearablePayloadToProjection(shaped, channel, baseProjection)
  const wcel = enforceWearableProjection(channel, projection)
  if (!wcel.allowed) {
    return { blocked: true, reason: 'wcel_violation', details: wcel.violations }
  }

  const sent = await sendToDevice(deviceId, shaped, channel, projection)
  return { blocked: false, sent: sent.ok, reason: sent.reason }
}

export async function safeProjectEscalationToChannel(
  projection: EscalationProjection,
  channel: OutputChannelKind,
): Promise<SafeProjectResult> {
  const deviceId = resolveDeviceIdForChannel(channel)
  const payload = escalationToWearablePayload(projection)
  return safeProjectToWearable(deviceId, payload, channel, projection)
}
