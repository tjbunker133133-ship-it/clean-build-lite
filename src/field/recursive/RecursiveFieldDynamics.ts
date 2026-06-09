/**
 * Recursive Field Dynamics — second-order transforms on SpatialFieldEngine output.
 *
 * Feedback loop: OSG → Field → Camera → Perception → Field (next tick)
 *
 * Does NOT store authoritative spatial state. Ephemeral derivative buffers only.
 */

import { getCameraPhysicsFeedback } from '../cameraPhysicsFeedback'
import {
  fieldEngineActive,
  recursiveDynamicsGain,
  resolveFieldLayerMode,
} from '../fieldLayerPolicy'
import type { SpatialFieldSnapshot, SpatialFieldValues } from '../types'
import {
  clamp01,
  clampFields,
  fieldMagnitude,
  lerp,
  predictFields,
  subtractFields,
} from './fieldMath'
import type { RecursiveFieldSnapshot } from './types'

const listeners = new Set<() => void>()

const ZERO: SpatialFieldValues = {
  routeIntensity: 0,
  missionFocus: 0,
  navigationPull: 0,
  radialPressure: 0,
  environmentalAwareness: 0,
}

/** Ephemeral tick buffers — not OSG truth. */
let prevBase: SpatialFieldValues = { ...ZERO }
let prevRecursive: SpatialFieldValues = { ...ZERO }
let prevVelocity: SpatialFieldValues = { ...ZERO }
let hasPrev = false

let snapshot: RecursiveFieldSnapshot = makePassthrough({
  ...ZERO,
  cameraStability: 1,
  layerInfluence: 0,
  tick: 0,
  timestamp: 0,
}, 0)

export type PerceptionFieldFeedback = {
  stable: boolean
  frozen: boolean
}

let perceptionFeedback: PerceptionFieldFeedback = { stable: true, frozen: false }

function emit(): void {
  listeners.forEach((fn) => fn())
}

function makePassthrough(base: SpatialFieldSnapshot, gain: number): RecursiveFieldSnapshot {
  return {
    ...base,
    velocity: { ...ZERO },
    acceleration: { ...ZERO },
    inertiaBias: 0,
    perceptualLag: 0,
    coherence: 1,
    predicted: { ...base },
    recursiveGain: gain,
  }
}

/** Perception publishes read-only feedback — no circular OSG mutation. */
export function setPerceptionFieldFeedback(feedback: PerceptionFieldFeedback): void {
  perceptionFeedback = feedback
}

export function getPerceptionFieldFeedback(): PerceptionFieldFeedback {
  return perceptionFeedback
}

function smoothFieldChannel(
  current: number,
  target: number,
  alpha: number,
  feedback: number,
): number {
  const blended = lerp(current, target, alpha)
  return clamp01(blended + feedback)
}

/**
 * Transform base field snapshot into recursive dynamics state.
 * Called each SpatialFieldEngine tick.
 */
export function stepRecursiveFieldDynamics(
  base: SpatialFieldSnapshot,
  dtSec: number,
): RecursiveFieldSnapshot {
  const layer = resolveFieldLayerMode()
  const gain = recursiveDynamicsGain(layer)

  if (!fieldEngineActive(layer) || gain <= 0) {
    const passthrough = makePassthrough(base, 0)
    snapshot = passthrough
    hasPrev = false
    prevBase = { ...ZERO }
    prevRecursive = { ...ZERO }
    prevVelocity = { ...ZERO }
    emit()
    return passthrough
  }

  const baseValues: SpatialFieldValues = {
    routeIntensity: base.routeIntensity,
    missionFocus: base.missionFocus,
    navigationPull: base.navigationPull,
    radialPressure: base.radialPressure,
    environmentalAwareness: base.environmentalAwareness,
  }

  const camera = getCameraPhysicsFeedback()
  const camVel = camera.velocityMagnitude

  const velocityDelta = hasPrev ? subtractFields(baseValues, prevBase) : { ...ZERO }
  const acceleration = hasPrev ? subtractFields(velocityDelta, prevVelocity) : { ...ZERO }

  const inertiaBias = clamp01(camVel * 0.08 * gain)
  const perceptualLag = clamp01(
    0.1 * gain +
      inertiaBias * 0.5 +
      (perceptionFeedback.frozen ? 0.12 * gain : 0) +
      (perceptionFeedback.stable ? 0 : 0.08 * gain),
  )

  const oscillation = fieldMagnitude(acceleration)
  const coherence = clamp01(1 - oscillation * 6 * gain - camVel * 0.15 * gain)
  const coherenceFloored = Math.max(0.25, coherence)

  const stabilityFactor = perceptionFeedback.stable ? 1 : 0.65
  const adaptiveAlpha = clamp01(
    (0.12 + coherenceFloored * 0.38) * gain * stabilityFactor,
  )

  const dampingFloor = 1 - inertiaBias * 0.25
  const feedbackNav = inertiaBias * 0.04 * dampingFloor
  const feedbackRadial = -inertiaBias * 0.03 * dampingFloor

  const nextRecursive: SpatialFieldValues = clampFields({
    routeIntensity: smoothFieldChannel(
      prevRecursive.routeIntensity,
      baseValues.routeIntensity,
      adaptiveAlpha,
      0,
    ),
    missionFocus: smoothFieldChannel(
      prevRecursive.missionFocus,
      baseValues.missionFocus,
      adaptiveAlpha,
      inertiaBias * 0.02,
    ),
    navigationPull: smoothFieldChannel(
      prevRecursive.navigationPull,
      baseValues.navigationPull,
      adaptiveAlpha,
      feedbackNav,
    ),
    radialPressure: smoothFieldChannel(
      prevRecursive.radialPressure,
      baseValues.radialPressure,
      adaptiveAlpha * 1.1,
      feedbackRadial,
    ),
    environmentalAwareness: smoothFieldChannel(
      prevRecursive.environmentalAwareness,
      baseValues.environmentalAwareness,
      adaptiveAlpha * 0.9,
      0,
    ),
  })

  const velocity = hasPrev ? subtractFields(nextRecursive, prevRecursive) : { ...ZERO }
  const predicted = predictFields(nextRecursive, velocity, acceleration)

  const recursiveCameraStability = clamp01(
    base.cameraStability * coherenceFloored * (1 - camVel * 0.12),
  )

  snapshot = {
    ...nextRecursive,
    cameraStability: recursiveCameraStability,
    layerInfluence: base.layerInfluence,
    tick: base.tick,
    timestamp: base.timestamp,
    velocity,
    acceleration,
    inertiaBias,
    perceptualLag,
    coherence: coherenceFloored,
    predicted,
    recursiveGain: gain,
  }

  prevBase = { ...baseValues }
  prevRecursive = { ...nextRecursive }
  prevVelocity = { ...velocityDelta }
  hasPrev = true

  emit()
  return snapshot
}

export function getRecursiveFieldSnapshot(): RecursiveFieldSnapshot {
  return snapshot
}

export function subscribeRecursiveField(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function __resetRecursiveFieldDynamicsForTests(): void {
  hasPrev = false
  prevBase = { ...ZERO }
  prevRecursive = { ...ZERO }
  prevVelocity = { ...ZERO }
  perceptionFeedback = { stable: true, frozen: false }
  snapshot = makePassthrough(
    { ...ZERO, cameraStability: 1, layerInfluence: 0, tick: 0, timestamp: 0 },
    0,
  )
}
