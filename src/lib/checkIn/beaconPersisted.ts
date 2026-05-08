const BEACON_KEY = 'hud_checkin_beacon_v1'

export const BEACON_INTERVAL_CHOICES = [15, 30, 60, 120] as const

export type BeaconPersistedState = {
  active: boolean
  paused: boolean
  intervalMinutes: (typeof BEACON_INTERVAL_CHOICES)[number]
}

export function normalizeBeaconInterval(m: number): BeaconPersistedState['intervalMinutes'] {
  return (BEACON_INTERVAL_CHOICES as readonly number[]).includes(m)
    ? (m as BeaconPersistedState['intervalMinutes'])
    : 30
}

export function loadBeacon(): BeaconPersistedState {
  try {
    const raw = localStorage.getItem(BEACON_KEY)
    if (!raw) return { active: false, paused: false, intervalMinutes: 30 }
    const o = JSON.parse(raw) as Partial<BeaconPersistedState>
    return {
      active: Boolean(o.active),
      paused: Boolean(o.paused),
      intervalMinutes: normalizeBeaconInterval(Number(o.intervalMinutes) || 30),
    }
  } catch {
    return { active: false, paused: false, intervalMinutes: 30 }
  }
}

export function saveBeacon(s: BeaconPersistedState): void {
  try {
    localStorage.setItem(BEACON_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

export function notifyBeaconPersistedChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent('hud:checkin-beacon-sync'))
  } catch {
    /* noop */
  }
}
