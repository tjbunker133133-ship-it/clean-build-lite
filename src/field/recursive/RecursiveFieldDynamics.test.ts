import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { publishCameraPhysicsFeedback, resetCameraPhysicsFeedback } from '../cameraPhysicsFeedback'
import { initCameraPhysicsFromMap } from '../cameraPhysicsSolver'
import type { SpatialFieldSnapshot } from '../types'
import { computeSoftEmergence, predictFields, sigmoid, smoothstep } from './fieldMath'
import {
  __resetRecursiveFieldDynamicsForTests,
  getRecursiveFieldSnapshot,
  setPerceptionFieldFeedback,
  stepRecursiveFieldDynamics,
} from './RecursiveFieldDynamics'

function baseSnapshot(overrides: Partial<SpatialFieldSnapshot> = {}): SpatialFieldSnapshot {
  return {
    routeIntensity: 0,
    missionFocus: 0,
    navigationPull: 0,
    radialPressure: 0,
    environmentalAwareness: 0,
    cameraStability: 1,
    layerInfluence: 1,
    tick: 1,
    timestamp: 1000,
    ...overrides,
  }
}

describe('fieldMath soft emergence', () => {
  it('sigmoid produces continuous values without hard cutoff', () => {
    expect(sigmoid(0)).toBeLessThan(0.2)
    expect(sigmoid(0.5)).toBeCloseTo(0.5, 1)
    expect(sigmoid(1)).toBeGreaterThan(0.8)
  })

  it('smoothstep ramps continuously', () => {
    expect(smoothstep(0.2, 0.8, 0)).toBe(0)
    expect(smoothstep(0.2, 0.8, 1)).toBe(1)
    const mid = smoothstep(0.2, 0.8, 0.5)
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThan(0.8)
  })
})

function mockHudMode(mode: 'immersive' | 'hybrid' | 'legacy'): void {
  vi.stubGlobal('window', {
    __HUD_RUNTIME__: {
      isImmersive: mode === 'immersive',
      isHybrid: mode === 'hybrid',
      isLegacy: mode === 'legacy',
    },
  })
}

describe('stepRecursiveFieldDynamics', () => {
  beforeEach(() => {
    __resetRecursiveFieldDynamicsForTests()
    resetCameraPhysicsFeedback()
    setPerceptionFieldFeedback({ stable: true, frozen: false })
    mockHudMode('immersive')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passthrough when gain is zero (classic bypass)', () => {
    mockHudMode('legacy')
    __resetRecursiveFieldDynamicsForTests()
    const input = baseSnapshot({ radialPressure: 0.8, layerInfluence: 0 })
    const out = stepRecursiveFieldDynamics(input, 1 / 60)
    expect(out.radialPressure).toBe(0.8)
    expect(out.recursiveGain).toBe(0)
    expect(out.coherence).toBe(1)
    mockHudMode('immersive')
  })

  it('smooths toward base fields over multiple ticks with partial gain', () => {
    const s0 = baseSnapshot({ navigationPull: 0 })
    stepRecursiveFieldDynamics(s0, 1 / 60)
    const s1 = baseSnapshot({ navigationPull: 1, tick: 2, timestamp: 2000 })
    const out = stepRecursiveFieldDynamics(s1, 1 / 60)
    expect(out.navigationPull).toBeGreaterThan(0)
    expect(out.navigationPull).toBeLessThan(1)
    expect(out.velocity.navigationPull).toBeDefined()
  })

  it('coherence floors prevent runaway oscillation', () => {
    let prev = baseSnapshot({ navigationPull: 0.2 })
    stepRecursiveFieldDynamics(prev, 1 / 60)
    for (let i = 0; i < 30; i++) {
      const flip = i % 2 === 0 ? 0.95 : 0.05
      prev = baseSnapshot({ navigationPull: flip, tick: i + 2, timestamp: 1000 + i * 16 })
      stepRecursiveFieldDynamics(prev, 1 / 60)
    }
    const snap = getRecursiveFieldSnapshot()
    expect(snap.coherence).toBeGreaterThanOrEqual(0.25)
    expect(snap.navigationPull).toBeGreaterThanOrEqual(0)
    expect(snap.navigationPull).toBeLessThanOrEqual(1)
  })

  it('camera feedback influences inertiaBias without mutating base fields', () => {
    publishCameraPhysicsFeedback(
      initCameraPhysicsFromMap(-122, 37, 12, 0, 45),
    )
    const physics = initCameraPhysicsFromMap(-122, 37, 12, 0, 45)
    physics.velLng = 0.0005
    physics.velLat = 0.0003
    publishCameraPhysicsFeedback(physics)

    const out = stepRecursiveFieldDynamics(
      baseSnapshot({ navigationPull: 0.6, radialPressure: 0.7 }),
      1 / 60,
    )
    expect(out.inertiaBias).toBeGreaterThan(0)
    expect(out.perceptualLag).toBeGreaterThan(0)
  })

  it('predicted fields anticipate ahead of current', () => {
    stepRecursiveFieldDynamics(baseSnapshot({ navigationPull: 0.3 }), 1 / 60)
    const rising = stepRecursiveFieldDynamics(
      baseSnapshot({ navigationPull: 0.9, tick: 2 }),
      1 / 60,
    )
    if (rising.velocity.navigationPull > 0) {
      expect(rising.predicted.navigationPull).toBeGreaterThanOrEqual(rising.navigationPull)
    }
  })
})

describe('computeSoftEmergence', () => {
  it('returns continuous opacity without binary visibility flags', () => {
    const snap = getRecursiveFieldSnapshot()
    const low = computeSoftEmergence({
      ...snap,
      radialPressure: 0.1,
      navigationPull: 0.15,
      missionFocus: 0.1,
      coherence: 0.9,
      inertiaBias: 0.05,
      perceptualLag: 0.1,
      cameraStability: 0.8,
    })
    const high = computeSoftEmergence({
      ...snap,
      radialPressure: 0.95,
      navigationPull: 0.9,
      missionFocus: 0.85,
      coherence: 0.95,
      inertiaBias: 0.02,
      perceptualLag: 0.05,
      cameraStability: 0.9,
    })
    expect(low.radialOpacity).toBeLessThan(high.radialOpacity)
    expect(low.navigationHintOpacity).toBeLessThan(high.navigationHintOpacity)
    expect(high.radialOpacity).toBeLessThanOrEqual(1)
    expect(low.radialOpacity).toBeGreaterThanOrEqual(0)
  })
})

describe('predictFields', () => {
  it('extrapolates with velocity and acceleration horizons', () => {
    const current = {
      routeIntensity: 0.5,
      missionFocus: 0.5,
      navigationPull: 0.5,
      radialPressure: 0.5,
      environmentalAwareness: 0.5,
    }
    const velocity = {
      routeIntensity: 0.1,
      missionFocus: 0,
      navigationPull: 0.2,
      radialPressure: 0,
      environmentalAwareness: 0,
    }
    const acceleration = {
      routeIntensity: 0,
      missionFocus: 0,
      navigationPull: 0.05,
      radialPressure: 0,
      environmentalAwareness: 0,
    }
    const predicted = predictFields(current, velocity, acceleration)
    expect(predicted.navigationPull).toBeGreaterThan(current.navigationPull)
  })
})
