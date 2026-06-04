/**
 * WCEL enforcement gate — blocks invalid wearable projections at the boundary.
 * Does not alter WAL escalation logic; only filters outbound payloads.
 */

import type { EscalationProjection, OutputChannelKind } from '../wal/types'
import { recordWcelEnforcement } from './store'
import { channelToDevice, validateEscalationProjection, validateWearableSignalIngress } from './validate'
import type { WcelValidationResult, WearableDeviceType } from './types'
import type { WearableSignal } from '../wal/types'

function logBlocked(result: WcelValidationResult): void {
  if (result.verdict !== 'block') return
  try {
    if (
      typeof window !== 'undefined' &&
      window.localStorage?.getItem('hud_wcel_debug') === '1'
    ) {
      console.warn('[hud-wcel] blocked projection', result.violations)
    }
  } catch {
    /* ignore */
  }
}

/** Returns true when projection may proceed to wearable output channels. */
export function enforceEscalationProjection(projection: EscalationProjection): boolean {
  const result = validateEscalationProjection(projection)
  const primaryChannel = projection.channels[0] ?? null
  const device = primaryChannel ? channelToDevice(primaryChannel) ?? 'phone' : 'phone'
  recordWcelEnforcement({ device, channel: primaryChannel, result })
  if (result.verdict === 'block') {
    logBlocked(result)
    return false
  }
  return true
}

/** Validate a single channel target before dispatch. */
export function enforceChannelProjection(
  channel: OutputChannelKind,
  projection: EscalationProjection,
): boolean {
  const scoped: EscalationProjection = {
    ...projection,
    channels: [channel],
  }
  const result = validateEscalationProjection(scoped)
  const device = channelToDevice(channel) ?? 'phone'
  recordWcelEnforcement({ device, channel, result })
  if (result.verdict === 'block') {
    logBlocked(result)
    return false
  }
  return true
}

/** Ingress gate — advisory log only; does not drop signals (WAL owns ingest). */
export function auditWearableSignalIngress(
  signal: WearableSignal,
  sourceDevice?: WearableDeviceType,
): WcelValidationResult {
  const device = sourceDevice ?? inferDeviceFromSignal(signal)
  const result = validateWearableSignalIngress(signal, device)
  recordWcelEnforcement({ device, channel: null, result })
  if (result.verdict === 'block') logBlocked(result)
  return result
}

function inferDeviceFromSignal(signal: WearableSignal): WearableDeviceType {
  const s = signal.sourceDevice.toLowerCase()
  if (s.includes('ring')) return 'ring'
  if (s.includes('glass')) return 'glasses'
  if (s.includes('watch')) return 'watch'
  return 'phone'
}
