import { describe, expect, it } from 'vitest'
import { GpsConfidenceTracker } from './gpsConfidence'

describe('gpsConfidence', () => {
  it('reports high confidence for accurate stable fixes', () => {
    const tracker = new GpsConfidenceTracker()
    const state = tracker.ingest({
      lat: 39.55,
      lng: -105.78,
      accuracy: 8,
      timestampMs: 1000,
    })
    expect(state.level).toBe('high')
    expect(state.unstable).toBe(false)
  })

  it('flags low confidence for poor accuracy without modifying coordinates', () => {
    const tracker = new GpsConfidenceTracker()
    const state = tracker.ingest({
      lat: 39.55,
      lng: -105.78,
      accuracy: 120,
      timestampMs: 1000,
    })
    expect(state.level).toBe('low')
    expect(state.unstable).toBe(true)
  })

  it('flags unstable on implausible jumps', () => {
    const tracker = new GpsConfidenceTracker()
    tracker.ingest({ lat: 39.55, lng: -105.78, accuracy: 10, timestampMs: 1000 })
    const state = tracker.ingest({
      lat: 40.55,
      lng: -105.78,
      accuracy: 10,
      timestampMs: 2000,
    })
    expect(state.unstable).toBe(true)
  })
})
