/**
 * Rescue dispatch endpoint resolver (SOS / Deadman / Check-in).
 *
 * CONTRACT: all rescue traffic MUST target `send-rescue-email` only.
 * Legacy `rapid-endpoint` URLs in env or localStorage are ignored.
 */

export const SEND_RESCUE_EMAIL_PATH = '/functions/v1/send-rescue-email'

export type RescueEndpointSource =
  | 'vite_rescue_email_url'
  | 'derived_supabase_url'
  | 'vite_rapid_endpoint_url'
  | 'local_storage_heartbeat'
  | 'none'

export type ResolvedRescueEndpoint = {
  url: string
  source: RescueEndpointSource
}

function readViteEnv(name: string): string {
  return (
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name] ?? ''
  ).trim()
}

/** True when URL pathname is the canonical send-rescue-email function. */
export function isSendRescueEmailEndpoint(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  try {
    const pathname = new URL(trimmed).pathname.replace(/\/+$/, '')
    return pathname === SEND_RESCUE_EMAIL_PATH || pathname.endsWith(SEND_RESCUE_EMAIL_PATH)
  } catch {
    return false
  }
}

export function deriveSendRescueEmailUrl(supabaseProjectUrl: string): string {
  const base = supabaseProjectUrl.trim().replace(/\/+$/, '')
  if (!base) return ''
  return `${base}${SEND_RESCUE_EMAIL_PATH}`
}

function readHeartbeatFnUrlFromLocalStorage(): string {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key) continue
      const value = localStorage.getItem(key)
      if (!value) continue
      try {
        const parsed = JSON.parse(value) as { heartbeatFnUrl?: unknown }
        if (typeof parsed?.heartbeatFnUrl === 'string' && parsed.heartbeatFnUrl.trim()) {
          return parsed.heartbeatFnUrl.trim()
        }
      } catch {
        // noop
      }
    }
  } catch {
    // noop
  }
  return ''
}

/**
 * Resolves the rescue email edge function URL and records which source won.
 * Exported for diagnostics; production dispatch uses `resolveRapidEndpoint()`.
 */
export function resolveRapidEndpointMeta(): ResolvedRescueEndpoint {
  const rescue = readViteEnv('VITE_RESCUE_EMAIL_URL')
  if (isSendRescueEmailEndpoint(rescue)) {
    return { url: rescue, source: 'vite_rescue_email_url' }
  }

  const derived = deriveSendRescueEmailUrl(readViteEnv('VITE_SUPABASE_URL'))
  if (isSendRescueEmailEndpoint(derived)) {
    return { url: derived, source: 'derived_supabase_url' }
  }

  const rapid = readViteEnv('VITE_RAPID_ENDPOINT_URL')
  if (isSendRescueEmailEndpoint(rapid)) {
    return { url: rapid, source: 'vite_rapid_endpoint_url' }
  }

  const heartbeat = readHeartbeatFnUrlFromLocalStorage()
  if (isSendRescueEmailEndpoint(heartbeat)) {
    return { url: heartbeat, source: 'local_storage_heartbeat' }
  }

  return { url: '', source: 'none' }
}

export function resolveRapidEndpoint(): string {
  return resolveRapidEndpointMeta().url
}
