import type { Waypoint } from '../../types'

export const MISSION_SYNC_PROTOCOL_VERSION = 1 as const

/** `member` = equal peer in mission (any tablet may link others). */
export type MissionSyncRole = 'idle' | 'member'

export type MissionSyncConnectionPhase =
  | 'idle'
  | 'awaiting-joiner'
  | 'awaiting-host-answer'
  | 'connecting'
  | 'connected'
  | 'failed'

export type MissionSnapshot = {
  missionId: string
  missionName: string
  revision: number
  updatedAt: number
  hostDeviceId: string
  sourceDeviceId: string
  sourceCallsign: string
  waypoints: Waypoint[]
}

export type TeamPresence = {
  deviceId: string
  callsign: string
  lat: number | null
  lng: number | null
  accuracy: number | null
  updatedAt: number
}

/** Operator OK ping — does not replace SOS or deadman. */
export type MissionCheckIn = {
  deviceId: string
  callsign: string
  note?: string
  sentAt: number
}

/** Short team text over mesh (rate-limited in UI). */
export type MissionBurst = {
  deviceId: string
  callsign: string
  text: string
  sentAt: number
}

export type SyncWireMessage =
  | { type: 'snapshot'; payload: MissionSnapshot }
  | { type: 'presence'; payload: TeamPresence }
  | { type: 'checkin'; payload: MissionCheckIn }
  | { type: 'burst'; payload: MissionBurst }
  | { type: 'ping'; deviceId: string; sentAt: number }

export type MissionOfferPacket = {
  t: 'mission-offer'
  v: typeof MISSION_SYNC_PROTOCOL_VERSION
  missionId: string
  missionName: string
  joinToken: string
  hostDeviceId: string
  hostCallsign: string
  peerId: string
  sdp: RTCSessionDescriptionInit
}

export type MissionAnswerPacket = {
  t: 'mission-answer'
  v: typeof MISSION_SYNC_PROTOCOL_VERSION
  missionId: string
  joinToken: string
  peerId: string
  hostPeerId: string
  callsign: string
  sdp: RTCSessionDescriptionInit
}

export type ConnectedPeer = {
  peerId: string
  deviceId: string
  callsign: string
  connectedAt: number
}

export type MissionSyncPersistedSession = {
  missionId: string
  missionName: string
  role: 'member'
  deviceId: string
  joinToken?: string
  hostDeviceId?: string
  updatedAt: number
}
