/**
 * Shared rescue dispatch payload builder.
 *
 * Pure async, single side effect: ONE call to `fetchEmergencyContacts()`.
 * No timers, no subscriptions, no polling, no sending. Both the SOS
 * slide-success path and the Deadman timeout path call this to produce a
 * normalized packet for the rescue endpoint.
 *
 * Coordinate source: the existing GPS persistence layer
 * (`localStorage['lastKnownLocation']`, written by `useGPS.persistCurrentFix`).
 * No new GPS logic is introduced. Returns null when no fix is available so
 * callers degrade gracefully.
 *
 * Signing: when `VITE_RESCUE_SIGNING_KEY` is configured at build time, the
 * builder appends an HMAC-SHA256 signature over the canonicalized packet
 * fields. The edge function rejects any packet without a valid signature
 * (strict mode — no legacy unsigned support). Both SOS and Deadman receive
 * the same signed shape automatically; neither panel needs to change.
 */

import { fetchEmergencyContacts } from '../emergencyContacts'

export type RescueTriggerType = 'SOS' | 'DEADMAN'

export type RescueContactPair = {
  name: string
  email: string
}

export type RescueCoordinates = {
  lat: number
  lng: number
}

export type RescuePacket = {
  triggerType: RescueTriggerType
  timestamp: string
  coordinates: RescueCoordinates | null
  contacts: RescueContactPair[]
  source: 'tactical-hud'
  /**
   * HMAC-SHA256(canonicalJSON(rest), VITE_RESCUE_SIGNING_KEY), hex-encoded.
   * Optional in the type so a missing build-time key does not turn into a
   * frontend exception; the server side still rejects when absent.
   */
  signature?: string
}

/**
 * Safe structured summary for DEV-only diagnostics. Never log raw packets:
 * contacts (PII), coordinates (precise position), and signature hex must not
 * appear on operator consoles, screen recordings, or shared debug sessions.
 */
export function rescuePacketDevLogSummary(packet: RescuePacket): Record<string, unknown> {
  return {
    triggerType: packet.triggerType,
    contactCount: packet.contacts.length,
    hasCoordinates: packet.coordinates != null,
    signed: Boolean(packet.signature && packet.signature.length > 0),
    timestamp: packet.timestamp,
    source: packet.source,
  }
}

const LAST_KNOWN_LOCATION_KEY = 'lastKnownLocation'

/**
 * Deterministic JSON canonicalization with sorted keys at every level.
 *
 * Identical bytes are produced on the frontend (browser Web Crypto) and
 * inside the Deno edge function, regardless of how each side built its
 * object. This is what HMAC is computed over. Forward-compatible with the
 * encrypted-contacts shape (where `contacts` is a base64 string instead of
 * an array).
 *
 * CONTRACT-SENSITIVE: this function's byte output must remain identical
 * to `canonicalJSON` in `supabase/functions/send-rescue-email/index.ts`.
 * Any change here without a matching backend change will break HMAC
 * verification for every signed rescue packet. Exported only so the
 * Vitest stability suite can lock its behavior.
 *
 * Note: assumes finite numbers and no `undefined` field values, which is
 * enforced by the surrounding code that constructs the packet.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']'
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k]))
    return '{' + parts.join(',') + '}'
  }
  return 'null'
}

function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 1) {
    s += bytes[i].toString(16).padStart(2, '0')
  }
  return s
}

export async function hmacSha256Hex(key: string, message: string): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null
    const enc = new TextEncoder()
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message))
    return bytesToHex(new Uint8Array(sig))
  } catch {
    return null
  }
}

function readLastKnownCoordinates(): RescueCoordinates | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(LAST_KNOWN_LOCATION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { lat?: unknown; lng?: unknown } | null
    const lat = parsed?.lat
    const lng = parsed?.lng
    if (typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)) {
      return { lat, lng }
    }
    if (import.meta.env.DEV) {
      // Defensive: persisted GPS fix exists but is shape-invalid. Production
      // path still degrades to `coordinates: null` — this DEV-only hint flags
      // the upstream writer drift early.
      console.warn('[rescue] lastKnownLocation present but malformed; coordinates set to null')
    }
    return null
  } catch {
    return null
  }
}

/**
 * CONTRACT-SENSITIVE: produces the exact `RescuePacket` shape that the
 * `send-rescue-email` edge function validates. Field names, ordering of
 * required keys, and signature semantics must remain stable. Both
 * `SOSPanel.launchRescuePacket` and `DeadManPanel.sendDeadmanRescue` rely
 * on this single source of truth — never inline payload construction at
 * the call sites.
 *
 * RELEASE-FREEZE INVARIANT: this function MUST NEVER throw synchronously
 * or asynchronously. Both call sites flip their idempotency gate
 * (`launchSentRef` / `sentRef`) to true BEFORE awaiting this builder. A
 * thrown error here would permanently lock that gate for the current
 * episode and silently suppress rescue dispatch with no visible failure
 * mode. Every internal step is therefore exception-isolated:
 *   - `fetchEmergencyContacts()` rejection → caught, contacts = []
 *   - `readLastKnownCoordinates()` failures → return null internally
 *   - `crypto.subtle` unavailable → `hmacSha256Hex` returns null,
 *     packet is unsigned (edge function rejects with 401, operator sees
 *     visible failure status — the SAFE-DEGRADATION path)
 * Future maintainers: do NOT add validations that throw. Return a
 * minimal-shape unsigned packet on the degraded path instead. The
 * `'safe degradation'` test in `buildRescuePacket.test.ts` locks this.
 */
export async function buildRescuePacket(
  triggerType: RescueTriggerType,
): Promise<RescuePacket> {
  let contacts: RescueContactPair[] = []
  try {
    const { data, error } = await fetchEmergencyContacts()
    if (!error && Array.isArray(data)) {
      contacts = data
        .filter((c) => typeof c?.email === 'string' && c.email.trim().length > 0)
        .map((c) => ({
          name: c.contact_name,
          email: c.email,
        }))
    }
  } catch {
    contacts = []
  }

  const base: RescuePacket = {
    triggerType,
    timestamp: new Date().toISOString(),
    coordinates: readLastKnownCoordinates(),
    contacts,
    source: 'tactical-hud',
  }

  // Build-time-only key. Vite inlines `VITE_*` vars at build, so this is
  // never read at runtime from the user's env. No new state, no React
  // effect, no subscription — one async sign call per dispatch.
  const signingKey = ((import.meta as unknown as { env?: Record<string, string | undefined> })
    .env?.VITE_RESCUE_SIGNING_KEY ?? '').trim()

  if (signingKey.length === 0) {
    if (import.meta.env.DEV) {
      // One-time dev hint; production builds without the key send unsigned
      // packets which the edge function will reject with 401.
      console.warn('[rescue] signing key not configured at build — packet will be unsigned')
    }
    return base
  }

  const canonical = canonicalJSON(base)
  if (import.meta.env.DEV && (typeof canonical !== 'string' || canonical.length === 0)) {
    // Defensive: must be unreachable for any valid `base` we construct
    // above. If it ever fires we want the dev to know before signing.
    console.warn('[rescue] canonicalJSON produced empty output; skipping signature')
    return base
  }
  const signature = await hmacSha256Hex(signingKey, canonical)
  if (!signature) {
    if (import.meta.env.DEV) {
      // Defensive: Web Crypto unavailable or sign() rejected. Production
      // path still returns the unsigned base packet (the edge function
      // will reject with 401 INVALID_SIGNATURE), this DEV-only hint flags
      // the local crypto failure earlier.
      console.warn('[rescue] HMAC signing produced no output; packet will be unsigned')
    }
    return base
  }
  return { ...base, signature }
}
