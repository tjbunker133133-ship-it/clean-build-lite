/**
 * Dispatches routine check-ins only — no SOS / rescue / `buildRescuePacket` path.
 *
 * Configure outbound delivery (pick one):
 * - `VITE_CHECKIN_WEBHOOK_URL` — POST JSON body (`RoutineCheckInPayload`).
 * - Supabase table `check_in_events` (insert) when webhook is unset and Supabase is configured.
 */
import { supabase } from '../supabase'
import type { RoutineCheckInPayload } from './routineCheckInTypes'

export type SubmitRoutineCheckInResult = { ok: true } | { ok: false; error: string }

function webhookUrl(): string | null {
  const u = (import.meta as ImportMeta & { env?: { VITE_CHECKIN_WEBHOOK_URL?: string } }).env
    ?.VITE_CHECKIN_WEBHOOK_URL
  const t = typeof u === 'string' ? u.trim() : ''
  return t.length > 0 ? t : null
}

async function postWebhook(payload: RoutineCheckInPayload): Promise<SubmitRoutineCheckInResult> {
  const url = webhookUrl()
  if (!url) return { ok: false, error: 'no_webhook_url' }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      mode: 'cors',
    })
    if (!res.ok) return { ok: false, error: `webhook_http_${res.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'webhook_network' }
  }
}

async function insertSupabaseRow(payload: RoutineCheckInPayload): Promise<SubmitRoutineCheckInResult> {
  if (!supabase) return { ok: false, error: 'no_supabase' }
  try {
    const { error } = await supabase.from('check_in_events').insert({
      sent_at: new Date(payload.sentAt).toISOString(),
      kind: payload.kind,
      lat: payload.lat,
      lng: payload.lng,
      accuracy_m: payload.accuracyM,
      elevation_m: payload.elevationM,
      message: payload.message,
      contacts_json: payload.contacts,
      schema: payload.schema,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'supabase_insert_throw' }
  }
}

export async function submitRoutineCheckIn(
  payload: RoutineCheckInPayload,
): Promise<SubmitRoutineCheckInResult> {
  const hook = webhookUrl()
  if (hook) return postWebhook(payload)
  return insertSupabaseRow(payload)
}
