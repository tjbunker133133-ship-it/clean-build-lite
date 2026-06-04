import type { MissionSyncConnectionPhase, MissionSyncRole } from './types'

export type MissionMonitorTransport = 'idle' | 'direct' | 'relay' | 'both'

/** Observer receiving mission data (direct WebRTC and/or internet relay). */
export function isMonitorSessionLive(args: {
  role: MissionSyncRole
  phase: MissionSyncConnectionPhase
  peerCount: number
  monitorTransport: MissionMonitorTransport
  lastSyncAt: number | null
  nowMs?: number
}): boolean {
  if (args.role !== 'observer') return false
  const now = args.nowMs ?? Date.now()
  const recentSync = args.lastSyncAt != null && now - args.lastSyncAt < 45_000
  const direct = args.peerCount > 0 && args.phase === 'connected'
  const relay =
    args.monitorTransport === 'relay' || args.monitorTransport === 'both'
  return recentSync && (direct || relay)
}
