/**
 * Camera Physics Solver — inertial, damped camera motion (Modern / immersive only).
 *
 * Internal velocity state lives in the controller — not OSG, not UI.
 * Deterministic spring-damper integration per frame.
 */

export type CameraPhysicsState = {
  centerLng: number
  centerLat: number
  zoom: number
  bearing: number
  pitch: number
  velLng: number
  velLat: number
  velZoom: number
  velBearing: number
  velPitch: number
}

export type CameraPhysicsTarget = {
  centerLng: number
  centerLat: number
  zoom: number
  bearing: number
  pitch: number
  /** Field-driven attraction weight 0–1 (navigationPull, missionFocus). */
  attractionWeight: number
}

export type CameraPhysicsConfig = {
  /** Position spring stiffness. */
  positionK: number
  /** Position damping. */
  positionD: number
  /** Zoom spring stiffness. */
  zoomK: number
  zoomD: number
  /** Bearing spring stiffness. */
  bearingK: number
  bearingD: number
  /** Pitch spring stiffness. */
  pitchK: number
  pitchD: number
  /** Max velocity caps (per second). */
  maxCenterVel: number
  maxZoomVel: number
  maxBearingVel: number
}

export const MODERN_CAMERA_PHYSICS_CONFIG: CameraPhysicsConfig = {
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

export const BALANCED_CAMERA_DAMPING_SCALE = 0.65

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function springAccel(displacement: number, velocity: number, k: number, d: number): number {
  return k * displacement - d * velocity
}

function normalizeBearingDelta(from: number, to: number): number {
  let d = to - from
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return d
}

/**
 * Integrate one physics step toward target.
 * attractionWeight scales stiffness — higher navigation pull = stronger follow.
 */
export function stepCameraPhysics(
  state: CameraPhysicsState,
  target: CameraPhysicsTarget,
  config: CameraPhysicsConfig,
  dtSec: number,
): CameraPhysicsState {
  if (dtSec <= 0) return state

  const w = clamp(target.attractionWeight, 0, 1)
  const posK = config.positionK * (0.4 + w * 0.6)
  const zoomK = config.zoomK * (0.5 + w * 0.5)
  const bearingK = config.bearingK * (0.3 + w * 0.7)

  const dLng = target.centerLng - state.centerLng
  const dLat = target.centerLat - state.centerLat
  const dZoom = target.zoom - state.zoom
  const dBearing = normalizeBearingDelta(state.bearing, target.bearing)
  const dPitch = target.pitch - state.pitch

  const accLng = springAccel(dLng, state.velLng, posK, config.positionD)
  const accLat = springAccel(dLat, state.velLat, posK, config.positionD)
  const accZoom = springAccel(dZoom, state.velZoom, zoomK, config.zoomD)
  const accBearing = springAccel(dBearing, state.velBearing, bearingK, config.bearingD)
  const accPitch = springAccel(dPitch, state.velPitch, config.pitchK, config.pitchD)

  let velLng = state.velLng + accLng * dtSec
  let velLat = state.velLat + accLat * dtSec
  let velZoom = state.velZoom + accZoom * dtSec
  let velBearing = state.velBearing + accBearing * dtSec
  let velPitch = state.velPitch + accPitch * dtSec

  const centerMag = Math.hypot(velLng, velLat)
  if (centerMag > config.maxCenterVel) {
    const s = config.maxCenterVel / centerMag
    velLng *= s
    velLat *= s
  }
  velZoom = clamp(velZoom, -config.maxZoomVel, config.maxZoomVel)
  velBearing = clamp(velBearing, -config.maxBearingVel, config.maxBearingVel)

  return {
    centerLng: state.centerLng + velLng * dtSec,
    centerLat: state.centerLat + velLat * dtSec,
    zoom: state.zoom + velZoom * dtSec,
    bearing: state.bearing + velBearing * dtSec,
    pitch: state.pitch + velPitch * dtSec,
    velLng,
    velLat,
    velZoom,
    velBearing,
    velPitch,
  }
}

export function initCameraPhysicsFromMap(
  centerLng: number,
  centerLat: number,
  zoom: number,
  bearing: number,
  pitch: number,
): CameraPhysicsState {
  return {
    centerLng,
    centerLat,
    zoom,
    bearing,
    pitch,
    velLng: 0,
    velLat: 0,
    velZoom: 0,
    velBearing: 0,
    velPitch: 0,
  }
}

export function cameraPhysicsSettled(state: CameraPhysicsState, target: CameraPhysicsTarget, epsilon = 1e-6): boolean {
  return (
    Math.abs(target.centerLng - state.centerLng) < epsilon &&
    Math.abs(target.centerLat - state.centerLat) < epsilon &&
    Math.abs(target.zoom - state.zoom) < 0.01 &&
    Math.abs(normalizeBearingDelta(state.bearing, target.bearing)) < 0.5 &&
    Math.abs(target.pitch - state.pitch) < 0.5 &&
    Math.hypot(state.velLng, state.velLat) < epsilon &&
    Math.abs(state.velZoom) < 0.01 &&
    Math.abs(state.velBearing) < 0.5
  )
}
