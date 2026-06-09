import { describe, expect, it } from 'vitest'
import { EnvironmentalRelationshipLayer } from './EnvironmentalRelationshipLayer'
import { getERLState } from './erlStore'
import { computeERLTargets, applySignalSmoothing } from './signals'
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

describe('ERL integration — simulated field walk', () => {
  it('trailApproach rises smoothly over approach ticks', () => {
    const internal = createERLInternalState()
    const trailPos = { lat: 39.551, lng: -105.78 }
    let distance = 200
    const samples: number[] = []

    for (let i = 0; i < 8; i++) {
      const prev = distance
      distance = Math.max(40, distance - 18)
      internal.prevDistances.set('trail:walk', prev)

      const ctx: ERLTickContext = {
        fim: {
          position: { lat: 39.55, lng: -105.78 },
          headingDeg: 0,
          hasHeading: true,
          speedMps: 1.1,
          fieldIntent: 'NAVIGATION_ACTIVE',
          gpsUncertain: false,
          navigating: true,
        },
        atmosphere: CALM_ATM,
        spatialFeatures: [
          { id: 'trail:walk', kind: 'trail', position: trailPos },
        ],
        activeWaypoint: null,
        routePolyline: [],
        offRouteDistanceFeet: 0,
        offRouteThresholdFeet: 2640,
      nearestTrailDistanceM: distance,
      nearestCampDistanceM: null,
      campingOverlayEnabled: false,
        fireOverlayEnabled: false,
        sosActive: false,
        tickIntervalSec: 2,
      }

      const targets = computeERLTargets(ctx, internal, Date.now() + i * 2000)
      internal.smoothed = applySignalSmoothing(internal.smoothed, targets)
      samples.push(internal.smoothed.trailApproach)
    }

    expect(samples[0]).toBeLessThan(samples[samples.length - 1])
    expect(samples[samples.length - 1]).toBeGreaterThan(0.2)
  })

  it('desktop simulation bypasses missing GPS and produces non-zero trailApproach', () => {
    const erl = new EnvironmentalRelationshipLayer()
    const trailPos = { lat: 39.551, lng: -105.78 }
    erl.setContextProvider(() => ({
      fim: {
        position: null,
        headingDeg: null,
        hasHeading: false,
        speedMps: 0,
        fieldIntent: 'REGIONAL_OVERVIEW',
        gpsUncertain: true,
        navigating: false,
      },
      atmosphere: CALM_ATM,
      spatialFeatures: [],
      activeWaypoint: null,
      routePolyline: [],
      offRouteDistanceFeet: 0,
      offRouteThresholdFeet: 2640,
      nearestTrailDistanceM: null,
      nearestCampDistanceM: null,
      campingOverlayEnabled: false,
      fireOverlayEnabled: false,
      sosActive: false,
      tickIntervalSec: 2,
    }))
    erl.injectSimulatedMovement(
      {
        position: { lat: 39.549, lng: -105.78 },
        headingDeg: 0,
        hasHeading: true,
        speedMps: 1.2,
        gpsUncertain: false,
        navigating: true,
      },
      {
        nearestTrailDistanceM: 180,
        spatialFeatures: [{ id: 'trail:sim', kind: 'trail', position: trailPos }],
        approachTarget: trailPos,
      },
    )
    erl.activate()
    for (let i = 0; i < 6; i++) {
      erl.runTickForTests()
    }
    expect(getERLState().trailApproach).toBeGreaterThan(0)
    erl.deactivate()
  })

  it('handleSOSArmed zeroes published state', () => {
    const erl = new EnvironmentalRelationshipLayer()
    erl.setContextProvider(() => ({
      fim: {
        position: { lat: 39.55, lng: -105.78 },
        headingDeg: 0,
        hasHeading: true,
        speedMps: 1,
        fieldIntent: 'NAVIGATION_ACTIVE',
        gpsUncertain: false,
        navigating: true,
      },
      atmosphere: CALM_ATM,
      spatialFeatures: [{ id: 'trail:t', kind: 'trail', position: { lat: 39.551, lng: -105.78 } }],
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
    }))
    erl.activate()
    erl.runTickForTests()
    erl.handleSOSArmed()
    expect(getERLState().trailApproach).toBe(0)
    expect(getERLState().fieldPressure).toBe(0)
    erl.deactivate()
  })

  it('deactivates to zero on SOS', () => {
    const erl = new EnvironmentalRelationshipLayer()
    erl.setContextProvider(() => ({
      fim: {
        position: { lat: 39.55, lng: -105.78 },
        headingDeg: 0,
        hasHeading: true,
        speedMps: 1,
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
      nearestTrailDistanceM: null,
      nearestCampDistanceM: null,
      campingOverlayEnabled: false,
      fireOverlayEnabled: false,
      sosActive: true,
      tickIntervalSec: 2,
    }))
    erl.activate()
    erl.runTickForTests()
    expect(getERLState().trailApproach).toBe(0)
    erl.deactivate()
  })
})
