import { DEFAULT_MISSION_SESSION, type MissionSession } from './types'

const MISSION_KEY = 'hud_mission_controller_v1'

export function loadMissionSession(): MissionSession {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_MISSION_SESSION }
  try {
    const raw = localStorage.getItem(MISSION_KEY)
    if (!raw) return { ...DEFAULT_MISSION_SESSION }
    const parsed = JSON.parse(raw) as Partial<MissionSession>
    return {
      ...DEFAULT_MISSION_SESSION,
      ...parsed,
      gps: { ...DEFAULT_MISSION_SESSION.gps, ...parsed.gps },
      environment: { ...DEFAULT_MISSION_SESSION.environment, ...parsed.environment },
      waypoints: Array.isArray(parsed.waypoints) ? parsed.waypoints : [],
      activeWaypointIds: Array.isArray(parsed.activeWaypointIds) ? parsed.activeWaypointIds : [],
    }
  } catch {
    return { ...DEFAULT_MISSION_SESSION }
  }
}

export function saveMissionSession(session: MissionSession): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(MISSION_KEY, JSON.stringify(session))
  } catch {
    /* quota */
  }
}

export function clearMissionSessionStorage(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(MISSION_KEY)
  } catch {
    /* ignore */
  }
}
