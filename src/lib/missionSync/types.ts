import type { Waypoint } from '../../types'

export const MISSION_SYNC_PROTOCOL_VERSION = 1 as const

/** Field operator with full mesh publish rights. */
export type MissionSyncRole = 'idle' | 'member' | 'observer'

/** Per-link slot — member (field) or observer (remote monitor). */
export type MissionLinkRole = 'member' | 'observer'

export type MissionSyncConnectionPhase =
  | 'idle'
  | 'awaiting-joiner'
  | 'awaiting-observer'
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
  snapToTrailEnabled?: boolean
}

export type MissionCorridorHint = {
  missionId: string
  sourceDeviceId: string
  sourceCallsign: string
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  routeFingerprint: string
  centerLat: number
  centerLng: number
  updatedAt: number
}

export type TeamPresence = {
  deviceId: string
  callsign: string
  lat: number | null
  lng: number | null
  accuracy: number | null
  updatedAt: number
  /** Shared on mesh for teammate situational readout (optional). */
  speedMph?: number
  headingDeg?: number
  elevationM?: number
}

export type MissionCheckIn = {
  deviceId: string
  callsign: string
  note?: string
  sentAt: number
}

export type MissionBurst = {
  deviceId: string
  callsign: string
  text: string
  sentAt: number
  /** When set, primary alert is for this device; still relayed on mission relay. */
  toDeviceId?: string
  toCallsign?: string
}

/** Short recorded voice note over mesh data channel (not live PTT). */
export type MissionVoiceClip = {
  deviceId: string
  callsign: string
  sentAt: number
  durationMs: number
  mime: string
  audioB64: string
  toDeviceId?: string
  toCallsign?: string
}

export type SyncWireMessage =
  | { type: 'snapshot'; payload: MissionSnapshot }
  | { type: 'presence'; payload: TeamPresence }
  | { type: 'checkin'; payload: MissionCheckIn }
  | { type: 'burst'; payload: MissionBurst }
  | { type: 'voice-clip'; payload: MissionVoiceClip }
  | { type: 'corridor-hint'; payload: MissionCorridorHint }
  | { type: 'ping'; deviceId: string; sentAt: number }

export type MissionOfferPacket = {
  t: 'mission-offer'
  v: typeof MISSION_SYNC_PROTOCOL_VERSION
  missionId: string
  missionName: string
  /** Field join token — required for member links. */
  joinToken: string
  /** Separate secret for remote monitor links (not the 6-char Wi‑Fi code). */
  observerToken?: string
  linkRole?: MissionLinkRole
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
  observerToken?: string
  linkRole?: MissionLinkRole
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
  linkRole: MissionLinkRole
}

export type PersistedSessionWatcher = {
  deviceId: string
  callsign: string
  live: boolean
}

export type MissionSyncPersistedSession = {
  missionId: string
  missionName: string
  role: 'member' | 'observer'
  deviceId: string
  joinToken?: string
  observerToken?: string
  hostDeviceId?: string
  /** Observer waiting for field lead to create monitor link (token-only join). */
  observerWaitMode?: boolean
  /** Host-side watcher roster — survives refresh (live flags refreshed on reconnect). */
  sessionWatchers?: PersistedSessionWatcher[]
  updatedAt: number
}

export const MAX_OBSERVER_PEERS = 12
export const MAX_PENDING_OBSERVER_OFFERS = 8
