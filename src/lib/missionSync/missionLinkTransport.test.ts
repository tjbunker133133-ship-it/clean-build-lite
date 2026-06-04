import { describe, expect, it } from 'vitest'
import { shouldPreferTransport, transportLabel, transportPriorityRank } from './missionLinkTransport'

describe('missionLinkTransport', () => {
  it('ranks wifi above nearby', () => {
    expect(transportPriorityRank('wifi-lan')).toBeLessThan(transportPriorityRank('nearby'))
  })

  it('prefers wifi over unknown for status', () => {
    expect(shouldPreferTransport('unknown', 'wifi-lan')).toBe(true)
    expect(shouldPreferTransport('wifi-lan', 'nearby')).toBe(false)
  })

  it('labels operator-facing transport names', () => {
    expect(transportLabel('nearby')).toContain('Nearby')
    expect(transportLabel('wifi-lan')).toContain('Wi')
  })
})
