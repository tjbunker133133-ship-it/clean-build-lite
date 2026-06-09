/**
 * Environmental Relationship Layer (ERL) — type contracts.
 * Pure scalars [0,1] modulate existing compositor parameters only.
 */

import type { FieldIntent } from '../../../lib/fieldIntentModel'
import type { WeatherAtmosphere } from '../../../hooks/useWeatherAtmosphere'

export type LatLng = { lat: number; lng: number }

export type SpatialFeatureKind = 'trail' | 'waypoint' | 'camp' | 'hazard' | 'weather'

export type SpatialFeature = {
  id: string
  kind: SpatialFeatureKind
  position: LatLng
  /** Optional centroid for area features (fire zones). */
  centroid?: LatLng
  /** Hazard severity hint 0–1 when known. */
  severity?: number
}

/** Runtime snapshot consumed by ERL each tick — derived from FIM + movement + overlays. */
export type FIMRuntimeSnapshot = {
  position: LatLng | null
  headingDeg: number | null
  hasHeading: boolean
  speedMps: number
  fieldIntent: FieldIntent
  gpsUncertain: boolean
  navigating: boolean
}

export type ERLTickContext = {
  fim: FIMRuntimeSnapshot
  atmosphere: WeatherAtmosphere
  spatialFeatures: SpatialFeature[]
  activeWaypoint: SpatialFeature | null
  routePolyline: LatLng[]
  offRouteDistanceFeet: number
  offRouteThresholdFeet: number
  nearestTrailDistanceM: number | null
  nearestCampDistanceM: number | null
  campingOverlayEnabled: boolean
  fireOverlayEnabled: boolean
  sosActive: boolean
  tickIntervalSec: number
}

/** Presentation meta passed to compositor (not smoothed signals). */
export type ERLPresentationMeta = {
  headingDeg: number | null
  hasHeading: boolean
}

export interface ERLState {
  trailApproach: number
  waypointApproach: number
  campApproach: number
  hazardApproach: number
  forwardWeatherPressure: number
  forwardHazardPressure: number
  rearHazardPressure: number
  fieldPressure: number
  temporalMood: number
  navCoherence: number
}

export const ERL_STATE_ZERO: ERLState = {
  trailApproach: 0,
  waypointApproach: 0,
  campApproach: 0,
  hazardApproach: 0,
  forwardWeatherPressure: 0,
  forwardHazardPressure: 0,
  rearHazardPressure: 0,
  fieldPressure: 0,
  temporalMood: 0,
  navCoherence: 0.5,
}

export type ERLInternalState = {
  smoothed: ERLState
  prevDistances: Map<string, number>
  speedHistory: number[]
  positionHistory: Array<{ pos: LatLng; ts: number }>
  dwellStartMs: number | null
  lastTickMs: number
}

export function createERLInternalState(): ERLInternalState {
  return {
    smoothed: { ...ERL_STATE_ZERO },
    prevDistances: new Map(),
    speedHistory: [],
    positionHistory: [],
    dwellStartMs: null,
    lastTickMs: 0,
  }
}

/** DEV simulation patch — spatial overrides when GPS/map queries are empty on desktop. */
export type ERLSimulationPatch = Partial<
  Pick<
    ERLTickContext,
    | 'nearestTrailDistanceM'
    | 'nearestCampDistanceM'
    | 'spatialFeatures'
    | 'activeWaypoint'
    | 'offRouteDistanceFeet'
  >
> & {
  /** When set, simulated position advances toward this point each tick at speedMps. */
  approachTarget?: LatLng
}

export function buildNullFimSnapshot(): FIMRuntimeSnapshot {
  return {
    position: null,
    headingDeg: null,
    hasHeading: false,
    speedMps: 0,
    fieldIntent: 'REGIONAL_OVERVIEW',
    gpsUncertain: true,
    navigating: false,
  }
}
