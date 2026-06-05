import { describe, expect, it } from 'vitest'
import { buildBurst, filterRecentBursts, isBurstValid, sanitizeBurstText } from './comms'

describe('mission comms', () => {
  it('sanitizes and caps burst text', () => {
    const long = 'a'.repeat(200)
    expect(sanitizeBurstText(long).length).toBe(120)
    expect(isBurstValid('hold north ridge')).toBe(true)
    expect(isBurstValid('   ')).toBe(false)
  })

  it('builds burst payload', () => {
    const b = buildBurst('dev1', 'Alpha', '  meet at saddle  ')
    expect(b?.text).toBe('meet at saddle')
    expect(b?.callsign).toBe('Alpha')
  })

  it('builds directed burst payload', () => {
    const b = buildBurst('dev1', 'Alpha', 'hold', {
      scope: 'direct',
      peerId: 'p1',
      deviceId: 'd2',
      callsign: 'Bravo',
    })
    expect(b?.toDeviceId).toBe('d2')
    expect(b?.toCallsign).toBe('Bravo')
  })

  it('prunes mission log to 60 minutes and caps count', () => {
    const now = Date.now()
    const items = Array.from({ length: 120 }, (_, i) => ({
      deviceId: 'a',
      callsign: 'Alpha',
      text: `m${i}`,
      sentAt: now - i * 60_000,
    }))
    const pruned = filterRecentBursts(items, now)
    expect(pruned.length).toBeLessThanOrEqual(100)
    expect(pruned.every((b) => now - b.sentAt <= 3_600_000)).toBe(true)
  })
})
