import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetOperationalStateGraphForTests,
  osgEnterMeasure,
  osgEnterMission,
  osgEnterRouteMode,
  osgSetRadialActive,
  transitionOperationalState,
} from '../operationalStateGraph'
import { environmentalToneForMode } from './environmentalTone'
import { perceptualMovementBand } from './spatialStability'
import { buildTransitionPacket } from './transitionAnimations'
import {
  __resetOperationalPerceptionForTests,
  commitCameraSnapshot,
  getPerceptionSnapshot,
  subscribePerception,
} from './perceptionEngine'

describe('operationalPerception', () => {
  beforeEach(() => {
    __resetOperationalStateGraphForTests()
    __resetOperationalPerceptionForTests()
  })

  it('never mutates OSG — only reads snapshots', () => {
    osgEnterMeasure('modern')
    const osgBefore = transitionOperationalState({ mode: 'route' }, 'test')
    expect(osgBefore).toBe(true)
    const snap = getPerceptionSnapshot()
    expect(snap.mode).toBe('route')
    expect(snap.lastPacket?.perceptualPath).toEqual(['measure', 'route'])
  })

  it('eliminates idle hops from perceptual transition path', () => {
    osgEnterRouteMode('balanced', 'plan')
    osgEnterMeasure('balanced')
    const snap = getPerceptionSnapshot()
    expect(snap.lastPacket?.logicalPath).toEqual(['idle', 'measure'])
    expect(snap.lastPacket?.perceptualPath).toEqual(['route', 'measure'])
  })

  it('maps movement bands per spec thresholds', () => {
    expect(perceptualMovementBand(0.1)).toBe('stationary')
    expect(perceptualMovementBand(0.25)).toBe('walking')
    expect(perceptualMovementBand(2)).toBe('dynamic')
  })

  it('emits mode-specific environmental tone', () => {
    const measureTone = environmentalToneForMode('measure')
    const missionTone = environmentalToneForMode('mission')
    expect(measureTone.desaturation).toBeGreaterThan(missionTone.desaturation)
    expect(missionTone.contrastBoost).toBeGreaterThan(measureTone.contrastBoost)
  })

  it('freezes camera profile for radial mode', () => {
    transitionOperationalState({ mode: 'radial' }, 'test_radial')
    const snap = getPerceptionSnapshot()
    expect(snap.camera.freezeCamera).toBe(true)
    expect(snap.tone.dimBackground).toBeGreaterThan(0)
  })

  it('tracks camera snapshot contract for radial transaction', () => {
    osgEnterMeasure('modern')
    osgSetRadialActive(true)
    commitCameraSnapshot({
      center: [-105, 40],
      zoom: 14,
      bearing: 0,
      pitch: 0,
      timestamp: Date.now(),
      mode: 'measure',
    })
    expect(getPerceptionSnapshot().cameraSnapshot?.zoom).toBe(14)
    osgSetRadialActive(false)
    expect(getPerceptionSnapshot().radialRestorePending).toBe(true)
  })

  it('notifies subscribers on OSG transition', () => {
    let calls = 0
    const unsub = subscribePerception(() => {
      calls += 1
    })
    osgEnterMission({ missionName: 'Patrol', kind: 'solo' })
    expect(calls).toBeGreaterThan(0)
    unsub()
  })

  it('clamps transition duration to spec bounds', () => {
    const packet = buildTransitionPacket({
      fromMode: 'idle',
      toMode: 'mission',
      logicalPath: ['idle', 'mission'],
      triggerSource: 'test',
    })
    expect(packet.durationMs).toBeGreaterThanOrEqual(250)
    expect(packet.durationMs).toBeLessThanOrEqual(2200)
  })
})
