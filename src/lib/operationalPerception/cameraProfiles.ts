import type { OperationalMode } from '../operationalStateGraph/types'
import type { CameraProfile } from './types'

/** Mode → camera profile mapping (Perception Layer v1.0). */
export const CAMERA_PROFILES: Record<OperationalMode, CameraProfile> = {
  idle: {
    zoom: null,
    pitch: 14,
    bearing: null,
    followGps: false,
    freezeCamera: false,
    zoomDamping: 0,
  },
  measure: {
    zoom: null,
    pitch: 22,
    bearing: null,
    followGps: false,
    freezeCamera: false,
    zoomDamping: 0.18,
  },
  route: {
    zoom: null,
    pitch: 32,
    bearing: null,
    followGps: false,
    freezeCamera: false,
    zoomDamping: 0.12,
  },
  mission: {
    zoom: null,
    pitch: 42,
    bearing: null,
    followGps: true,
    freezeCamera: false,
    zoomDamping: 0.1,
  },
  navigation: {
    zoom: null,
    pitch: 38,
    bearing: null,
    followGps: true,
    freezeCamera: false,
    zoomDamping: 0.08,
  },
  radial: {
    zoom: null,
    pitch: 0,
    bearing: null,
    followGps: false,
    freezeCamera: true,
    zoomDamping: 0,
  },
}

export function cameraProfileForMode(mode: OperationalMode): CameraProfile {
  return { ...CAMERA_PROFILES[mode] }
}

/** Speed-based pitch for navigation (km/h). */
export function navigationPitchForSpeed(speedMs: number): number {
  const kmh = speedMs * 3.6
  if (kmh < 0.8) return 28
  if (kmh <= 5) return 34
  return 42
}

/** Speed-based zoom offset for navigation follow. */
export function navigationZoomOffsetForSpeed(speedMs: number): number {
  const kmh = speedMs * 3.6
  if (kmh < 0.8) return 0
  if (kmh <= 5) return 0.25
  return -0.15
}
