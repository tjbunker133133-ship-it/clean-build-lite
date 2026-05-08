import { loadBeacon, saveBeacon, notifyBeaconPersistedChanged } from './beaconPersisted'

export type VoiceBeaconAction = 'start' | 'stop'

export function applyVoiceBeaconAction(action: VoiceBeaconAction): { ok: boolean; message: string } {
  const cur = loadBeacon()
  if (action === 'start') {
    saveBeacon({ ...cur, active: true, paused: false })
    notifyBeaconPersistedChanged()
    return { ok: true, message: 'Beacon started.' }
  }
  saveBeacon({ ...cur, active: false, paused: false })
  notifyBeaconPersistedChanged()
  return { ok: true, message: 'Beacon stopped.' }
}
