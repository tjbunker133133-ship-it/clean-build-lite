import { describe, expect, it } from 'vitest'
import { computeFieldTargets } from './SpatialFieldEngine'
import { stepCameraPhysics, initCameraPhysicsFromMap, cameraPhysicsSettled } from './cameraPhysicsSolver'
import { fieldLayerInfluence, fieldEngineActive, cameraPhysicsActive } from './fieldLayerPolicy'
import type { OperationalStateGraph } from '../lib/operationalStateGraph/types'
import { DEFAULT_MISSION_SESSION } from '../lib/missionController/types'

function baseOsg(overrides: Partial<OperationalStateGraph> = {}): OperationalStateGraph {
  return {
    mode: 'idle',
    interaction: {
      pointerOwner: null,
      activeTool: 'idle',
      toolVariant: null,
      locked: false,
      surface: 'none',
      preRadialTool: 'idle',
      preRadialVariant: null,
      radialActive: false,
      radialAnchor: null,
      pendingWaypointType: 'nav',
    },
    session: {
      mission: { ...DEFAULT_MISSION_SESSION },
      routeId: null,
      routeName: '',
      routeWaypoints: [],
      waypoints: [],
      activeMeasurement: null,
    },
    runtime: {
      gps: { lat: null, lng: null, accuracy: null, updatedAt: null },
      environment: { ...DEFAULT_MISSION_SESSION.environment },
      mapSession: { presentationMode: 'legacy', basemap: 'topo', routeName: '' },
    },
    control: {
      lastTransition: 0,
      transitionSource: 'test',
      lastRejection: null,
      lastTransitionFrom: null,
      lastTransitionPath: [],
      conflictResolutionMode: 'strict',
    },
    ...overrides,
  }
}

describe('fieldLayerPolicy', () => {
  it('classic has zero influence and inactive engine', () => {
    expect(fieldLayerInfluence('classic')).toBe(0)
    expect(fieldEngineActive('classic')).toBe(false)
    expect(cameraPhysicsActive('classic')).toBe(false)
  })

  it('modern has full influence and physics', () => {
    expect(fieldLayerInfluence('modern')).toBe(1)
    expect(fieldEngineActive('modern')).toBe(true)
    expect(cameraPhysicsActive('modern')).toBe(true)
  })
})

describe('computeFieldTargets', () => {
  it('route mode yields high route intensity', () => {
    const t = computeFieldTargets(baseOsg({ mode: 'route' }))
    expect(t.routeIntensity).toBeGreaterThan(0.8)
  })

  it('radial active yields radial pressure 1', () => {
    const osg = baseOsg({ mode: 'radial' })
    osg.interaction.radialActive = true
    const t = computeFieldTargets(osg)
    expect(t.radialPressure).toBe(1)
  })

  it('active mission yields mission focus', () => {
    const osg = baseOsg({ mode: 'mission' })
    osg.session.mission.status = 'active'
    const t = computeFieldTargets(osg)
    expect(t.missionFocus).toBeGreaterThan(0.8)
  })
})

describe('stepCameraPhysics', () => {
  it('converges toward target without overshooting wildly', () => {
    let state = initCameraPhysicsFromMap(-122, 37, 12, 0, 45)
    const target = {
      centerLng: -122.0004,
      centerLat: 37.0004,
      zoom: 12.5,
      bearing: 8,
      pitch: 48,
      attractionWeight: 0.9,
    }
    for (let i = 0; i < 240; i++) {
      state = stepCameraPhysics(state, target, {
        positionK: 28,
        positionD: 9,
        zoomK: 18,
        zoomD: 7,
        bearingK: 12,
        bearingD: 5,
        pitchK: 10,
        pitchD: 4,
        maxCenterVel: 0.0008,
        maxZoomVel: 2.5,
        maxBearingVel: 90,
      }, 1 / 60)
    }
    expect(Math.abs(state.centerLng - target.centerLng)).toBeLessThan(0.002)
    expect(Math.abs(state.zoom - target.zoom)).toBeLessThan(0.5)
    expect(cameraPhysicsSettled(state, target, 0.002)).toBe(true)
  })
})
