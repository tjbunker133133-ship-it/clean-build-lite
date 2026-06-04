/**
 * Lightweight mission operational telemetry — lifecycle/transport transitions only.
 * No message content, location history, or user-identifying fields.
 */

export type MissionOperationalEventKind =
  | 'link_recovery_start'
  | 'link_recovery_complete_mesh'
  | 'link_recovery_complete_relay'
  | 'link_recovery_timeout'
  | 'relay_degraded'
  | 'relay_unavailable'
  | 'wake_lock_lost'
  | 'wake_lock_recovered'
  | 'visibility_background'
  | 'visibility_foreground'
  | 'mission_restore'

export type MissionOperationalEvent = {
  ts: number
  kind: MissionOperationalEventKind
  /** Short operational detail — never PII or message content. */
  detail?: string
}

const MAX_EVENTS = 20
let events: MissionOperationalEvent[] = []

export function recordMissionOperationalEvent(
  kind: MissionOperationalEventKind,
  detail?: string,
): void {
  const clean = detail?.trim().slice(0, 120)
  events = [...events, { ts: Date.now(), kind, detail: clean || undefined }].slice(-MAX_EVENTS)
  if (import.meta.env.DEV) {
    console.info('[MISSION-OPS]', kind, clean ?? '')
  }
}

export function getMissionOperationalEvents(): readonly MissionOperationalEvent[] {
  return events
}

/** Test-only reset. */
export function _resetMissionOperationalEventsForTests(): void {
  events = []
}
