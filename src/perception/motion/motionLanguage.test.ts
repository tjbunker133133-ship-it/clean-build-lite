import { describe, expect, it } from 'vitest'
import { applyMotionEasing } from './easingCurves'
import { opacityInTier } from './opacityCadence'
import {
  atmosphericBreathFactor,
  computeFieldEmergence,
  getMotionProfile,
  layerTransitionDuration,
  refineCameraPhysicsConfig,
  resolveMotionLayer,
} from './motionLanguage'
import { MOTION_PROFILES } from './motionProfiles'
import type { RecursiveFieldSnapshot } from '../../field/recursive/types'

function mockField(overrides: Partial<RecursiveFieldSnapshot> = {}): RecursiveFieldSnapshot {
  return {
    routeIntensity: 0.3,
    missionFocus: 0.4,
    navigationPull: 0.5,
    radialPressure: 0.6,
    environmentalAwareness: 0.2,
    cameraStability: 0.8,
    layerInfluence: 1,
    tick: 1,
    timestamp: 1000,
    velocity: {
      routeIntensity: 0,
      missionFocus: 0,
      navigationPull: 0.01,
      radialPressure: 0,
      environmentalAwareness: 0,
    },
    acceleration: {
      routeIntensity: 0,
      missionFocus: 0,
      navigationPull: 0,
      radialPressure: 0,
      environmentalAwareness: 0,
    },
    inertiaBias: 0.05,
    perceptualLag: 0.1,
    coherence: 0.9,
    predicted: {
      routeIntensity: 0.32,
      missionFocus: 0.42,
      navigationPull: 0.52,
      radialPressure: 0.62,
      environmentalAwareness: 0.22,
    },
    recursiveGain: 1,
    ...overrides,
  }
}

describe('motionProfiles', () => {
  it('classic is immediate and deterministic', () => {
    const p = MOTION_PROFILES.classic
    expect(p.emergenceSoftness).toBe(0)
    expect(p.atmosphericBreathHz).toBe(0)
    expect(p.fadeFastMs).toBeLessThan(MOTION_PROFILES.modern.fadeFastMs)
  })

  it('modern has full emergence and atmospheric continuity', () => {
    const p = MOTION_PROFILES.modern
    expect(p.emergenceSoftness).toBe(1)
    expect(p.atmosphericBreathHz).toBeGreaterThan(0)
    expect(p.cameraTurnAnticipation).toBeGreaterThan(MOTION_PROFILES.balanced.cameraTurnAnticipation)
  })
})

describe('computeFieldEmergence', () => {
  it('returns continuous opacity without binary gates', () => {
    const low = computeFieldEmergence(
      mockField({ radialPressure: 0.1, navigationPull: 0.12 }),
      getMotionProfile('modern'),
    )
    const high = computeFieldEmergence(
      mockField({ radialPressure: 0.95, navigationPull: 0.9 }),
      getMotionProfile('modern'),
    )
    expect(low.radialOpacity).toBeLessThan(high.radialOpacity)
    expect(low.radialOpacity).toBeGreaterThan(0)
    expect(high.radialOpacity).toBeLessThanOrEqual(1)
  })

  it('classic profile bypasses soft emergence', () => {
    const out = computeFieldEmergence(
      mockField({ radialPressure: 0.7 }),
      getMotionProfile('classic'),
    )
    expect(out.radialOpacity).toBe(0.7)
  })
})

describe('atmosphericBreathFactor', () => {
  it('oscillates subtly around 1', () => {
    const profile = getMotionProfile('modern')
    const a = atmosphericBreathFactor(0.9, 0, profile)
    const b = atmosphericBreathFactor(0.9, 5000, profile)
    expect(a).toBeGreaterThan(0.98)
    expect(a).toBeLessThan(1.05)
    expect(Math.abs(a - b)).toBeGreaterThan(0.001)
  })
})

describe('refineCameraPhysicsConfig', () => {
  it('increases damping with coherence in modern', () => {
    const base = {
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
    }
    const low = refineCameraPhysicsConfig(base, {
      coherence: 0.3,
      speedMs: 0.2,
      bearingDelta: 0,
      reducedMotion: false,
    }, getMotionProfile('modern'))
    const high = refineCameraPhysicsConfig(base, {
      coherence: 0.95,
      speedMs: 0.2,
      bearingDelta: 0,
      reducedMotion: false,
    }, getMotionProfile('modern'))
    expect(high.positionD).toBeGreaterThan(low.positionD)
  })
})

describe('layerTransitionDuration', () => {
  it('scales by layer personality', () => {
    const base = 400
    expect(layerTransitionDuration(base, 'classic')).toBeLessThan(
      layerTransitionDuration(base, 'modern'),
    )
  })
})

describe('opacityInTier', () => {
  it('atmospheric tier caps opacity low', () => {
    expect(opacityInTier(1, 'atmospheric', 'modern')).toBeLessThan(0.25)
    expect(opacityInTier(1, 'system', 'modern')).toBeGreaterThan(0.5)
  })
})

describe('applyMotionEasing', () => {
  it('organism curves stay bounded', () => {
    expect(applyMotionEasing(0, 'organismSettle')).toBe(0)
    expect(applyMotionEasing(1, 'organismSettle')).toBeCloseTo(1, 1)
  })
})
