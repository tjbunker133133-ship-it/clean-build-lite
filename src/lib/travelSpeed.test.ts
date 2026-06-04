import { describe, expect, it } from 'vitest'
import { computeTravelSpeedMps, formatTravelSpeed } from './travelSpeed'

describe('travelSpeed', () => {
  it('computes mph from two fixes', () => {
    const prev = { lat: 39.7392, lng: -104.9903, atMs: 0 }
    const mps = computeTravelSpeedMps(prev, 39.74, -104.99, 10_000)
    expect(mps).not.toBeNull()
    const fmt = formatTravelSpeed(mps)
    expect(fmt.moving).toBe(true)
    expect(fmt.primary).toContain('mph')
  })

  it('shows stop when speed is low', () => {
    const fmt = formatTravelSpeed(0.1)
    expect(fmt.primary).toBe('STOP')
    expect(fmt.moving).toBe(false)
  })
})
