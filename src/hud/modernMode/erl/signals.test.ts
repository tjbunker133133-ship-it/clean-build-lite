import { describe, expect, it } from 'vitest'
import {
  angularDifferenceDeg,
  applySignalSmoothing,
  bearingDeg,
  computeApproachVectorTargets,
  computeEnvironmentalPressureTarget,
  computeNavigationCoherenceTarget,
  computeProximityDeltaTargetsWithHistory,
  computeTemporalMoodTarget,
  intentionalRestDetected,
  normalize01,
  smoothScalar,
} from './signals'
import { createERLInternalState, type ERLTickContext } from './types'
import type { WeatherAtmosphere } from '../../../hooks/useWeatherAtmosphere'

const CALM_ATM: WeatherAtmosphere = {
  tone: 'clear',
  level: 'calm',
  weatherCode: 0,
  dimFactor: 0,
  colorFilter: 'none',
  ambientRgba: 'rgba(0,0,0,0)',
  hasActiveWeather: false,
  label: 'Clear',
  isThunderstorm: false,
}

function baseCtx(overrides: Partial<ERLTickContext> = {}): ERLTickContext {
  return {
    fim: {
      position: { lat: 39.55, lng: -105.78 },
      headingDeg: 90,
      hasHeading: true,
      speedMps: 1.2,
      fieldIntent: 'NAVIGATION_ACTIVE',
      gpsUncertain: false,
      navigating: true,
    },
    atmosphere: CALM_ATM,
    spatialFeatures: [],
    activeWaypoint: null,
    routePolyline: [],
    offRouteDistanceFeet: 0,
    offRouteThresholdFeet: 2640,
    nearestTrailDistanceM: 120,
    nearestCampDistanceM: null,
    campingOverlayEnabled: false,
    fireOverlayEnabled: false,
    sosActive: false,
    tickIntervalSec: 2,
    ...overrides,
  }
}

describe('ERL signals — proximity delta', () => {
  it('returns zero when receding from trail', () => {
    const internal = createERLInternalState()
    internal.prevDistances.set('trail:a', 80)
    const ctx = baseCtx({
      spatialFeatures: [
        {
          id: 'trail:a',
          kind: 'trail',
          position: { lat: 39.551, lng: -105.78 },
        },
      ],
    })
    const result = computeProximityDeltaTargetsWithHistory(ctx, internal.prevDistances)
    expect(result.trailApproach).toBe(0)
  })

  it('rises when approaching trail', () => {
    const internal = createERLInternalState()
    internal.prevDistances.set('trail:a', 120)
    const ctx = baseCtx({
      spatialFeatures: [
        {
          id: 'trail:a',
          kind: 'trail',
          position: { lat: 39.551, lng: -105.78 },
        },
      ],
    })
    const result = computeProximityDeltaTargetsWithHistory(ctx, internal.prevDistances)
    expect(result.trailApproach).toBeGreaterThan(0)
  })
})

describe('ERL signals — approach vector', () => {
  it('weights weather forward when heading toward feature', () => {
    const ctx = baseCtx({
      fim: {
        position: { lat: 39.55, lng: -105.78 },
        headingDeg: 0,
        hasHeading: true,
        speedMps: 1,
        fieldIntent: 'NAVIGATION_ACTIVE',
        gpsUncertain: false,
        navigating: true,
      },
      atmosphere: { ...CALM_ATM, hasActiveWeather: true, level: 'active', dimFactor: 0.1 },
      spatialFeatures: [
        {
          id: 'weather:cell',
          kind: 'weather',
          position: { lat: 39.552, lng: -105.78 },
          centroid: { lat: 39.552, lng: -105.78 },
        },
      ],
    })
    const ahead = computeApproachVectorTargets(ctx)
    const away = computeApproachVectorTargets({
      ...ctx,
      fim: { ...ctx.fim, headingDeg: 180 },
    })
    expect(ahead.forwardWeatherPressure).toBeGreaterThan(away.forwardWeatherPressure)
  })
})

describe('ERL signals — environmental pressure', () => {
  it('increases with weather severity', () => {
    const calm = computeEnvironmentalPressureTarget(baseCtx())
    const storm = computeEnvironmentalPressureTarget(
      baseCtx({
        atmosphere: {
          ...CALM_ATM,
          hasActiveWeather: true,
          level: 'intense',
          dimFactor: 0.18,
        },
      }),
    )
    expect(storm).toBeGreaterThan(calm)
  })
})

describe('ERL signals — navigation coherence', () => {
  it('is higher when heading toward active waypoint', () => {
    const wp = {
      id: 'wp:1',
      kind: 'waypoint' as const,
      position: { lat: 39.56, lng: -105.78 },
    }
    const toward = computeNavigationCoherenceTarget(
      baseCtx({
        activeWaypoint: wp,
        fim: {
          ...baseCtx().fim,
          headingDeg: 0,
          hasHeading: true,
        },
      }),
    )
    const away = computeNavigationCoherenceTarget(
      baseCtx({
        activeWaypoint: wp,
        fim: {
          ...baseCtx().fim,
          headingDeg: 180,
          hasHeading: true,
        },
      }),
    )
    expect(toward).toBeGreaterThan(away)
  })

  it('returns neutral when no route or waypoint', () => {
    expect(computeNavigationCoherenceTarget(baseCtx())).toBe(0.5)
  })
})

describe('ERL signals — intentional rest (Phase 4)', () => {
  it('suppresses temporal mood at active waypoint', () => {
    const internal = createERLInternalState()
    internal.dwellStartMs = Date.now() - 120_000
    const ctx = baseCtx({
      activeWaypoint: {
        id: 'wp:1',
        kind: 'waypoint',
        position: { lat: 39.5502, lng: -105.78 },
      },
      fim: {
        ...baseCtx().fim,
        position: { lat: 39.55, lng: -105.78 },
        speedMps: 0.1,
      },
    })
    expect(intentionalRestDetected(ctx, ctx.fim.position)).toBe(true)
    expect(computeTemporalMoodTarget(ctx, internal, Date.now())).toBe(0)
  })

  it('suppresses temporal mood near campground', () => {
    const internal = createERLInternalState()
    internal.dwellStartMs = Date.now() - 120_000
    const ctx = baseCtx({
      nearestCampDistanceM: 40,
      fim: {
        ...baseCtx().fim,
        speedMps: 0.1,
      },
    })
    expect(intentionalRestDetected(ctx, ctx.fim.position)).toBe(true)
    expect(computeTemporalMoodTarget(ctx, internal, Date.now())).toBe(0)
  })

  it('raises temporal mood after dwell away from features', () => {
    const internal = createERLInternalState()
    internal.dwellStartMs = Date.now() - 120_000
    const ctx = baseCtx({
      nearestCampDistanceM: 400,
      activeWaypoint: null,
      fim: {
        ...baseCtx().fim,
        speedMps: 0.1,
      },
    })
    expect(intentionalRestDetected(ctx, ctx.fim.position)).toBe(false)
    expect(computeTemporalMoodTarget(ctx, internal, Date.now())).toBeGreaterThan(0.35)
  })

  it('does not treat camping overlay toggle alone as intentional rest', () => {
    const ctx = baseCtx({
      campingOverlayEnabled: true,
      nearestCampDistanceM: null,
      activeWaypoint: null,
    })
    expect(intentionalRestDetected(ctx, ctx.fim.position)).toBe(false)
  })
})

describe('ERL helpers', () => {
  it('smoothScalar eases toward target', () => {
    expect(smoothScalar(0, 1, 0.15)).toBeCloseTo(0.15, 5)
  })

  it('normalize01 clamps', () => {
    expect(normalize01(5, 10)).toBe(0.5)
    expect(normalize01(15, 10)).toBe(1)
  })

  it('angularDifferenceDeg wraps correctly', () => {
    expect(angularDifferenceDeg(350, 10)).toBe(20)
  })

  it('bearingDeg points north', () => {
    const b = bearingDeg({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })
    expect(b).toBeCloseTo(0, 0)
  })

  it('applySignalSmoothing never steps to raw target', () => {
    const current = {
      trailApproach: 0,
      waypointApproach: 0,
      campApproach: 0,
      hazardApproach: 0,
      forwardWeatherPressure: 0,
      forwardHazardPressure: 0,
      rearHazardPressure: 0,
      fieldPressure: 0,
      temporalMood: 0,
      navCoherence: 0.5,
    }
    const targets = { ...current, trailApproach: 1, navCoherence: 1 }
    const next = applySignalSmoothing(current, targets)
    expect(next.trailApproach).toBeLessThan(1)
    expect(next.trailApproach).toBeGreaterThan(0)
  })
})
