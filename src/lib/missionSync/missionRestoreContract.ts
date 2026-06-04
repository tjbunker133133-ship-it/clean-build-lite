import type { MissionSyncPersistedSession } from './types'

/** Operator-facing continuity contract — what survives disruption. */
export const MISSION_CONTINUITY_SURVIVES = {
  refresh: [
    'Device identity (localStorage)',
    'Mission id, name, role, join/monitor tokens',
    'Waypoints and trail settings (local app state)',
  ],
  reconnect: [
    'Mission session record — auto-resume on load',
    'Internet relay when tokens + Supabase signaling configured',
    'Wake lock reacquire on foreground return',
  ],
  suspend: [
    'Armed voice intent (bounded recovery)',
    'Mission id/name in storage',
  ],
} as const

export const MISSION_CONTINUITY_REQUIRES_REJOIN = [
  'Fresh join bundle when join token missing or device mismatch',
  'Monitor bundle paste when observer token-only restore and field lead offline',
  'Mesh peer links after long offline — tap Reconnect mesh',
] as const

export type MissionRestoreOutcome =
  | 'none'
  | 'host_restore'
  | 'joiner_restore'
  | 'observer_wait'
  | 'observer_paste'
  | 'device_mismatch'
  | 'corrupt'

export function evaluateMissionRestore(args: {
  session: MissionSyncPersistedSession | null
  deviceId: string
  observerSignalingAvailable: boolean
}): MissionRestoreOutcome {
  const { session, deviceId } = args
  if (!session) return 'none'
  if (!session.missionId || !session.deviceId) return 'corrupt'
  if (session.deviceId !== deviceId) return 'device_mismatch'

  if (session.role === 'observer') {
    if (session.observerToken && session.observerWaitMode && args.observerSignalingAvailable) {
      return 'observer_wait'
    }
    if (session.observerToken) return 'observer_paste'
    return 'observer_paste'
  }

  if (!session.joinToken) return 'corrupt'
  const isHost = !session.hostDeviceId || session.hostDeviceId === session.deviceId
  return isHost ? 'host_restore' : 'joiner_restore'
}

export function missionRestoreGuidance(outcome: MissionRestoreOutcome): string {
  switch (outcome) {
    case 'host_restore':
      return 'Mission restored — reopening join code for teammates'
    case 'joiner_restore':
      return 'Mission restored — rejoin with mission code if mesh is quiet'
    case 'observer_wait':
      return 'Monitor session restored — waiting for field lead. Internet relay resumes when online.'
    case 'observer_paste':
      return 'Monitor session restored — paste a new monitor bundle to reconnect WebRTC, or wait for field lead.'
    case 'device_mismatch':
      return 'Stored mission belongs to another device profile — start a new mission on this device.'
    case 'corrupt':
      return 'Mission storage unreadable — start or join a mission again.'
    default:
      return ''
  }
}
