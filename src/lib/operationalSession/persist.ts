import { DEFAULT_OPERATIONAL_SESSION, type OperationalSession } from './types'

const SESSION_KEY = 'hud_operational_session_v1'

export function loadOperationalSession(): OperationalSession {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_OPERATIONAL_SESSION }
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return { ...DEFAULT_OPERATIONAL_SESSION }
    const parsed = JSON.parse(raw) as Partial<OperationalSession>
    return {
      ...DEFAULT_OPERATIONAL_SESSION,
      ...parsed,
    }
  } catch {
    return { ...DEFAULT_OPERATIONAL_SESSION }
  }
}

export function saveOperationalSession(session: OperationalSession): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    /* quota */
  }
}
