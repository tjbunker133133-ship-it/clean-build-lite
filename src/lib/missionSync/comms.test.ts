import { describe, expect, it } from 'vitest'
import { buildBurst, isBurstValid, sanitizeBurstText } from './comms'

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
})
