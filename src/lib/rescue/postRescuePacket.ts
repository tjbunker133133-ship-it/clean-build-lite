import type { RescuePacket } from './buildRescuePacket'
import {
  buildRescueDispatchHeaders,
  logRescueDispatchTrace,
  parseRescueDispatchFailure,
  type RescueDispatchFailure,
} from './rescueDispatch'
import { postRescuePushBestEffort, type RescuePushDispatchResult } from './postRescuePush'

export type RescueDispatchLabel = 'SOS' | 'DEADMAN' | 'CHECKIN'

export type PostRescuePacketResult =
  | { ok: true; status: number; push?: RescuePushDispatchResult }
  | { ok: false; reason: 'http_error'; failure: RescueDispatchFailure; push?: RescuePushDispatchResult }
  | { ok: false; reason: 'network_error'; push?: RescuePushDispatchResult }

/** POST a signed rescue packet to the configured edge function (+ best-effort push). */
export async function postRescuePacket(
  packet: RescuePacket,
  endpoint: string,
  triggerLabel: RescueDispatchLabel,
  signal?: AbortSignal,
): Promise<PostRescuePacketResult> {
  logRescueDispatchTrace({
    triggerLabel,
    endpoint,
    triggerType: packet.triggerType,
    hasOperator: Boolean(packet.operator),
    signed: Boolean(packet.signature),
  })
  const pushPromise = postRescuePushBestEffort(packet, signal)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: buildRescueDispatchHeaders(),
      body: JSON.stringify(packet),
      signal,
    })
    const push = await pushPromise
    if (res.ok) return { ok: true, status: res.status, push }
    const failure = await parseRescueDispatchFailure(res, triggerLabel)
    return { ok: false, reason: 'http_error', failure, push }
  } catch (e: unknown) {
    if ((e as { name?: string })?.name === 'AbortError') {
      throw e
    }
    let push: RescuePushDispatchResult = { ok: false, reason: 'skipped' }
    try {
      push = await pushPromise
    } catch {
      /* ignore */
    }
    return { ok: false, reason: 'network_error', push }
  }
}
