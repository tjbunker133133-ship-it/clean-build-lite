/**
 * Shared transport helpers for SOS / Deadman POST to the rescue edge function.
 * Does not build or sign packets — only HTTP headers and operator-facing errors.
 */

import { tier1Debug } from '../tier1DebugLog'
import { appendRescuePipelineTrace } from './rescuePipelineTrace'

function readAnonKey(override?: string): string {
  const fromEnv = (
    import.meta as unknown as { env?: Record<string, string | undefined> }
  ).env?.VITE_SUPABASE_ANON_KEY?.trim()
  return (override ?? fromEnv ?? '').trim()
}

/** For diagnostics only — never log the raw key. */
export type RescueDispatchKeyKind = 'none' | 'jwt' | 'publishable' | 'secret' | 'other'

export function classifyRescueDispatchKey(key: string): RescueDispatchKeyKind {
  if (!key) return 'none'
  if (key.startsWith('eyJ')) return 'jwt'
  if (key.startsWith('sb_publishable_')) return 'publishable'
  if (key.startsWith('sb_secret_')) return 'secret'
  return 'other'
}

export function buildRescueDispatchHeaders(anonKeyOverride?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const anonKey = readAnonKey(anonKeyOverride)
  if (!anonKey) return headers

  headers.apikey = anonKey
  // Publishable/secret API keys are not JWTs — Bearer triggers UNAUTHORIZED_INVALID_JWT_FORMAT.
  // Rescue packets are authenticated by HMAC inside send-rescue-email (verify_jwt should be off).
  const keyKind = classifyRescueDispatchKey(anonKey)
  if (keyKind === 'jwt') {
    headers.Authorization = `Bearer ${anonKey}`
  } else {
    tier1Debug('rescue', 'dispatch auth: apikey only (non-JWT Supabase key)')
  }
  return headers
}

export function hasRescueDispatchAuth(anonKeyOverride?: string): boolean {
  return readAnonKey(anonKeyOverride).length > 0
}

/** Debug-only dispatch trace (no PII). */
export function logRescueDispatchTrace(input: {
  triggerLabel: 'SOS' | 'DEADMAN' | 'CHECKIN'
  endpoint: string
  triggerType: string
  hasOperator: boolean
  signed: boolean
}): void {
  let endpointHost = ''
  let endpointPath = ''
  try {
    const u = new URL(input.endpoint)
    endpointHost = u.host
    endpointPath = u.pathname
  } catch {
    endpointPath = '(invalid-url)'
  }
  appendRescuePipelineTrace({
    runId: 'dispatch',
    hypothesisId: 'B',
    location: 'rescueDispatch.ts:logRescueDispatchTrace',
    message: 'rescue POST dispatch',
    data: {
      triggerLabel: input.triggerLabel,
      endpointHost,
      endpointPath,
      isSendRescueEmailPath: endpointPath.includes('send-rescue-email'),
      triggerType: input.triggerType,
      hasOperator: input.hasOperator,
      signed: input.signed,
    },
  })
}

export type RescueDispatchFailure = {
  status: number
  code: string | null
  operatorMessage: string
}

function normalizeRescueErrorCode(body: { code?: unknown; error?: unknown }): string | null {
  if (typeof body?.code === 'string') return body.code
  if (typeof body?.error === 'string') {
    // Legacy deployed send-rescue-email responses used `error` instead of `code`.
    const legacy = body.error.toLowerCase()
    if (legacy === 'missing_signature' || legacy === 'invalid_signature') {
      return 'INVALID_SIGNATURE'
    }
    return body.error
  }
  return null
}

export async function parseRescueDispatchFailure(
  res: Response,
  triggerLabel: 'SOS' | 'DEADMAN' | 'CHECKIN',
): Promise<RescueDispatchFailure> {
  let code: string | null = null
  try {
    const body = (await res.json()) as { code?: unknown; error?: unknown }
    code = normalizeRescueErrorCode(body)
  } catch {
    // non-JSON error body
  }

  if (res.status === 401 && code === 'INVALID_SIGNATURE') {
    return {
      status: 401,
      code,
      operatorMessage: `${triggerLabel} SEND FAILED (SIGNING KEY MISMATCH)`,
    }
  }
  if (res.status === 401 && code === 'UNAUTHORIZED_INVALID_JWT_FORMAT') {
    return {
      status: 401,
      code,
      operatorMessage: `${triggerLabel} SEND FAILED (SUPABASE KEY FORMAT — USE APIKEY ONLY)`,
    }
  }
  if (res.status === 401 && !hasRescueDispatchAuth()) {
    return {
      status: 401,
      code: code ?? 'MISSING_ANON_KEY',
      operatorMessage: `${triggerLabel} SEND FAILED (MISSING SUPABASE KEY)`,
    }
  }
  if (res.status === 401) {
    return {
      status: 401,
      code: code ?? 'UNAUTHORIZED',
      operatorMessage: `${triggerLabel} SEND FAILED (AUTH ${res.status})`,
    }
  }

  return {
    status: res.status,
    code,
    operatorMessage: `${triggerLabel} SEND FAILED (${res.status})`,
  }
}
