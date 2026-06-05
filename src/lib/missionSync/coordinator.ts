import { encodeMissionPacket } from './codec'
import { answerLinkRole, isObserverOffer, offerLinkRole } from './linkRole'
import { MissionPeerSession, type MissionIceProfile } from './webrtc'
import type {
  ConnectedPeer,
  MissionAnswerPacket,
  MissionBurst,
  MissionCheckIn,
  MissionCorridorHint,
  MissionVoiceClip,
  MissionLinkRole,
  MissionOfferPacket,
  MissionSnapshot,
  SyncWireMessage,
  TeamPresence,
} from './types'
import { SyncWireDedupe } from './wireDedupe'
import {
  MAX_OBSERVER_PEERS,
  MAX_PENDING_OBSERVER_OFFERS,
  MISSION_SYNC_PROTOCOL_VERSION,
} from './types'

export type CoordinatorCallbacks = {
  onPeerConnected?: (peer: ConnectedPeer) => void
  onPeerDisconnected?: (peerId: string) => void
  onSnapshot?: (snapshot: MissionSnapshot, fromPeerId: string) => void
  onPresence?: (presence: TeamPresence, fromPeerId: string) => void
  onCheckIn?: (checkIn: MissionCheckIn, fromPeerId: string) => void
  onBurst?: (burst: MissionBurst, fromPeerId: string) => void
  onVoiceClip?: (clip: MissionVoiceClip, fromPeerId: string) => void
  onCorridorHint?: (hint: MissionCorridorHint, fromPeerId: string) => void
  onError?: (message: string) => void
}

type PeerEntry = {
  meta: ConnectedPeer
  session: MissionPeerSession
}

type PendingSlot = {
  session: MissionPeerSession
  linkRole: MissionLinkRole
  createdAt: number
}

export class MissionSyncCoordinator {
  readonly missionId: string
  readonly missionName: string
  readonly joinToken: string
  private _observerToken: string
  get observerToken(): string {
    return this._observerToken
  }
  readonly hostDeviceId: string
  readonly hostCallsign: string
  readonly role: 'member' | 'observer'

  private peers = new Map<string, PeerEntry>()
  private pendingOffers = new Map<string, PendingSlot>()
  private wireDedupe = new SyncWireDedupe()
  private outboundRelay?: (msg: SyncWireMessage) => void
  private callbacks: CoordinatorCallbacks

  setOutboundRelay(fn?: (msg: SyncWireMessage) => void): void {
    this.outboundRelay = fn
  }

  setCallbacks(callbacks: CoordinatorCallbacks): void {
    this.callbacks = callbacks
  }

  constructor(args: {
    missionId: string
    missionName: string
    joinToken: string
    observerToken?: string
    hostDeviceId: string
    hostCallsign: string
    role: 'member' | 'observer'
    callbacks: CoordinatorCallbacks
  }) {
    this.missionId = args.missionId
    this.missionName = args.missionName
    this.joinToken = args.joinToken
    this._observerToken = args.observerToken ?? ''
    this.hostDeviceId = args.hostDeviceId
    this.hostCallsign = args.hostCallsign
    this.role = args.role
    this.callbacks = args.callbacks
  }

  get connectedPeers(): ConnectedPeer[] {
    return [...this.peers.values()].map((p) => p.meta)
  }

  get observerPeers(): ConnectedPeer[] {
    return this.connectedPeers.filter((p) => p.linkRole === 'observer')
  }

  get fieldPeers(): ConnectedPeer[] {
    return this.connectedPeers.filter((p) => p.linkRole === 'member')
  }

  get peerCount(): number {
    return this.peers.size
  }

  get canPublish(): boolean {
    return this.role === 'member'
  }

  private canSendWire(msg: SyncWireMessage): boolean {
    if (msg.type === 'ping') return true
    if (this.role === 'member') return true
    if (this.role === 'observer') {
      return msg.type === 'burst' || msg.type === 'voice-clip' || msg.type === 'checkin'
    }
    return false
  }

  /** Field teammate link — one pending member slot; LAN ICE profile. */
  async createJoinOffer(): Promise<{ packet: MissionOfferPacket; encoded: string; peerId: string }> {
    this.closePendingForRole('member')
    return this.createOfferSlot('member', 'field')
  }

  /** Remote monitor link — multiple pending observer slots; internet ICE profile. */
  /** Mint token for missions restored before monitor links existed. */
  ensureObserverToken(): string {
    if (!this._observerToken) {
      this._observerToken = createMissionIds().observerToken
    }
    return this._observerToken
  }

  async createObserverOffer(): Promise<{ packet: MissionOfferPacket; encoded: string; peerId: string }> {
    this.ensureObserverToken()
    /** One active watch invite at a time — same as field member join offers. */
    this.closePendingForRole('observer')
    if (this.observerPeers.length >= MAX_OBSERVER_PEERS) {
      throw new Error(`Observer limit reached (${MAX_OBSERVER_PEERS})`)
    }
    this.pruneExpiredPending()
    const pendingObserver = [...this.pendingOffers.values()].filter((p) => p.linkRole === 'observer')
    if (pendingObserver.length >= MAX_PENDING_OBSERVER_OFFERS) {
      throw new Error('Too many pending monitor links — wait for an observer to connect')
    }
    return this.createOfferSlot('observer', 'internet')
  }

  private async createOfferSlot(
    linkRole: MissionLinkRole,
    iceProfile: MissionIceProfile,
  ): Promise<{ packet: MissionOfferPacket; encoded: string; peerId: string }> {
    const peerId = `peer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const session = new MissionPeerSession(
      {
        onOpen: () => {
          /* wait for answer before counting connected */
        },
        onClose: () => this.removePending(peerId),
        onMessage: (msg) => this.handleWireMessage(msg, peerId),
        onError: (err) => this.callbacks.onError?.(err),
      },
      this.hostDeviceId,
      iceProfile,
    )
    session.createOutboundChannel()
    const sdp = await session.createOffer()
    this.pendingOffers.set(peerId, { session, linkRole, createdAt: Date.now() })
    const meshRelayToken = this.ensureObserverToken()
    const packet: MissionOfferPacket = {
      t: 'mission-offer',
      v: MISSION_SYNC_PROTOCOL_VERSION,
      missionId: this.missionId,
      missionName: this.missionName,
      joinToken: linkRole === 'member' ? this.joinToken : '',
      /** Shared by field teammates + watchers for Supabase mesh relay (internet fallback). */
      observerToken: meshRelayToken,
      linkRole,
      hostDeviceId: this.hostDeviceId,
      hostCallsign: this.hostCallsign,
      peerId,
      sdp,
    }
    return { packet, encoded: encodeMissionPacket(packet), peerId }
  }

  async applyJoinAnswer(answer: MissionAnswerPacket): Promise<void> {
    const linkRole = answerLinkRole(answer)
    if (answer.missionId !== this.missionId) {
      throw new Error('Mission link token mismatch')
    }
    if (linkRole === 'observer') {
      if (!answer.observerToken || answer.observerToken !== this.observerToken) {
        throw new Error('Observer token mismatch')
      }
    } else if (answer.joinToken !== this.joinToken) {
      throw new Error('Mission link token mismatch')
    }
    let pending = this.pendingOffers.get(answer.hostPeerId)
    if (!pending || pending.linkRole !== linkRole) {
      const fallback = [...this.pendingOffers.values()]
        .filter((p) => p.linkRole === linkRole)
        .sort((a, b) => b.createdAt - a.createdAt)[0]
      pending = fallback
    }
    if (!pending || pending.linkRole !== linkRole) {
      throw new Error('No pending join slot for this answer')
    }
    await pending.session.acceptAnswer(answer.sdp)
    const peerId = answer.peerId
    const session = pending.session
    this.pendingOffers.delete(answer.hostPeerId)
    const meta: ConnectedPeer = {
      peerId,
      deviceId: answer.peerId,
      callsign: answer.callsign || (linkRole === 'observer' ? 'Observer' : 'Teammate'),
      connectedAt: Date.now(),
      linkRole,
    }
    this.peers.set(peerId, { meta, session })
    session.send({ type: 'ping', deviceId: this.hostDeviceId, sentAt: Date.now() })
    this.callbacks.onPeerConnected?.(meta)
  }

  /** Connect from an offer bundle (field member or remote observer). */
  async joinFromOffer(
    offer: MissionOfferPacket,
    joinerCallsign: string,
    joinerDeviceId: string,
    joinerRole: 'member' | 'observer',
  ): Promise<{ packet: MissionAnswerPacket; encoded: string; peerId: string }> {
    const linkRole = offerLinkRole(offer)
    if (offer.missionId !== this.missionId) {
      throw new Error('Mission link token mismatch')
    }
    if (linkRole === 'observer') {
      if (!offer.observerToken) throw new Error('Invalid observer offer')
      if (joinerRole !== 'observer') throw new Error('Observer offer requires monitor role')
    } else if (offer.joinToken !== this.joinToken || joinerRole !== 'member') {
      throw new Error('Mission link token mismatch')
    }

    const iceProfile: MissionIceProfile = linkRole === 'observer' ? 'internet' : 'field'
    const peerId = joinerDeviceId
    const meta: ConnectedPeer = {
      peerId,
      deviceId: joinerDeviceId,
      callsign: joinerCallsign,
      connectedAt: Date.now(),
      linkRole,
    }
    const session = new MissionPeerSession(
      {
        onOpen: () => this.callbacks.onPeerConnected?.(meta),
        onClose: () => this.removePeer(peerId),
        onMessage: (msg) => this.handleWireMessage(msg, peerId),
        onError: (err) => this.callbacks.onError?.(err),
      },
      joinerDeviceId,
      iceProfile,
    )
    const sdp = await session.acceptOfferAndCreateAnswer(offer.sdp)
    this.peers.set(peerId, { meta, session })
    const packet: MissionAnswerPacket = {
      t: 'mission-answer',
      v: MISSION_SYNC_PROTOCOL_VERSION,
      missionId: this.missionId,
      joinToken: linkRole === 'member' ? this.joinToken : '',
      observerToken: linkRole === 'observer' ? offer.observerToken : undefined,
      linkRole,
      peerId,
      hostPeerId: offer.peerId,
      callsign: joinerCallsign,
      sdp,
    }
    return { packet, encoded: encodeMissionPacket(packet), peerId }
  }

  /** Observer tablet: accept a monitor offer from the field. */
  async acceptObserverOffer(
    offer: MissionOfferPacket,
    observerCallsign: string,
    observerDeviceId: string,
  ): Promise<{ packet: MissionAnswerPacket; encoded: string }> {
    if (!isObserverOffer(offer)) throw new Error('Not an observer offer')
    if (this.role !== 'observer') throw new Error('Coordinator is not in observer mode')
    const { encoded, packet } = await this.joinFromOffer(
      offer,
      observerCallsign,
      observerDeviceId,
      'observer',
    )
    return { packet, encoded }
  }

  broadcast(msg: SyncWireMessage, exceptPeerId?: string): void {
    if (!this.canSendWire(msg)) return
    for (const [id, entry] of this.peers) {
      if (exceptPeerId && id === exceptPeerId) continue
      entry.session.send(msg)
    }
  }

  sendToPeer(peerId: string, msg: SyncWireMessage): void {
    if (!this.canSendWire(msg)) return
    this.peers.get(peerId)?.session.send(msg)
  }

  private emitOutboundRelay(msg: SyncWireMessage): void {
    if (!this.canSendWire(msg) || msg.type === 'ping') return
    if (this.role === 'observer' && msg.type !== 'burst' && msg.type !== 'voice-clip') return
    this.outboundRelay?.(msg)
  }

  sendSnapshot(snapshot: MissionSnapshot, exceptPeerId?: string): void {
    const msg: SyncWireMessage = { type: 'snapshot', payload: snapshot }
    this.emitOutboundRelay(msg)
    this.broadcast(msg, exceptPeerId)
  }

  sendSnapshotToPeer(peerId: string, snapshot: MissionSnapshot): void {
    const msg: SyncWireMessage = { type: 'snapshot', payload: snapshot }
    this.emitOutboundRelay(msg)
    this.sendToPeer(peerId, msg)
  }

  sendPresence(presence: TeamPresence, exceptPeerId?: string): void {
    const msg: SyncWireMessage = { type: 'presence', payload: presence }
    this.emitOutboundRelay(msg)
    this.broadcast(msg, exceptPeerId)
  }

  sendPresenceToPeer(peerId: string, presence: TeamPresence): void {
    const msg: SyncWireMessage = { type: 'presence', payload: presence }
    this.emitOutboundRelay(msg)
    this.sendToPeer(peerId, msg)
  }

  sendCheckIn(checkIn: MissionCheckIn, exceptPeerId?: string): void {
    const msg: SyncWireMessage = { type: 'checkin', payload: checkIn }
    this.emitOutboundRelay(msg)
    this.broadcast(msg, exceptPeerId)
  }

  sendBurst(burst: MissionBurst, exceptPeerId?: string): void {
    const msg: SyncWireMessage = { type: 'burst', payload: burst }
    this.emitOutboundRelay(msg)
    this.broadcast(msg, exceptPeerId)
  }

  /** Directed field message — one teammate + mission relay (watchers). */
  sendBurstToPeer(peerId: string, burst: MissionBurst): void {
    const msg: SyncWireMessage = { type: 'burst', payload: burst }
    this.emitOutboundRelay(msg)
    this.sendToPeer(peerId, msg)
  }

  sendBurstToPeers(peerIds: string[], burst: MissionBurst): void {
    const msg: SyncWireMessage = { type: 'burst', payload: burst }
    this.emitOutboundRelay(msg)
    const unique = [...new Set(peerIds)]
    for (const id of unique) this.sendToPeer(id, msg)
  }

  sendVoiceClip(clip: MissionVoiceClip, exceptPeerId?: string): void {
    const msg: SyncWireMessage = { type: 'voice-clip', payload: clip }
    this.emitOutboundRelay(msg)
    this.broadcast(msg, exceptPeerId)
  }

  sendVoiceClipToPeer(peerId: string, clip: MissionVoiceClip): void {
    const msg: SyncWireMessage = { type: 'voice-clip', payload: clip }
    this.emitOutboundRelay(msg)
    this.sendToPeer(peerId, msg)
  }

  sendCorridorHint(hint: MissionCorridorHint, exceptPeerId?: string): void {
    const msg: SyncWireMessage = { type: 'corridor-hint', payload: hint }
    this.emitOutboundRelay(msg)
    this.broadcast(msg, exceptPeerId)
  }

  sendCorridorHintToPeer(peerId: string, hint: MissionCorridorHint): void {
    const msg: SyncWireMessage = { type: 'corridor-hint', payload: hint }
    this.emitOutboundRelay(msg)
    this.sendToPeer(peerId, msg)
  }

  close(): void {
    this.closeAllPending()
    for (const entry of this.peers.values()) entry.session.close()
    this.peers.clear()
  }

  private closePendingForRole(linkRole: MissionLinkRole): void {
    for (const [id, slot] of this.pendingOffers) {
      if (slot.linkRole === linkRole) {
        slot.session.close()
        this.pendingOffers.delete(id)
      }
    }
  }

  private closeAllPending(): void {
    for (const slot of this.pendingOffers.values()) slot.session.close()
    this.pendingOffers.clear()
  }

  private removePending(peerId: string): void {
    const slot = this.pendingOffers.get(peerId)
    if (!slot) return
    slot.session.close()
    this.pendingOffers.delete(peerId)
  }

  private pruneExpiredPending(): void {
    const now = Date.now()
    for (const [id, slot] of this.pendingOffers) {
      if (slot.linkRole === 'observer' && now - slot.createdAt > 15 * 60_000) {
        slot.session.close()
        this.pendingOffers.delete(id)
      }
    }
  }

  private removePeer(peerId: string): void {
    const entry = this.peers.get(peerId)
    if (!entry) return
    entry.session.close()
    this.peers.delete(peerId)
    this.callbacks.onPeerDisconnected?.(peerId)
  }

  private peerLinkRole(fromPeerId: string): MissionLinkRole | null {
    return this.peers.get(fromPeerId)?.meta.linkRole ?? null
  }

  private handleWireMessage(msg: SyncWireMessage, fromPeerId: string): void {
    const fromRole = this.peerLinkRole(fromPeerId)
    if (
      fromRole === 'observer' &&
      msg.type !== 'ping' &&
      msg.type !== 'burst' &&
      msg.type !== 'voice-clip'
    ) {
      return
    }

    if (msg.type === 'snapshot') {
      if (!this.wireDedupe.accept(msg)) return
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
      return
    }
    if (msg.type === 'voice-clip') {
      this.callbacks.onVoiceClip?.(msg.payload, fromPeerId)
      this.broadcast(msg, fromPeerId)
      return
    }
    if (msg.type === 'corridor-hint') {
      if (!this.wireDedupe.accept(msg)) return
      this.callbacks.onCorridorHint?.(msg.payload, fromPeerId)
      this.broadcast(msg, fromPeerId)
    }
  }
}

export function createMissionIds(): {
  missionId: string
  joinToken: string
  observerToken: string
} {
  return {
    missionId: `msn_${Date.now().toString(36)}`,
    joinToken: Math.random().toString(36).slice(2, 12),
    observerToken: `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`,
  }
}
