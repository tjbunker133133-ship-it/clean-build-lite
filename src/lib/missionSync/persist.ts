import type { MissionSyncPersistedSession } from './types'

const DEVICE_ID_KEY = 'hud_mission_device_id_v1'
const SESSION_KEY = 'hud_mission_sync_session_v1'

export function loadOrCreateDeviceId(): string {
  if (typeof localStorage === 'undefined') {
    return `dev_${Date.now().toString(36)}`
  }
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY)
    if (existing && existing.length >= 8) return existing
    const id = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    localStorage.setItem(DEVICE_ID_KEY, id)
    return id
  } catch {
    return `tab_${Date.now().toString(36)}`
  }
}

export function loadMissionSession(): MissionSyncPersistedSession | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as MissionSyncPersistedSession
    if (!parsed?.missionId || !parsed.deviceId) return null
    return parsed
  } catch {
    return null
  }
}

export function saveMissionSession(session: MissionSyncPersistedSession | null): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (!session) {
      localStorage.removeItem(SESSION_KEY)
      return
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    /* quota */
  }
}
