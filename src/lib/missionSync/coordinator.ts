import { encodeMissionPacket } from './codec'
import { MissionPeerSession } from './webrtc'
import type {
  ConnectedPeer,
  MissionAnswerPacket,
  MissionBurst,
  MissionCheckIn,
  MissionOfferPacket,
  MissionSnapshot,
  SyncWireMessage,
  TeamPresence,
} from './types'
import { MISSION_SYNC_PROTOCOL_VERSION } from './types'

export type CoordinatorCallbacks = {
  onPeerConnected?: (peer: ConnectedPeer) => void
  onPeerDisconnected?: (peerId: string) => void
  onSnapshot?: (snapshot: MissionSnapshot, fromPeerId: string) => void
  onPresence?: (presence: TeamPresence, fromPeerId: string) => void
  onCheckIn?: (checkIn: MissionCheckIn, fromPeerId: string) => void
  onBurst?: (burst: MissionBurst, fromPeerId: string) => void
  onError?: (message: string) => void
}

type PeerEntry = {
  meta: ConnectedPeer
  session: MissionPeerSession
}

export class MissionSyncCoordinator {
  readonly missionId: string
  readonly missionName: string
  readonly joinToken: string
  readonly hostDeviceId: string
  readonly hostCallsign: string
  readonly role: 'member'

  private peers = new Map<string, PeerEntry>()
  private pendingHost: MissionPeerSession | null = null
  private pendingHostPeerId: string | null = null
  private seenSnapshots = new Map<string, number>()
  private callbacks: CoordinatorCallbacks

  setCallbacks(callbacks: CoordinatorCallbacks): void {
    this.callbacks = callbacks
  }

  constructor(args: {
    missionId: string
    missionName: string
    joinToken: string
    hostDeviceId: string
    hostCallsign: string
    role: 'member'
    callbacks: CoordinatorCallbacks
  }) {
    this.missionId = args.missionId
    this.missionName = args.missionName
    this.joinToken = args.joinToken
    this.hostDeviceId = args.hostDeviceId
    this.hostCallsign = args.hostCallsign
    this.role = args.role
    this.callbacks = args.callbacks
  }

  get connectedPeers(): ConnectedPeer[] {
    return [...this.peers.values()].map((p) => p.meta)
  }

  get peerCount(): number {
    return this.peers.size
  }

  /** Any mission member: start a pairwise link slot (one new teammate per offer). */
  async createJoinOffer(): Promise<{ packet: MissionOfferPacket; encoded: string; peerId: string }> {
    this.closePendingHost()
    const peerId = `peer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const session = new MissionPeerSession({
      onOpen: () => {
        /* wait for answer before counting connected */
      },
      onClose: () => this.removePeer(peerId),
      onMessage: (msg) => this.handleWireMessage(msg, peerId),
      onError: (err) => this.callbacks.onError?.(err),
    })
    session.createOutboundChannel()
    const sdp = await session.createOffer()
    this.pendingHost = session
    this.pendingHostPeerId = peerId
    const packet: MissionOfferPacket = {
      t: 'mission-offer',
      v: MISSION_SYNC_PROTOCOL_VERSION,
      missionId: this.missionId,
      missionName: this.missionName,
      joinToken: this.joinToken,
      hostDeviceId: this.hostDeviceId,
      hostCallsign: this.hostCallsign,
      peerId,
      sdp,
    }
    return { packet, encoded: encodeMissionPacket(packet), peerId }
  }

  /** Complete link after scanning/pasting the other tablet's answer bundle. */
  async applyJoinAnswer(answer: MissionAnswerPacket): Promise<void> {
    if (answer.missionId !== this.missionId || answer.joinToken !== this.joinToken) {
      throw new Error('Mission link token mismatch')
    }
    if (!this.pendingHost || this.pendingHostPeerId !== answer.hostPeerId) {
      throw new Error('No pending join slot for this answer')
    }
    await this.pendingHost.acceptAnswer(answer.sdp)
    const peerId = answer.peerId
    const session = this.pendingHost
    this.pendingHost = null
    this.pendingHostPeerId = null
    const meta: ConnectedPeer = {
      peerId,
      deviceId: answer.peerId,
      callsign: answer.callsign || 'Teammate',
      connectedAt: Date.now(),
    }
    this.peers.set(peerId, { meta, session })
    session.send({ type: 'ping', deviceId: this.hostDeviceId, sentAt: Date.now() })
    this.callbacks.onPeerConnected?.(meta)
  }

  /** Connect from another member's offer bundle. */
  async joinFromOffer(
    offer: MissionOfferPacket,
    joinerCallsign: string,
    joinerDeviceId: string,
  ): Promise<{ packet: MissionAnswerPacket; encoded: string; peerId: string }> {
    if (offer.missionId !== this.missionId || offer.joinToken !== this.joinToken) {
      throw new Error('Mission link token mismatch')
    }
    const peerId = joinerDeviceId
    const meta: ConnectedPeer = {
      peerId,
      deviceId: joinerDeviceId,
      callsign: joinerCallsign,
      connectedAt: Date.now(),
    }
    const session = new MissionPeerSession({
      onOpen: () => this.callbacks.onPeerConnected?.(meta),
      onClose: () => this.removePeer(peerId),
      onMessage: (msg) => this.handleWireMessage(msg, peerId),
      onError: (err) => this.callbacks.onError?.(err),
    })
    const sdp = await session.acceptOfferAndCreateAnswer(offer.sdp)
    this.peers.set(peerId, { meta, session })
    const packet: MissionAnswerPacket = {
      t: 'mission-answer',
      v: MISSION_SYNC_PROTOCOL_VERSION,
      missionId: this.missionId,
      joinToken: this.joinToken,
      peerId,
      hostPeerId: offer.peerId,
      callsign: joinerCallsign,
      sdp,
    }
    return { packet, encoded: encodeMissionPacket(packet), peerId }
  }

  broadcast(msg: SyncWireMessage, exceptPeerId?: string): void {
    for (const [id, entry] of this.peers) {
      if (exceptPeerId && id === exceptPeerId) continue
      entry.session.send(msg)
    }
  }

  sendSnapshot(snapshot: MissionSnapshot, exceptPeerId?: string): void {
    this.broadcast({ type: 'snapshot', payload: snapshot }, exceptPeerId)
  }

  sendPresence(presence: TeamPresence, exceptPeerId?: string): void {
    this.broadcast({ type: 'presence', payload: presence }, exceptPeerId)
  }

  sendCheckIn(checkIn: MissionCheckIn, exceptPeerId?: string): void {
    this.broadcast({ type: 'checkin', payload: checkIn }, exceptPeerId)
  }

  sendBurst(burst: MissionBurst, exceptPeerId?: string): void {
    this.broadcast({ type: 'burst', payload: burst }, exceptPeerId)
  }

  close(): void {
    this.closePendingHost()
    for (const entry of this.peers.values()) entry.session.close()
    this.peers.clear()
  }

  private closePendingHost(): void {
    this.pendingHost?.close()
    this.pendingHost = null
    this.pendingHostPeerId = null
  }

  private removePeer(peerId: string): void {
    const entry = this.peers.get(peerId)
    if (!entry) return
    entry.session.close()
    this.peers.delete(peerId)
    this.callbacks.onPeerDisconnected?.(peerId)
  }

  private handleWireMessage(msg: SyncWireMessage, fromPeerId: string): void {
    if (msg.type === 'snapshot') {
      const key = `${msg.payload.sourceDeviceId}:${msg.payload.revision}`
      const seenAt = this.seenSnapshots.get(key)
      const now = Date.now()
      if (seenAt != null && now - seenAt < 60_000) {
        return
      }
      this.seenSnapshots.set(key, now)
      if (this.seenSnapshots.size > 64) {
        for (const [k, t] of this.seenSnapshots) {
          if (now - t > 60_000) this.seenSnapshots.delete(k)
        }
      }
      this.callbacks.onSnapshot?.(msg.payload, fromPeerId)
      this.broadcast(msg, fromPeerId)
      return
    }
    if (msg.type === 'presence') {
      this.callbacks.onPresence?.(msg.payload, fromPeerId)
      this.broadcast(msg, fromPeerId)
      return
    }
    if (msg.type === 'checkin') {
      this.callbacks.onCheckIn?.(msg.payload, fromPeerId)
      this.broadcast(msg, fromPeerId)
      return
    }
    if (msg.type === 'burst') {
      this.callbacks.onBurst?.(msg.payload, fromPeerId)
      this.broadcast(msg, fromPeerId)
    }
  }

}

export function createMissionIds(): { missionId: string; joinToken: string } {
  return {
    missionId: `msn_${Date.now().toString(36)}`,
    joinToken: Math.random().toString(36).slice(2, 12),
  }
}
