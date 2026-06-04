import { describe, expect, it } from 'vitest'
import {
  createGpsQualityGateState,
  DEFAULT_GPS_QUALITY_GATE,
  evaluateGpsQuality,
} from './gpsQualityGate'
import type { RawGpsPoint } from './types'

function point(p: Partial<RawGpsPoint> & Pick<RawGpsPoint, 'lat' | 'lng'>): RawGpsPoint {
  return {
    accuracy: 10,
    heading: null,
    speed: null,
    timestampMs: Date.now(),
    ...p,
  }
}

describe('gpsQualityGate', () => {
  it('rejects poor accuracy', () => {
    const state = createGpsQualityGateState()
    const v = evaluateGpsQuality(
      point({ lat: 1, lng: 2, accuracy: 55, timestampMs: 1000 }),
      state,
      DEFAULT_GPS_QUALITY_GATE,
      2000,
    )
    expect(v.accept).toBe(false)
    if (!v.accept) expect(v.reasons).toContain('accuracy_poor')
  })

  it('rejects stationary duplicate drift', () => {
    const state = createGpsQualityGateState()
    evaluateGpsQuality(point({ lat: 39.74, lng: -105.0, timestampMs: 1000 }), state, DEFAULT_GPS_QUALITY_GATE, 2000)
    const v = evaluateGpsQuality(
      point({ lat: 39.7400005, lng: -105.0000005, timestampMs: 2500 }),
      state,
      DEFAULT_GPS_QUALITY_GATE,
      3000,
    )
    expect(v.accept).toBe(false)
    if (!v.accept) expect(v.reasons).toContain('duplicate_point')
  })

  it('rejects excessive jump', () => {
    const state = createGpsQualityGateState()
    evaluateGpsQuality(point({ lat: 39.74, lng: -105.0, timestampMs: 1000 }), state, DEFAULT_GPS_QUALITY_GATE, 2000)
    const v = evaluateGpsQuality(
      point({ lat: 39.75, lng: -105.1, timestampMs: 3000 }),
      state,
      DEFAULT_GPS_QUALITY_GATE,
      4000,
    )
    expect(v.accept).toBe(false)
    if (!v.accept) expect(v.reasons).toContain('excessive_jump')
  })

  it('accepts valid walking sample', () => {
    const state = createGpsQualityGateState()
    const v = evaluateGpsQuality(
      point({ lat: 39.74, lng: -105.0, accuracy: 12, timestampMs: 5000 }),
      state,
      DEFAULT_GPS_QUALITY_GATE,
      5100,
    )
    expect(v.accept).toBe(true)
  })
})
