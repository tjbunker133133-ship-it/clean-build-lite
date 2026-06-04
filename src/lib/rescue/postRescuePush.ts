import type { RescuePacket } from './buildRescuePacket'
import { buildRescueDispatchHeaders } from './rescueDispatch'
import { resolveRescuePushEndpoint } from '../push/webPushConfig'
import { loadAlertWatchToken } from '../push/alertWatchToken'

export type RescuePushDispatchResult =
  | { ok: true; status: number; sentCount?: number }
  | { ok: false; reason: 'skipped' | 'network_error' | 'http_error'; status?: number }

export function formatRescuePushSuffix(push?: RescuePushDispatchResult): string {
  if (!push || !push.ok) return ''
  if (typeof push.sentCount === 'number' && push.sentCount > 0) {
    return ` (+ push ×${push.sentCount})`
  }
  return ''
}

/** Best-effort Web Push dispatch — never throws. Skips when push URL or watch token missing. */
export async function postRescuePushBestEffort(
  packet: RescuePacket,
  signal?: AbortSignal,
): Promise<RescuePushDispatchResult> {
  const endpoint = resolveRescuePushEndpoint()
  const token = packet.alertWatchToken ?? loadAlertWatchToken()
  if (!endpoint || !token || !packet.signature) {
    return { ok: false, reason: 'skipped' }
  }
  const body = { ...packet, alertWatchToken: token }
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: buildRescueDispatchHeaders(),
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) return { ok: false, reason: 'http_error', status: res.status }
    let sentCount: number | undefined
    try {
      const json = (await res.json()) as { sentCount?: number }
      if (typeof json.sentCount === 'number') sentCount = json.sentCount
    } catch {
      /* ignore */
    }
    return { ok: true, status: res.status, sentCount }
  } catch (e: unknown) {
    if ((e as { name?: string })?.name === 'AbortError') throw e
    return { ok: false, reason: 'network_error' }
  }
}
