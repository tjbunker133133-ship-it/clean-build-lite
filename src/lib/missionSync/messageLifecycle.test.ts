import { describe, expect, it } from 'vitest'
import {
  burstLifecycleKey,
  createInboundBurstDedupe,
  isTerminalOutboundPhase,
} from './messageLifecycle'

describe('messageLifecycle', () => {
  it('dedupes inbound bursts by device and sentAt', () => {
    const dedupe = createInboundBurstDedupe()
    const burst = {
      deviceId: 'a',
      callsign: 'Alpha',
      text: 'hi',
      sentAt: 100,
    }
    expect(dedupe.accept(burst)).toBe(true)
    expect(dedupe.accept(burst)).toBe(false)
    expect(burstLifecycleKey(burst)).toBe('a:100')
  })

  it('identifies terminal phases', () => {
    expect(isTerminalOutboundPhase('delivered')).toBe(true)
    expect(isTerminalOutboundPhase('failed')).toBe(true)
    expect(isTerminalOutboundPhase('sending')).toBe(false)
  })
})
