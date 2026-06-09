/**
 * Spatial Field Engine — derived continuous field values.
 * NOT authoritative — OSG remains sole spatial truth.
 */

export type SpatialFieldValues = {
  /** Route planning / geometry engagement (0–1). */
  routeIntensity: number
  /** Mission workflow focus (0–1). */
  missionFocus: number
  /** Navigation / movement pull (0–1). */
  navigationPull: number
  /** Radial interaction pressure (0–1). */
  radialPressure: number
  /** Environmental overlay awareness (0–1). */
  environmentalAwareness: number
}

export type SpatialFieldSnapshot = SpatialFieldValues & {
  /** Camera stability — inverse of recent field velocity (0–1). */
  cameraStability: number
  /** Layer influence multiplier applied this tick (0 = classic bypass). */
  layerInfluence: number
  /** Monotonic tick counter for consumers. */
  tick: number
  timestamp: number
}

export type SpatialFieldTargets = SpatialFieldValues

export type FieldLayerMode = 'classic' | 'balanced' | 'modern'

export type FieldDampingConfig = {
  routeIntensity: number
  missionFocus: number
  navigationPull: number
  radialPressure: number
  environmentalAwareness: number
}
