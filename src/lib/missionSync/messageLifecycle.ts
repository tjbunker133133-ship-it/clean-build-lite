import type { MissionBurst } from './types'

/** Local outbound lifecycle — every message must reach a terminal phase. */
export type OutboundMessagePhase =
  | 'draft'
  | 'queued_offline'
  | 'sending'
  | 'delivered'
  | 'failed'

export function burstLifecycleKey(burst: Pick<MissionBurst, 'deviceId' | 'sentAt'>): string {
  return `${burst.deviceId}:${burst.sentAt}`
}

export function isTerminalOutboundPhase(phase: OutboundMessagePhase): boolean {
  return phase === 'delivered' || phase === 'failed'
}

/** Ring buffer dedupe for mesh + relay + rebroadcast ingress. */
export function createInboundBurstDedupe(max = 64) {
  const seen = new Set<string>()
  const order: string[] = []
  return {
    accept(burst: MissionBurst): boolean {
      const key = burstLifecycleKey(burst)
      if (seen.has(key)) return false
      seen.add(key)
      order.push(key)
      while (order.length > max) {
        const old = order.shift()
        if (old) seen.delete(old)
      }
      return true
    },
    _clearForTests() {
      seen.clear()
      order.length = 0
    },
  }
}
