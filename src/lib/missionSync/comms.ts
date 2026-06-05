import type { MissionBurst, MissionCheckIn } from './types'
import type { TeamBurstTarget } from './teamComms'

export const BURST_MAX_CHARS = 120
export const BURST_MIN_INTERVAL_MS = 2_000
export const CHECKIN_MIN_INTERVAL_MS = 5_000
/** Rolling mission message log window (60 minutes). */
export const TEAM_MESSAGE_STALE_MS = 3_600_000
export const MISSION_BURST_LOG_MAX = 100

export function sanitizeBurstText(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  return trimmed.slice(0, BURST_MAX_CHARS)
}

export function isBurstValid(text: string): boolean {
  const s = sanitizeBurstText(text)
  return s.length > 0 && s.length <= BURST_MAX_CHARS
}

export function buildCheckIn(
  deviceId: string,
  callsign: string,
  note?: string,
): MissionCheckIn {
  const cleanNote = note ? sanitizeBurstText(note).slice(0, 48) : undefined
  return {
    deviceId,
    callsign,
    note: cleanNote || undefined,
    sentAt: Date.now(),
  }
}

export function buildBurst(
  deviceId: string,
  callsign: string,
  text: string,
  target?: TeamBurstTarget,
): MissionBurst | null {
  const body = sanitizeBurstText(text)
  if (!body) return null
  const burst: MissionBurst = {
    deviceId,
    callsign,
    text: body,
    sentAt: Date.now(),
  }
  if (target?.scope === 'direct') {
    burst.toDeviceId = target.deviceId
    burst.toCallsign = target.callsign
  }
  return burst
}

export function filterFreshCheckIns(items: MissionCheckIn[], nowMs = Date.now()): MissionCheckIn[] {
  const byDevice = new Map<string, MissionCheckIn>()
  for (const c of items) {
    if (nowMs - c.sentAt > TEAM_MESSAGE_STALE_MS) continue
    const cur = byDevice.get(c.deviceId)
    if (!cur || c.sentAt > cur.sentAt) byDevice.set(c.deviceId, c)
  }
  return [...byDevice.values()].sort((a, b) => b.sentAt - a.sentAt)
}

export function filterRecentBursts(items: MissionBurst[], nowMs = Date.now()): MissionBurst[] {
  return items
    .filter((b) => nowMs - b.sentAt <= TEAM_MESSAGE_STALE_MS)
    .sort((a, b) => b.sentAt - a.sentAt)
    .slice(0, MISSION_BURST_LOG_MAX)
}
