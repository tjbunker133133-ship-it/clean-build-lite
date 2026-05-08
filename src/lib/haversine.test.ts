import { describe, expect, it } from 'vitest'
import {
  formatDistance,
  haversineDistance,
  haversineMeters,
  totalRouteDistance,
} from './haversine'

// Contract / accuracy locks for pin-to-pin distance math.
// Pinning these prevents accidental drift in the spherical great-circle
// formula, the meters→miles→feet conversion ratios, and the display
// formatter that both the on-map segment chip and the waypoint-panel
// per-leg row depend on.

const M_PER_MI = 1609.344

describe('haversineMeters (great-circle, spherical R=6,371 km)', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(40.7128, -74.006, 40.7128, -74.006)).toBe(0)
    expect(haversineMeters(0, 0, 0, 0)).toBe(0)
  })

  it('is symmetric: d(A,B) === d(B,A)', () => {
    const a = haversineMeters(40.7128, -74.006, 34.0522, -118.2437)
    const b = haversineMeters(34.0522, -118.2437, 40.7128, -74.006)
    expect(a).toBe(b)
  })

  it('1° of latitude on the equator ≈ 111.195 km (within 0.1%)', () => {
    // π * R / 180 = 111,194.9266 m
    const m = haversineMeters(0, 0, 1, 0)
    expect(m).toBeGreaterThan(111_080)
    expect(m).toBeLessThan(111_310)
  })

  it('1° of longitude on the equator ≈ 111.195 km', () => {
    const m = haversineMeters(0, 0, 0, 1)
    expect(m).toBeGreaterThan(111_080)
    expect(m).toBeLessThan(111_310)
  })

  it('1° of longitude at 60°N ≈ 55.6 km (cos 60° = 0.5)', () => {
    const m = haversineMeters(60, 0, 60, 1)
    expect(m).toBeGreaterThan(55_400)
    expect(m).toBeLessThan(55_800)
  })

  it('NYC ↔ LA ≈ 3,936 km (within 0.5% of WGS84 ellipsoid)', () => {
    // True WGS84/Vincenty: ~3,935.75 km. Spherical haversine over the
    // same pair: ~3,935.84 km. We accept anything within ±20 km (0.5%).
    const m = haversineMeters(40.7128, -74.006, 34.0522, -118.2437)
    expect(m).toBeGreaterThan(3_915_000)
    expect(m).toBeLessThan(3_955_000)
  })

  it('antipodal points equal πR ≈ 20,015 km (half circumference)', () => {
    // π * 6,371,000 = 20,015,086 m
    const m = haversineMeters(0, 0, 0, 180)
    expect(m).toBeGreaterThan(20_010_000)
    expect(m).toBeLessThan(20_020_000)
  })
})

describe('haversineDistance (miles + feet conversions)', () => {
  it('miles === meters / 1609.344', () => {
    const { miles } = haversineDistance(0, 0, 1, 0)
    const m = haversineMeters(0, 0, 1, 0)
    expect(miles).toBeCloseTo(m / M_PER_MI, 9)
  })

  it('feet === miles * 5280 (exact integer ratio)', () => {
    const { miles, feet } = haversineDistance(40.7128, -74.006, 34.0522, -118.2437)
    expect(feet).toBeCloseTo(miles * 5280, 6)
  })

  it('returns 0 / 0 for identical points', () => {
    const { miles, feet } = haversineDistance(40, -74, 40, -74)
    expect(miles).toBe(0)
    expect(feet).toBe(0)
  })
})

describe('formatDistance (display contract)', () => {
  it('renders rounded integer feet for sub-0.1 mi', () => {
    // 0.05 mi * 5280 = 264 ft
    expect(formatDistance(0.05)).toBe('264 ft')
    // 0.0001 mi * 5280 = 0.528 → rounds to 1 ft
    expect(formatDistance(0.0001)).toBe('1 ft')
    expect(formatDistance(0)).toBe('0 ft')
  })

  it('renders 2-decimal miles at and above 0.1 mi', () => {
    expect(formatDistance(0.1)).toBe('0.10 mi')
    expect(formatDistance(1)).toBe('1.00 mi')
    expect(formatDistance(123.456)).toBe('123.46 mi')
  })
})

describe('totalRouteDistance', () => {
  it('returns 0 for empty or single-point routes', () => {
    expect(totalRouteDistance([]).miles).toBe(0)
    expect(totalRouteDistance([{ lat: 40, lng: -74 }]).miles).toBe(0)
  })

  it('equals haversineDistance for a 2-point route', () => {
    const a = { lat: 40.7128, lng: -74.006 }
    const b = { lat: 34.0522, lng: -118.2437 }
    const total = totalRouteDistance([a, b]).miles
    const direct = haversineDistance(a.lat, a.lng, b.lat, b.lng).miles
    expect(total).toBeCloseTo(direct, 9)
  })

  it('sums per-leg distances for a 4-point route', () => {
    const pts = [
      { lat: 40, lng: -100 },
      { lat: 41, lng: -99 },
      { lat: 42, lng: -98 },
      { lat: 43, lng: -97 },
    ]
    let expected = 0
    for (let i = 1; i < pts.length; i += 1) {
      expected += haversineDistance(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng).miles
    }
    expect(totalRouteDistance(pts).miles).toBeCloseTo(expected, 9)
  })

  it('feet === miles * 5280 on totals', () => {
    const pts = [
      { lat: 40, lng: -100 },
      { lat: 41, lng: -99 },
    ]
    const r = totalRouteDistance(pts)
    expect(r.feet).toBeCloseTo(r.miles * 5280, 6)
  })
})
