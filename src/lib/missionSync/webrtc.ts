import type { SyncWireMessage } from './types'

export type MissionIceProfile = 'field' | 'internet'

/** Field = LAN host candidates only (small bundles, code/QR friendly). Internet adds STUN + TURN. */
function iceServersForProfile(profile: MissionIceProfile): RTCIceServer[] {
  if (profile === 'field') {
    return []
  }
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ]
  if (profile === 'internet') {
    const turnUrl = import.meta.env.VITE_MISSION_TURN_URL as string | undefined
    const turnUser = import.meta.env.VITE_MISSION_TURN_USERNAME as string | undefined
    const turnCred = import.meta.env.VITE_MISSION_TURN_CREDENTIAL as string | undefined
    if (turnUrl?.trim() && turnUser?.trim() && turnCred?.trim()) {
      servers.push({ urls: turnUrl.trim(), username: turnUser.trim(), credential: turnCred.trim() })
    }
  }
  return servers
}
const DATA_CHANNEL_LABEL = 'hud-mission-sync-v1'
const KEEPALIVE_MS = 12_000
const DISCONNECTED_GRACE_MS = 12_000
const ICE_GATHER_FIELD_MS = 4_000
const ICE_GATHER_TIMEOUT_MS = 12_000
const ICE_GATHER_INTERNET_MS = 18_000

export type PeerSessionCallbacks = {
  onOpen?: () => void
  onClose?: () => void
  onMessage?: (msg: SyncWireMessage) => void
  onError?: (err: string) => void
  onConnectionState?: (state: RTCPeerConnectionState) => void
}

function waitIceGathering(pc: RTCPeerConnection, timeoutMs = ICE_GATHER_TIMEOUT_MS): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', onChange)
      clearTimeout(timer)
      resolve()
    }
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done()
    }
    pc.addEventListener('icegatheringstatechange', onChange)
    const timer = window.setTimeout(done, timeoutMs)
  })
}

function attachDataChannel(
  dc: RTCDataChannel,
  callbacks: PeerSessionCallbacks,
  sendKeepalive: () => void,
): void {
  dc.binaryType = 'arraybuffer'
  dc.addEventListener('open', () => {
    callbacks.onOpen?.()
    sendKeepalive()
  })
  dc.addEventListener('close', () => callbacks.onClose?.())
  dc.addEventListener('error', () => callbacks.onError?.('data-channel-error'))
  dc.addEventListener('message', (ev) => {
    try {
      const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)
      const msg = JSON.parse(text) as SyncWireMessage
      if (msg && typeof msg.type === 'string') {
        if (msg.type === 'ping') return
        callbacks.onMessage?.(msg)
      }
    } catch {
      callbacks.onError?.('invalid-wire-message')
    }
  })
}

export class MissionPeerSession {
  private pc: RTCPeerConnection
  private dc: RTCDataChannel | null = null
  private callbacks: PeerSessionCallbacks
  private keepaliveTimer: number | null = null
  private disconnectGraceTimer: number | null = null
  private deviceId: string
  private iceProfile: MissionIceProfile

  constructor(
    callbacks: PeerSessionCallbacks,
    deviceId = 'local',
    iceProfile: MissionIceProfile = 'field',
  ) {
    this.callbacks = callbacks
    this.deviceId = deviceId
    this.iceProfile = iceProfile
    this.pc = new RTCPeerConnection({
      iceServers: iceServersForProfile(iceProfile),
      iceCandidatePoolSize: iceProfile === 'internet' ? 8 : 4,
    })
    this.pc.addEventListener('datachannel', (ev) => {
      this.dc = ev.channel
      attachDataChannel(this.dc, this.callbacks, () => this.sendKeepalive())
      this.armKeepalive()
    })
    this.pc.addEventListener('connectionstatechange', () => {
      const st = this.pc.connectionState
      this.callbacks.onConnectionState?.(st)
      if (st === 'connected') {
        this.clearDisconnectGrace()
        return
      }
      if (st === 'disconnected') {
        this.armDisconnectGrace()
        void this.tryRestartIce()
        return
      }
      if (st === 'failed') {
        this.clearDisconnectGrace()
        this.callbacks.onError?.('peer-failed')
      }
    })
    this.pc.addEventListener('iceconnectionstatechange', () => {
      const ice = this.pc.iceConnectionState
      if (ice === 'failed') {
        this.callbacks.onError?.('ice-failed')
      }
    })
  }

  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState
  }

  createOutboundChannel(): RTCDataChannel {
    const dc = this.pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true })
    this.dc = dc
    attachDataChannel(dc, this.callbacks, () => this.sendKeepalive())
    this.armKeepalive()
    return dc
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer({ iceRestart: false })
    await this.pc.setLocalDescription(offer)
    await waitIceGathering(
      this.pc,
      this.iceProfile === 'internet'
        ? ICE_GATHER_INTERNET_MS
        : this.iceProfile === 'field'
          ? ICE_GATHER_FIELD_MS
          : ICE_GATHER_TIMEOUT_MS,
    )
    return this.pc.localDescription ?? offer
  }

  async acceptOfferAndCreateAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(offer)
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    await waitIceGathering(
      this.pc,
      this.iceProfile === 'internet'
        ? ICE_GATHER_INTERNET_MS
        : this.iceProfile === 'field'
          ? ICE_GATHER_FIELD_MS
          : ICE_GATHER_TIMEOUT_MS,
    )
    return this.pc.localDescription ?? answer
  }

  async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(answer)
  }

  send(msg: SyncWireMessage): boolean {
    if (!this.dc || this.dc.readyState !== 'open') return false
    try {
      this.dc.send(JSON.stringify(msg))
      return true
    } catch {
      return false
    }
  }

  private sendKeepalive(): void {
    this.send({ type: 'ping', deviceId: this.deviceId, sentAt: Date.now() })
  }

  private armKeepalive(): void {
    if (this.keepaliveTimer != null) window.clearInterval(this.keepaliveTimer)
    this.keepaliveTimer = window.setInterval(() => {
      if (this.pc.connectionState === 'connected') this.sendKeepalive()
    }, KEEPALIVE_MS)
  }

  private armDisconnectGrace(): void {
    if (this.disconnectGraceTimer != null) return
    this.disconnectGraceTimer = window.setTimeout(() => {
      this.disconnectGraceTimer = null
      if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
        this.callbacks.onError?.('peer-disconnected')
      }
    }, DISCONNECTED_GRACE_MS)
  }

  private clearDisconnectGrace(): void {
    if (this.disconnectGraceTimer != null) {
      window.clearTimeout(this.disconnectGraceTimer)
      this.disconnectGraceTimer = null
    }
  }

  private async tryRestartIce(): Promise<void> {
    if (this.pc.signalingState !== 'stable') return
    try {
      const offer = await this.pc.createOffer({ iceRestart: true })
      await this.pc.setLocalDescription(offer)
      await waitIceGathering(this.pc, 6000)
    } catch {
      /* ignore — grace timer may surface error */
    }
  }

  close(): void {
    this.clearDisconnectGrace()
    if (this.keepaliveTimer != null) {
      window.clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
    try {
      this.dc?.close()
    } catch {
      /* ignore */
    }
    try {
      this.pc.close()
    } catch {
      /* ignore */
    }
    this.dc = null
  }
}

export function isMissionSyncSupported(): boolean {
  return (
    typeof RTCPeerConnection !== 'undefined' &&
    typeof RTCDataChannel !== 'undefined'
  )
}
