import { describe, expect, it } from 'vitest'
import { corridorSeverity } from './corridor'
import { corridorEdgeAlert, detectOffRoute, OFF_ROUTE_FALLBACK_FEET } from './offRoute'

describe('offRoute', () => {
  it('uses 0.5 mile fallback when no trail geometry', () => {
    const route = [
      { lat: 39.55, lng: -105.78 },
      { lat: 39.56, lng: -105.77 },
    ]
    const onPath = detectOffRoute(39.555, -105.775, route, { hasTrailGeometry: false })
    expect(onPath.offRoute).toBe(false)

    const far = detectOffRoute(39.57, -105.75, route, { hasTrailGeometry: false })
    expect(far.thresholdFeet).toBe(OFF_ROUTE_FALLBACK_FEET)
    expect(far.offRoute).toBe(true)
    expect(far.advisory).toBeTruthy()
  })

  it('uses corridor band when trail geometry exists', () => {
    const route = [
      { lat: 39.55, lng: -105.78 },
      { lat: 39.56, lng: -105.77 },
    ]
    const result = detectOffRoute(39.57, -105.75, route, { hasTrailGeometry: true })
    expect(result.offRoute).toBe(true)
  })

  it('maps corridor severity to offline edge alert', () => {
    expect(corridorEdgeAlert(corridorSeverity(5100))).toBe('Approaching offline map edge')
    expect(corridorEdgeAlert(0)).toBeNull()
  })
})
