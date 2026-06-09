import type { RecursiveFieldSnapshot } from '../../field/recursive/types'
import type { OperationalMode } from '../operationalStateGraph/types'

export type PerceptualMovementBand = 'stationary' | 'walking' | 'dynamic'

export type EasingCurve = 'easeOutCubic' | 'easeInOutQuad' | 'springDamped' | 'linear'

export type CameraIntent =
  | { kind: 'ease_to'; center?: [number, number]; zoom?: number; bearing?: number; durationMs: number }
  | { kind: 'zoom_by'; delta: number; durationMs: number }

export type CameraSnapshot = {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
  timestamp: number
  mode: OperationalMode
}

export type CameraProfile = {
  /** Target zoom — null keeps current reference zoom */
  zoom: number | null
  pitch: number
  bearing: number | null
  followGps: boolean
  freezeCamera: boolean
  zoomDamping: number
}

export type EnvironmentalTone = {
  intensity: number
  desaturation: number
  contrastBoost: number
  pathGlowAccent: number
  dimBackground: number
  motionTint: number
}

export type TransitionPacket = {
  fromMode: OperationalMode
  toMode: OperationalMode
  /** Logical OSG path (may include idle hops). */
  logicalPath: OperationalMode[]
  /** Perceptual path — hop eliminated: stable → final only. */
  perceptualPath: [OperationalMode, OperationalMode]
  durationMs: number
  intensity: number
  easing: EasingCurve
  triggerSource: string
  issuedAt: number
}

export type SmoothedPosition = {
  lat: number
  lng: number
  headingDeg: number
  speedMs: number
  band: PerceptualMovementBand
}

export type PerceptionSnapshot = {
  mode: OperationalMode
  pointerOwner: string | null
  stable: boolean
  frozen: boolean
  activeTransition: TransitionPacket | null
  camera: CameraProfile
  /** Authoritative camera baseline — captured before radial freeze or mode transition. */
  cameraSnapshot: CameraSnapshot | null
  /** True when radial close requires instant snapshot restore (no easing). */
  radialRestorePending: boolean
  /** One-shot camera command queued by UI — drained by ModernCameraController only. */
  pendingCameraIntent: (CameraIntent & { issuedAt: number }) | null
  tone: EnvironmentalTone
  spatial: SmoothedPosition | null
  sheetDelayMs: number
  microDelayMs: number
  lastStableMode: OperationalMode
  lastPacket: TransitionPacket | null
  /** Recursive spatial fields — null when Classic layer bypasses engine. */
  field: RecursiveFieldSnapshot | null
}
