/**
 * Ephemeral camera velocity feedback for recursive field dynamics.
 * Camera controller publishes; field dynamics reads. No spatial authority.
 */

import type { CameraPhysicsState } from './cameraPhysicsSolver'

export type CameraPhysicsFeedback = {
  velocityMagnitude: number
  velLng: number
  velLat: number
  velZoom: number
  velBearing: number
  timestamp: number
}

const ZERO_FEEDBACK: CameraPhysicsFeedback = {
  velocityMagnitude: 0,
  velLng: 0,
  velLat: 0,
  velZoom: 0,
  velBearing: 0,
  timestamp: 0,
}

let feedback: CameraPhysicsFeedback = { ...ZERO_FEEDBACK }

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** Publish physics velocity — called by ModernCameraController only. */
export function publishCameraPhysicsFeedback(state: CameraPhysicsState): void {
  const centerMag = Math.hypot(state.velLng, state.velLat)
  const zoomMag = Math.abs(state.velZoom) * 0.02
  const bearingMag = Math.abs(state.velBearing) * 0.004
  const raw = centerMag * 800 + zoomMag + bearingMag
  feedback = {
    velocityMagnitude: clamp01(raw),
    velLng: state.velLng,
    velLat: state.velLat,
    velZoom: state.velZoom,
    velBearing: state.velBearing,
    timestamp: performance.now(),
  }
}

export function getCameraPhysicsFeedback(): CameraPhysicsFeedback {
  return feedback
}

export function resetCameraPhysicsFeedback(): void {
  feedback = { ...ZERO_FEEDBACK }
}
