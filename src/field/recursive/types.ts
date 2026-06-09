import type { SpatialFieldSnapshot, SpatialFieldValues } from '../types'

/** Second-order dynamics per field channel — ephemeral, not authoritative. */
export type FieldDerivatives = {
  velocity: SpatialFieldValues
  acceleration: SpatialFieldValues
}

export type RecursiveFieldSnapshot = SpatialFieldSnapshot &
  FieldDerivatives & {
    /** Camera velocity feedback bias (0–1). */
    inertiaBias: number
    /** Intentional perceptual delay buffer (0–1). */
    perceptualLag: number
    /** System stability metric — inverse oscillation (0.25–1). */
    coherence: number
    /** Temporal prediction for camera/UI anticipation. */
    predicted: SpatialFieldValues
    /** Recursive layer gain applied this tick. */
    recursiveGain: number
  }
