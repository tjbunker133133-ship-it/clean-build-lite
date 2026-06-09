/**
 * Modern-mode rescue dispatch — reuses Tier 1 rescue pipeline without Cockpit/SOSPanel mount.
 * SOSPanel and DeadManPanel remain authoritative in Classic; this bridge serves immersive UI only.
 */

import { buildRescuePacket, rescuePacketDevLogSummary } from './rescue/buildRescuePacket'
import { getRescueEligibility } from './rescue/eligibility'
import { postRescuePacket } from './rescue/postRescuePacket'
import { resolveRapidEndpoint } from './rescue/resolveRapidEndpoint'
import { traceAction } from '../runtime/actionTrace'

export type ModernRescueTrigger = 'SOS' | 'DEADMAN'

export type ModernRescueDispatchResult = {
  ok: boolean
  message: string
  contactCount: number
}

export async function dispatchModernRescue(
  trigger: ModernRescueTrigger,
  options?: { profileOperational?: boolean; signal?: AbortSignal },
): Promise<ModernRescueDispatchResult> {
  traceAction('modern_rescue_dispatch', 'handler_enter', { trigger })

  const packet = await buildRescuePacket(trigger)
  const contactCount = packet.contacts.length
  const endpoint = resolveRapidEndpoint()

  if (import.meta.env.DEV) {
    console.log(`[rescue] Modern ${trigger} (redacted)`, rescuePacketDevLogSummary(packet))
  }

  const eligibility = getRescueEligibility({
    contactCount,
    endpoint,
    profileOperational: options?.profileOperational ?? true,
  })

  if (!eligibility.dispatchReady) {
    const message =
      eligibility.reason === 'profile_incomplete'
        ? 'Rescue blocked — complete tactical profile in preflight'
        : eligibility.reason === 'no_contacts'
          ? 'No emergency contacts configured'
          : eligibility.reason === 'no_endpoint'
            ? `Packet ready (${contactCount} contacts) — no dispatch endpoint`
            : 'Rescue not ready'
    traceAction('modern_rescue_dispatch', 'guard_reject', { trigger, reason: eligibility.reason })
    return { ok: false, message, contactCount }
  }

  try {
    const result = await postRescuePacket(packet, endpoint, trigger, options?.signal)
    if (result.ok) {
      traceAction('modern_rescue_dispatch', 'async_complete', { trigger, contactCount })
      return {
        ok: true,
        message: `Sent to ${contactCount} contact${contactCount === 1 ? '' : 's'}`,
        contactCount,
      }
    }
    const message =
      result.reason === 'http_error'
        ? result.failure.operatorMessage
        : 'Send failed (network)'
    traceAction('modern_rescue_dispatch', 'failure', { trigger, reason: result.reason })
    return { ok: false, message, contactCount }
  } catch (e: unknown) {
    if ((e as { name?: string })?.name === 'AbortError') {
      return { ok: false, message: 'Dispatch cancelled', contactCount }
    }
    traceAction('modern_rescue_dispatch', 'failure', { trigger, reason: 'network_error' })
    return { ok: false, message: 'Send failed (network)', contactCount }
  }
}
