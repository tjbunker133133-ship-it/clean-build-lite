import { describe, expect, it } from 'vitest'
import { validateSnapResult } from './snapValidation'
import type { RawGpsPoint, SnappedTrackPoint } from './types'

const raw: RawGpsPoint = {
  lat: 39.74,
  lng: -105.0,
  accuracy: 10,
  heading: 90,
  speed: 1,
  timestampMs: 1000,
}

const snapped: SnappedTrackPoint = {
  snappedLat: 39.74001,
  snappedLng: -104.99999,
  snappedRoadName: 'path',
  confidenceScore: 0.9,
  snapDistanceMeters: 4,
  sourceProvider: 'maplibre-local',
  rawTimestampMs: 1000,
  processedAtMs: 1100,
}

describe('snapValidation', () => {
  it('accepts close high-confidence snap', () => {
    const v = validateSnapResult(raw, snapped)
    expect(v.accept).toBe(true)
  })

  it('rejects snap beyond distance threshold', () => {
    const v = validateSnapResult(raw, { ...snapped, snapDistanceMeters: 45 })
    expect(v.accept).toBe(false)
    if (!v.accept) expect(v.reasons).toContain('snap_distance_exceeded')
  })

  it('rejects low confidence', () => {
    const v = validateSnapResult(raw, { ...snapped, confidenceScore: 0.1 })
    expect(v.accept).toBe(false)
    if (!v.accept) expect(v.reasons).toContain('confidence_low')
  })
})
