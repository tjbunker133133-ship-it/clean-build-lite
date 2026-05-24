import { describe, expect, it } from 'vitest'
import { polylineDistance } from './haversine'
import { __routeOnRichSegmentsForTests, computeTrailRoute } from './trailRoute'

describe('trailRoute segment-chain routing', () => {
  it('follows a switchback polyline instead of cutting the diagonal', () => {
    const segments = [
      {
        coords: [
          { lat: 40, lng: -74.01 },
          { lat: 40.001, lng: -74.01 },
          { lat: 40.001, lng: -74.009 },
          { lat: 40, lng: -74.009 },
        ],
        lengthM: 300,
      },
    ]
    const from = { lat: 40, lng: -74.01 }
    const to = { lat: 40.001, lng: -74.009 }
    const leg = __routeOnRichSegmentsForTests(segments, from, to)
    expect(leg.mode).toBe('trail')
    expect(leg.points.length).toBeGreaterThanOrEqual(2)
    const direct = polylineDistance([from, to]).miles
    expect(leg.distance.miles).toBeGreaterThan(direct * 1.2)
  })

  it('falls back to direct when no segments connect', () => {
    const from = { lat: 40, lng: -74 }
    const to = { lat: 40.01, lng: -74.01 }
    const leg = __routeOnRichSegmentsForTests([], from, to)
    expect(leg.mode).toBe('direct')
  })

  it('computeTrailRoute builds coordinates for multi-point routes', () => {
    const wps = [
      { lat: 40, lng: -74.02 },
      { lat: 40, lng: -74.0 },
    ]
    const route = computeTrailRoute(null, wps, false)
    expect(route.coordinates.length).toBe(2)
    expect(route.legs).toHaveLength(1)
  })
})
