/**
 * Sync helper for tests — same pipeline as safeProjectToWearable without send.
 * DCRL shapes only; WCEL is the only blocking step.
 */

import type { EscalationProjection, OutputChannelKind } from '../wal/types'
import {
  applyDcrlShaping,
  enforceWearableProjection,
  escalationToWearablePayload,
  isWcelEnforcementAvailable,
  wearablePayloadToProjection,
} from './safeProject'
import { resolveDeviceIdForChannel } from './capability'

export function gateChannelProjectionWithDcrl(
  channel: OutputChannelKind,
  projection: EscalationProjection,
): boolean {
  if (!isWcelEnforcementAvailable()) return false
  const deviceId = resolveDeviceIdForChannel(channel)
  const shaped = applyDcrlShaping(deviceId, escalationToWearablePayload(projection), channel)
  const scoped = wearablePayloadToProjection(shaped, channel, projection)
  return enforceWearableProjection(channel, scoped).allowed
}

export function gateEscalationProjectionWithDcrl(projection: EscalationProjection): boolean {
  for (const channel of projection.channels) {
    if (!gateChannelProjectionWithDcrl(channel, projection)) return false
  }
  return true
}
