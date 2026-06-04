import { packetFitsCompactQr } from './codec'
import { filterRecentBursts, filterFreshCheckIns } from './comms'
import { isMonitorSessionLive } from './monitorLive'
import { pickMonitoredPresence } from './monitorUx'
import { watchOfferFitsQr } from './monitorInviteUrl'
import type {
  ConnectedPeer,
  MissionBurst,
  MissionCheckIn,
  MissionSyncConnectionPhase,
  MissionSyncRole,
  TeamPresence,
} from './types'
import type { MissionMonitorTransport } from './monitorLive'

export type MissionRelayFlags = {
  missionRelayActive: boolean
  monitorRelayActive: boolean
}

/** Internet relay eligibility — pure, no coordinator ref. */
export function computeMissionRelayFlags(args: {
  missionId: string | null
  observerToken: string
  observerSignalingAvailable: boolean
  role: MissionSyncRole
}): MissionRelayFlags {
  const isFieldMember = args.role === 'member'
  const isObserver = args.role === 'observer'
  const missionRelayActive =
    Boolean(args.missionId && args.observerToken && args.observerSignalingAvailable) &&
    (isFieldMember || isObserver)
  return {
    missionRelayActive,
    monitorRelayActive: isFieldMember && missionRelayActive,
  }
}

export function computeObserverCount(peers: ConnectedPeer[]): number {
  return peers.filter((p) => p.linkRole === 'observer').length
}

export function computeMonitorLive(args: {
  role: MissionSyncRole
  phase: MissionSyncConnectionPhase
  peerCount: number
  monitorTransport: MissionMonitorTransport
  lastSyncAt: number | null
  nowMs?: number
}): boolean {
  return isMonitorSessionLive(args)
}

export function computeMonitoredPresence(
  teamPresence: TeamPresence[],
  deviceId: string,
  monitorHostDeviceId: string | null,
): TeamPresence | null {
  return pickMonitoredPresence(teamPresence, deviceId, monitorHostDeviceId)
}

/** Comms transport ready — mirrors MissionSyncContext teamCommsReady. */
export function computeTeamCommsReady(args: {
  role: MissionSyncRole
  peerCount: number
  missionRelayActive: boolean
  monitorRelayActive: boolean
}): boolean {
  if (args.role !== 'member' && args.role !== 'observer') return false
  const peerReady = args.peerCount > 0
  if (args.role === 'observer') return peerReady || args.missionRelayActive
  return peerReady || args.monitorRelayActive
}

export type FilteredTeamComms = {
  teamCheckIns: MissionCheckIn[]
  teamBursts: MissionBurst[]
}

export function computeFilteredTeamComms(
  teamCheckIns: MissionCheckIn[],
  teamBursts: MissionBurst[],
): FilteredTeamComms {
  return {
    teamCheckIns: filterFreshCheckIns(teamCheckIns),
    teamBursts: filterRecentBursts(teamBursts),
  }
}

export type MissionQrFitFlags = {
  pendingOfferFitsQr: boolean
  pendingAnswerFitsQr: boolean
  pendingObserverOfferFitsQr: boolean
}

export function computeMissionQrFitFlags(args: {
  pendingOfferEncoded: string | null
  pendingAnswerEncoded: string | null
  pendingObserverOfferEncoded: string | null
}): MissionQrFitFlags {
  return {
    pendingOfferFitsQr: args.pendingOfferEncoded
      ? packetFitsCompactQr(args.pendingOfferEncoded)
      : false,
    pendingAnswerFitsQr: args.pendingAnswerEncoded
      ? packetFitsCompactQr(args.pendingAnswerEncoded)
      : false,
    pendingObserverOfferFitsQr: args.pendingObserverOfferEncoded
      ? watchOfferFitsQr(args.pendingObserverOfferEncoded)
      : false,
  }
}
