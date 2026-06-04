import { describe, expect, it } from 'vitest'
import { computeTravelSpeedMps, formatTravelSpeed } from './travelSpeed'

describe('travelSpeed', () => {
  it('computes mph from two fixes', () => {
    const prev = { lat: 39.7392, lng: -104.9903, atMs: 0 }
    const mps = computeTravelSpeedMps({
      prev,
      lat: 39.74,
      lng: -104.99,
      atMs: 10_000,
    })
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

  it('ignores sub-threshold GPS jitter when accuracy is poor', () => {
    const prev = { lat: 40, lng: -105, atMs: 0 }
    const mps = computeTravelSpeedMps({
      prev,
      lat: 40.00001,
      lng: -105.00001,
      atMs: 5000,
      accuracyM: 12,
    })
    expect(mps).toBeNull()
  })
})
