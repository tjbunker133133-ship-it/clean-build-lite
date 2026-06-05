import type { MissionSyncConnectionPhase, MissionSyncRole } from './types'

/** Interval for host/joiner mesh re-advertise while mission is active but peers are down. */
export const MESH_AUTO_RECONNECT_MS = 20_000

export function shouldAttemptMeshAutoReconnect(args: {
  role: MissionSyncRole
  missionId: string | null
  peerCount: number
  online: boolean
  phase: MissionSyncConnectionPhase
}): boolean {
  if (!args.missionId || args.role !== 'member') return false
  if (!args.online) return false
  if (args.peerCount > 0) return false
  if (args.phase === 'failed' || args.phase === 'idle') return false
  return true
}
