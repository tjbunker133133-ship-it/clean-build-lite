import type { RescuePacket } from './buildRescuePacket'
import {
  buildRescueDispatchHeaders,
  logRescueDispatchTrace,
  parseRescueDispatchFailure,
  type RescueDispatchFailure,
} from './rescueDispatch'

export type RescueDispatchLabel = 'SOS' | 'DEADMAN' | 'CHECKIN'

export type PostRescuePacketResult =
  | { ok: true; status: number }
  | { ok: false; reason: 'http_error'; failure: RescueDispatchFailure }
  | { ok: false; reason: 'network_error' }

/** POST a signed rescue packet to the configured edge function. */
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
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: buildRescueDispatchHeaders(),
      body: JSON.stringify(packet),
      signal,
    })
    if (res.ok) return { ok: true, status: res.status }
    const failure = await parseRescueDispatchFailure(res, triggerLabel)
    return { ok: false, reason: 'http_error', failure }
  } catch (e: unknown) {
    if ((e as { name?: string })?.name === 'AbortError') {
      throw e
    }
    return { ok: false, reason: 'network_error' }
  }
}
