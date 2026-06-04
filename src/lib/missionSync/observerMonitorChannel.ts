import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import type { SyncWireMessage } from './types'

export type ObserverSignalMessage =
  | { kind: 'offer'; hostPeerId: string; encoded: string; fromDeviceId: string; at: number }
  | { kind: 'answer'; hostPeerId: string; encoded: string; fromDeviceId: string; at: number }

export type ObserverRelayEnvelope = {
  kind: 'relay'
  wire: SyncWireMessage
  fromDeviceId: string
  at: number
}

export function observerChannelName(missionId: string, observerToken: string): string {
  let h = 2166136261
  const s = `${missionId}:${observerToken}`
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `mission-observe-${(h >>> 0).toString(36)}`
}

export function isObserverMonitorChannelAvailable(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  return Boolean(url?.trim() && key?.trim())
}

type ChannelHandlers = {
  onOffer?: (msg: Extract<ObserverSignalMessage, { kind: 'offer' }>) => void
  onAnswer?: (msg: Extract<ObserverSignalMessage, { kind: 'answer' }>) => void
  onRelay?: (wire: SyncWireMessage, fromDeviceId: string, at: number) => void
}

/** Persistent Supabase channel for monitor signaling + sync relay (internet fallback). */
export class ObserverMonitorChannel {
  private channel: RealtimeChannel | null = null
  private subscribed = false
  private handlers: ChannelHandlers = {}
  private resubscribeTimer: number | null = null

  constructor(
    private readonly missionId: string,
    private readonly observerToken: string,
  ) {}

  connect(handlers: ChannelHandlers): () => void {
    this.handlers = handlers
    this.ensureSubscribed()
    return () => this.dispose()
  }

  private ensureSubscribed(): void {
    if (this.channel) return
    const ch = supabase.channel(observerChannelName(this.missionId, this.observerToken), {
      config: { broadcast: { self: false } },
    })
    ch.on('broadcast', { event: 'signal' }, (payload) => {
      const msg = payload.payload as ObserverSignalMessage
      if (!msg || typeof msg !== 'object' || typeof msg.kind !== 'string') return
      if (msg.kind === 'offer') this.handlers.onOffer?.(msg)
      if (msg.kind === 'answer') this.handlers.onAnswer?.(msg)
    })
    ch.on('broadcast', { event: 'relay' }, (payload) => {
      const env = payload.payload as ObserverRelayEnvelope
      if (!env || env.kind !== 'relay' || !env.wire || typeof env.fromDeviceId !== 'string') return
      this.handlers.onRelay?.(env.wire, env.fromDeviceId, env.at)
    })
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.subscribed = true
        if (this.resubscribeTimer != null) {
          window.clearTimeout(this.resubscribeTimer)
          this.resubscribeTimer = null
        }
        return
      }
      this.subscribed = false
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.scheduleResubscribe()
      }
    })
    this.channel = ch
  }

  private scheduleResubscribe(): void {
    if (this.resubscribeTimer != null) return
    this.resubscribeTimer = window.setTimeout(() => {
      this.resubscribeTimer = null
      if (!this.channel) return
      void supabase.removeChannel(this.channel)
      this.channel = null
      this.subscribed = false
      this.ensureSubscribed()
    }, 2500)
  }

  private async waitSubscribed(timeoutMs = 8000): Promise<boolean> {
    if (this.subscribed) return true
    const start = Date.now()
    return new Promise((resolve) => {
      const tick = () => {
        if (this.subscribed) {
          resolve(true)
          return
        }
        if (Date.now() - start >= timeoutMs) {
          resolve(false)
          return
        }
        window.setTimeout(tick, 80)
      }
      tick()
    })
  }

  private async sendBroadcast(event: 'signal' | 'relay', payload: unknown): Promise<boolean> {
    this.ensureSubscribed()
    if (!this.channel) return false
    if (!(await this.waitSubscribed())) return false
    try {
      await this.channel.send({ type: 'broadcast', event, payload })
      return true
    } catch {
      return false
    }
  }

  async publishSignal(message: ObserverSignalMessage): Promise<boolean> {
    return this.sendBroadcast('signal', message)
  }

  async publishRelay(wire: SyncWireMessage, fromDeviceId: string): Promise<boolean> {
    if (wire.type === 'ping') return true
    const envelope: ObserverRelayEnvelope = {
      kind: 'relay',
      wire,
      fromDeviceId,
      at: Date.now(),
    }
    return this.sendBroadcast('relay', envelope)
  }

  dispose(): void {
    if (this.resubscribeTimer != null) {
      window.clearTimeout(this.resubscribeTimer)
      this.resubscribeTimer = null
    }
    if (this.channel) {
      void supabase.removeChannel(this.channel)
      this.channel = null
    }
    this.subscribed = false
    this.handlers = {}
  }
}
