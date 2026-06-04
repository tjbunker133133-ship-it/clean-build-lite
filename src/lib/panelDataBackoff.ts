/** Shared cooldown after Open-Meteo / Nominatim HTTP 429 (field tablets share one IP). */

const DEFAULT_BACKOFF_MS = 15 * 60_000
let openMeteoBackoffUntilMs = 0

export function recordOpenMeteoRateLimit(backoffMs = DEFAULT_BACKOFF_MS, nowMs = Date.now()): void {
  openMeteoBackoffUntilMs = Math.max(openMeteoBackoffUntilMs, nowMs + backoffMs)
}

export function isOpenMeteoBackoffActive(nowMs = Date.now()): boolean {
  return nowMs < openMeteoBackoffUntilMs
}

export function openMeteoBackoffRemainingMs(nowMs = Date.now()): number {
  return Math.max(0, openMeteoBackoffUntilMs - nowMs)
}

export function clearOpenMeteoBackoff(): void {
  openMeteoBackoffUntilMs = 0
}
