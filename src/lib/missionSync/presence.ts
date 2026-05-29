import type { TeamPresence } from './types'

/** Drop stale fixes so map markers do not linger. */
export const PRESENCE_STALE_MS = 90_000

export function isPresenceFixValid(p: TeamPresence): boolean {
  if (p.lat == null || p.lng == null) return false
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false
  if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return false
  return true
}

export function isPresenceFresh(p: TeamPresence, nowMs = Date.now()): boolean {
  return nowMs - p.updatedAt <= PRESENCE_STALE_MS
}

export function filterTeammatePresence(
  all: TeamPresence[],
  selfDeviceId: string,
  nowMs = Date.now(),
): TeamPresence[] {
  const byDevice = new Map<string, TeamPresence>()
  for (const p of all) {
    if (p.deviceId === selfDeviceId) continue
    if (!isPresenceFixValid(p) || !isPresenceFresh(p, nowMs)) continue
    const cur = byDevice.get(p.deviceId)
    if (!cur || p.updatedAt > cur.updatedAt) byDevice.set(p.deviceId, p)
  }
  return [...byDevice.values()]
}
