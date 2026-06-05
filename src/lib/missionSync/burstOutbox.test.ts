import { beforeEach, describe, expect, it } from 'vitest'
import {
  _clearBurstOutboxForTests,
  dueQueuedBursts,
  enqueueBurst,
  listQueuedBursts,
  markBurstAttempt,
  queueId,
} from './burstOutbox'

describe('burstOutbox', () => {
  beforeEach(() => {
    _clearBurstOutboxForTests()
  })

  it('queues and dedupes rapid identical bursts', () => {
    const burst = {
      deviceId: 'a',
      callsign: 'Alpha',
      text: 'Hold up',
      sentAt: Date.now(),
    }
    enqueueBurst(burst)
    enqueueBurst(burst)
    expect(listQueuedBursts()).toHaveLength(1)
  })

  it('marks success and removes item', () => {
    const burst = {
      deviceId: 'a',
      callsign: 'Alpha',
      text: 'On my way',
      sentAt: 1000,
    }
    enqueueBurst(burst)
    const q = listQueuedBursts()[0]!
    markBurstAttempt(q, true)
    expect(listQueuedBursts()).toHaveLength(0)
  })

  it('expires after max failed attempts', () => {
    const burst = {
      deviceId: 'a',
      callsign: 'Alpha',
      text: 'Need assist',
      sentAt: 3000,
    }
    enqueueBurst(burst)
    let q = listQueuedBursts()[0]!
    for (let i = 0; i < 8; i += 1) {
      const result = markBurstAttempt(q, false, q.nextAttemptAt)
      if (result === 'expired') break
      q = listQueuedBursts()[0]!
    }
    expect(listQueuedBursts()).toHaveLength(0)
  })

  it('applies backoff on failure', () => {
    const burst = {
      deviceId: 'a',
      callsign: 'Alpha',
      text: 'Need assist',
      sentAt: 2000,
    }
    enqueueBurst(burst)
    const q = listQueuedBursts()[0]!
    markBurstAttempt(q, false, 5000)
    const after = listQueuedBursts()[0]!
    expect(after.attempts).toBe(1)
    expect(after.nextAttemptAt).toBeGreaterThan(5000)
    expect(dueQueuedBursts(5000)).toHaveLength(0)
    expect(dueQueuedBursts(after.nextAttemptAt)).toHaveLength(1)
    expect(queueId(q)).toBe('2000:a:team')
  })
})
