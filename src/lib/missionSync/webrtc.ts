import type { SyncWireMessage } from './types'

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
const DATA_CHANNEL_LABEL = 'hud-mission-sync-v1'

export type PeerSessionCallbacks = {
  onOpen?: () => void
  onClose?: () => void
  onMessage?: (msg: SyncWireMessage) => void
  onError?: (err: string) => void
}

function waitIceGathering(pc: RTCPeerConnection, timeoutMs = 9000): Promise<void> {
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

function attachDataChannel(dc: RTCDataChannel, callbacks: PeerSessionCallbacks): void {
  dc.binaryType = 'arraybuffer'
  dc.addEventListener('open', () => callbacks.onOpen?.())
  dc.addEventListener('close', () => callbacks.onClose?.())
  dc.addEventListener('error', () => callbacks.onError?.('data-channel-error'))
  dc.addEventListener('message', (ev) => {
    try {
      const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)
      const msg = JSON.parse(text) as SyncWireMessage
      if (msg && typeof msg.type === 'string') callbacks.onMessage?.(msg)
    } catch {
      callbacks.onError?.('invalid-wire-message')
    }
  })
}

export class MissionPeerSession {
  private pc: RTCPeerConnection
  private dc: RTCDataChannel | null = null
  private callbacks: PeerSessionCallbacks

  constructor(callbacks: PeerSessionCallbacks) {
    this.callbacks = callbacks
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.pc.addEventListener('datachannel', (ev) => {
      this.dc = ev.channel
      attachDataChannel(this.dc, this.callbacks)
    })
    this.pc.addEventListener('connectionstatechange', () => {
      const st = this.pc.connectionState
      if (st === 'failed' || st === 'disconnected') {
        this.callbacks.onError?.(`peer-${st}`)
      }
    })
  }

  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState
  }

  createOutboundChannel(): RTCDataChannel {
    const dc = this.pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true })
    this.dc = dc
    attachDataChannel(dc, this.callbacks)
    return dc
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    await waitIceGathering(this.pc)
    return this.pc.localDescription ?? offer
  }

  async acceptOfferAndCreateAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(offer)
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    await waitIceGathering(this.pc)
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

  close(): void {
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
