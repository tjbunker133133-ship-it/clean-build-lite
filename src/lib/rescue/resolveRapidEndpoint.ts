/**
 * Rescue dispatch endpoint resolver (SOS / Deadman / Check-in).
 *
 * CONTRACT-SENSITIVE fallback order:
 *   VITE_RESCUE_EMAIL_URL → VITE_RAPID_ENDPOINT_URL → localStorage `heartbeatFnUrl`
 */
export function resolveRapidEndpoint(): string {
  const rescue = (
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_RESCUE_EMAIL_URL as string | undefined
  )?.trim()
  if (rescue) return rescue
  const env = (
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_RAPID_ENDPOINT_URL as string | undefined
  )?.trim()
  if (env) return env
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
