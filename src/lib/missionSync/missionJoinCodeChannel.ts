import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import { normalizeJoinCodeInput } from './joinCode'
import { isObserverMonitorChannelAvailable } from './observerMonitorChannel'

export type JoinCodeOfferMessage = {
  kind: 'offer'
  encoded: string
  missionId: string
  fromDeviceId: string
  at: number
}

export type JoinCodeAnswerMessage = {
  kind: 'answer'
  encoded: string
  fromDeviceId: string
  at: number
}

/** Joiner asks host to re-broadcast the current offer (same code room). */
export type JoinCodeRequestOfferMessage = {
  kind: 'request-offer'
  fromDeviceId: string
  callsign?: string
  at: number
}

export type JoinCodeSignalMessage =
  | JoinCodeOfferMessage
  | JoinCodeAnswerMessage
  | JoinCodeRequestOfferMessage

export function joinCodeChannelName(normalized6: string): string {
  const code = normalizeJoinCodeInput(normalized6)
  let h = 2166136261
  for (let i = 0; i < code.length; i += 1) {
    h ^= code.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `mission-code-${(h >>> 0).toString(36)}`
}

export function isJoinCodeSignalingAvailable(): boolean {
  return isObserverMonitorChannelAvailable()
}

type Handlers = {
  onOffer?: (msg: JoinCodeOfferMessage) => void
  onAnswer?: (msg: JoinCodeAnswerMessage) => void
  onRequestOffer?: (msg: JoinCodeRequestOfferMessage) => void
}

/** Supabase room keyed by 6-char mission code — join bundles without paste/SMS. */
export class MissionJoinCodeChannel {
  private channel: RealtimeChannel | null = null
  private subscribed = false
  private handlers: Handlers = {}
  private resubscribeTimer: number | null = null

  constructor(private readonly normalizedCode: string) {}

  connect(handlers: Handlers): () => void {
    this.handlers = handlers
    this.ensureSubscribed()
    return () => this.dispose()
  }

  private ensureSubscribed(): void {
    if (this.channel) return
    const ch = supabase.channel(joinCodeChannelName(this.normalizedCode), {
      config: { broadcast: { self: false } },
    })
    ch.on('broadcast', { event: 'join' }, (payload) => {
      const msg = payload.payload as JoinCodeSignalMessage
      if (!msg || typeof msg !== 'object' || typeof msg.kind !== 'string') return
      if (msg.kind === 'offer') this.handlers.onOffer?.(msg)
      if (msg.kind === 'answer') this.handlers.onAnswer?.(msg)
      if (msg.kind === 'request-offer') this.handlers.onRequestOffer?.(msg)
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

  async publish(message: JoinCodeSignalMessage): Promise<boolean> {
    this.ensureSubscribed()
    if (!this.channel) return false
    if (!(await this.waitSubscribed())) return false
    try {
      await this.channel.send({ type: 'broadcast', event: 'join', payload: message })
      return true
    } catch {
      return false
    }
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
