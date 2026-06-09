/**
 * ERL signal computation — pure functions (unit-tested).
 */

import { haversineMeters } from '../../../lib/haversine'
import { REST_AT_CAMP_M, REST_AT_WAYPOINT_M } from './erlCalibration'
import type {
  ERLInternalState,
  ERLState,
  ERLTickContext,
  LatLng,
  SpatialFeature,
} from './types'

export const ALPHA_PROXIMITY = 0.15
export const ALPHA_PRESSURE = 0.08
export const ALPHA_TEMPORAL = 0.05
export const ALPHA_COHERENCE = 0.2
export const ALPHA_VECTOR = 0.15

/** Max approach speed that maps to 1.0 (walking fast toward feature). */
export const MAX_MEANINGFUL_APPROACH_MPS = 2.2

const TRAIL_RADIUS_M = 300
const CAMP_RADIUS_M = 500
const HAZARD_RADIUS_M = 1000
const VECTOR_DECAY_M = 2000

export { REST_AT_WAYPOINT_M, REST_AT_CAMP_M } from './erlCalibration'

/** Intentional rest — near waypoint or campground; field stays settled. */
export function intentionalRestDetected(
  ctx: ERLTickContext,
  position: LatLng | null,
): boolean {
  if (!position) return false

  if (ctx.activeWaypoint) {
    const wpDist = haversineMeters(
      position.lat,
      position.lng,
      ctx.activeWaypoint.position.lat,
      ctx.activeWaypoint.position.lng,
    )
    if (wpDist < REST_AT_WAYPOINT_M) return true
  }

  if (ctx.nearestCampDistanceM != null && ctx.nearestCampDistanceM < REST_AT_CAMP_M) {
    return true
  }

  return false
}

export function smoothScalar(current: number, target: number, alpha: number): number {
  return current + alpha * (target - current)
}

export function normalize01(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(1, value / max))
}

export function bearingDeg(from: LatLng, to: LatLng): number {
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180
  const φ1 = (from.lat * Math.PI) / 180
  const φ2 = (to.lat * Math.PI) / 180
  const x = Math.sin(Δλ) * Math.cos(φ2)
  const y = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
}

export function angularDifferenceDeg(a: number, b: number): number {
  let d = Math.abs(a - b) % 360
  if (d > 180) d = 360 - d
  return d
}

function proximityFactor(distanceM: number, maxM: number): number {
  if (distanceM > maxM) return 0
  return 1 - distanceM / maxM
}

function computeApproachRate(
  featureId: string,
  distanceNow: number,
  tickIntervalSec: number,
  prevDistances: Map<string, number>,
): number {
  const prev = prevDistances.get(featureId)
  prevDistances.set(featureId, distanceNow)
  if (prev == null || tickIntervalSec <= 0) return 0
  const delta = prev - distanceNow
  if (delta <= 0) return 0
  return delta / tickIntervalSec
}

function maxProximityDelta(
  position: LatLng,
  features: SpatialFeature[],
  radiusM: number,
  tickIntervalSec: number,
  prevDistances: Map<string, number>,
): number {
  let max = 0
  for (const f of features) {
    const d = haversineMeters(position.lat, position.lng, f.position.lat, f.position.lng)
    if (d > radiusM) continue
    const rate = computeApproachRate(f.id, d, tickIntervalSec, prevDistances)
    max = Math.max(max, normalize01(rate, MAX_MEANINGFUL_APPROACH_MPS))
  }
  return max
}

export function computeProximityDeltaTargets(ctx: ERLTickContext): Pick<
  ERLState,
  'trailApproach' | 'waypointApproach' | 'campApproach' | 'hazardApproach'
> {
  const pos = ctx.fim.position
  if (!pos) {
    return { trailApproach: 0, waypointApproach: 0, campApproach: 0, hazardApproach: 0 }
  }

  const trails = ctx.spatialFeatures.filter((f) => f.kind === 'trail')
  const camps = ctx.spatialFeatures.filter((f) => f.kind === 'camp')
  const hazards = ctx.spatialFeatures.filter((f) => f.kind === 'hazard')

  const trailApproach = maxProximityDelta(
    pos,
    trails,
    TRAIL_RADIUS_M,
    ctx.tickIntervalSec,
    new Map(),
  )

  let waypointApproach = 0
  if (ctx.activeWaypoint) {
    const d = haversineMeters(
      pos.lat,
      pos.lng,
      ctx.activeWaypoint.position.lat,
      ctx.activeWaypoint.position.lng,
    )
    const rate = computeApproachRate('wp:active', d, ctx.tickIntervalSec, new Map())
    waypointApproach = normalize01(rate, MAX_MEANINGFUL_APPROACH_MPS)
  }

  const campApproach = ctx.campingOverlayEnabled
    ? maxProximityDelta(pos, camps, CAMP_RADIUS_M, ctx.tickIntervalSec, new Map())
    : 0

  const hazardApproach = ctx.fireOverlayEnabled
    ? maxProximityDelta(pos, hazards, HAZARD_RADIUS_M, ctx.tickIntervalSec, new Map())
    : 0

  return { trailApproach, waypointApproach, campApproach, hazardApproach }
}

export function computeProximityDeltaTargetsWithHistory(
  ctx: ERLTickContext,
  prevDistances: Map<string, number>,
): Pick<ERLState, 'trailApproach' | 'waypointApproach' | 'campApproach' | 'hazardApproach'> {
  const pos = ctx.fim.position
  if (!pos) {
    return { trailApproach: 0, waypointApproach: 0, campApproach: 0, hazardApproach: 0 }
  }

  const trails = ctx.spatialFeatures.filter((f) => f.kind === 'trail')
  const camps = ctx.spatialFeatures.filter((f) => f.kind === 'camp')
  const hazards = ctx.spatialFeatures.filter((f) => f.kind === 'hazard')

  const trailApproach = maxProximityDelta(
    pos,
    trails,
    TRAIL_RADIUS_M,
    ctx.tickIntervalSec,
    prevDistances,
  )

  let waypointApproach = 0
  if (ctx.activeWaypoint) {
    const d = haversineMeters(
      pos.lat,
      pos.lng,
      ctx.activeWaypoint.position.lat,
      ctx.activeWaypoint.position.lng,
    )
    const rate = computeApproachRate('wp:active', d, ctx.tickIntervalSec, prevDistances)
    waypointApproach = normalize01(rate, MAX_MEANINGFUL_APPROACH_MPS)
  }

  const campApproach = ctx.campingOverlayEnabled
    ? maxProximityDelta(pos, camps, CAMP_RADIUS_M, ctx.tickIntervalSec, prevDistances)
    : 0

  const hazardApproach = ctx.fireOverlayEnabled
    ? maxProximityDelta(pos, hazards, HAZARD_RADIUS_M, ctx.tickIntervalSec, prevDistances)
    : 0

  return { trailApproach, waypointApproach, campApproach, hazardApproach }
}

function forwardWeight(
  position: LatLng,
  headingDeg: number,
  feature: SpatialFeature,
  maxDistanceM: number,
): { forward: number; rear: number } {
  const target = feature.centroid ?? feature.position
  const dist = haversineMeters(position.lat, position.lng, target.lat, target.lng)
  const prox = proximityFactor(dist, maxDistanceM)
  if (prox <= 0) return { forward: 0, rear: 0 }

  const bearingTo = bearingDeg(position, target)
  const angleDelta = angularDifferenceDeg(headingDeg, bearingTo)
  const cosWeight = Math.cos((angleDelta * Math.PI) / 180)
  const forwardNorm = Math.max(0, Math.min(1, (cosWeight + 1) / 2))
  const rearNorm = Math.max(0, Math.min(1, (-cosWeight + 1) / 2))
  return { forward: forwardNorm * prox, rear: rearNorm * prox }
}

export function computeApproachVectorTargets(ctx: ERLTickContext): Pick<
  ERLState,
  'forwardWeatherPressure' | 'forwardHazardPressure' | 'rearHazardPressure'
> {
  const pos = ctx.fim.position
  const heading = ctx.fim.hasHeading ? ctx.fim.headingDeg : null
  if (!pos || heading == null) {
    return { forwardWeatherPressure: 0, forwardHazardPressure: 0, rearHazardPressure: 0 }
  }

  const weatherFeatures = ctx.spatialFeatures.filter((f) => f.kind === 'weather')
  const hazardFeatures = ctx.spatialFeatures.filter((f) => f.kind === 'hazard')

  let forwardWeather = 0
  for (const f of weatherFeatures) {
    const w = forwardWeight(pos, heading, f, VECTOR_DECAY_M)
    forwardWeather = Math.max(forwardWeather, w.forward)
  }
  if (weatherFeatures.length === 0 && ctx.atmosphere.hasActiveWeather) {
    forwardWeather = Math.max(
      forwardWeather,
      ctx.atmosphere.level === 'intense' ? 0.55 : ctx.atmosphere.level === 'active' ? 0.35 : 0.2,
    )
  }

  let forwardHazard = 0
  let rearHazard = 0
  for (const f of hazardFeatures) {
    const w = forwardWeight(pos, heading, f, VECTOR_DECAY_M)
    forwardHazard = Math.max(forwardHazard, w.forward * (f.severity ?? 0.7))
    rearHazard = Math.max(rearHazard, w.rear * (f.severity ?? 0.7))
  }

  return {
    forwardWeatherPressure: Math.min(1, forwardWeather),
    forwardHazardPressure: Math.min(1, forwardHazard),
    rearHazardPressure: Math.min(1, rearHazard),
  }
}

export function computeEnvironmentalPressureTarget(ctx: ERLTickContext): number {
  const components: number[] = []

  if (ctx.atmosphere.hasActiveWeather) {
    components.push(normalize01(ctx.atmosphere.dimFactor, 0.2) * 0.25)
    if (ctx.atmosphere.level === 'intense') components.push(0.2)
    else if (ctx.atmosphere.level === 'active') components.push(0.12)
  }

  if (ctx.fireOverlayEnabled && ctx.fim.position) {
    const nearHazard = ctx.spatialFeatures.some((f) => {
      if (f.kind !== 'hazard') return false
      return (
        haversineMeters(
          ctx.fim.position!.lat,
          ctx.fim.position!.lng,
          f.position.lat,
          f.position.lng,
        ) < 800
      )
    })
    if (nearHazard) components.push(0.22)
  }

  const trailDist = ctx.nearestTrailDistanceM
  if (trailDist != null) {
    components.push(normalize01(trailDist, 500) * 0.1)
  }

  return Math.min(1, components.reduce((a, b) => a + b, 0))
}

export function computeTemporalMoodTarget(
  ctx: ERLTickContext,
  internal: ERLInternalState,
  nowMs: number,
): number {
  const speed = ctx.fim.speedMps
  const pos = ctx.fim.position

  if (pos) {
    internal.positionHistory.push({ pos, ts: nowMs })
    const cutoff = nowMs - 5 * 60_000
    internal.positionHistory = internal.positionHistory.filter((e) => e.ts >= cutoff)
  }

  internal.speedHistory.push(speed)
  if (internal.speedHistory.length > 150) {
    internal.speedHistory = internal.speedHistory.slice(-150)
  }

  if (speed < 0.3) {
    if (internal.dwellStartMs == null) internal.dwellStartMs = nowMs
    const dwellSec = (nowMs - internal.dwellStartMs) / 1000

    if (intentionalRestDetected(ctx, pos)) {
      return 0
    }

    if (dwellSec > 90) {
      return Math.min(0.7, 0.4 + normalize01(dwellSec, 600) * 0.3)
    }
    return 0.08
  }

  internal.dwellStartMs = null

  if (internal.speedHistory.length < 4) return 0

  const mean =
    internal.speedHistory.reduce((a, b) => a + b, 0) / internal.speedHistory.length
  const variance =
    internal.speedHistory.reduce((a, v) => a + (v - mean) ** 2, 0) / internal.speedHistory.length

  if (variance > 1.2) return 0.3
  if (variance < 0.08 && speed > 0.5) return 0
  return 0
}

export function computeNavigationCoherenceTarget(ctx: ERLTickContext): number {
  const pos = ctx.fim.position
  const heading = ctx.fim.hasHeading ? ctx.fim.headingDeg : null
  if (!pos) return 0.5

  if (ctx.activeWaypoint && heading != null) {
    const bearingTo = bearingDeg(pos, ctx.activeWaypoint.position)
    const align = Math.cos((angularDifferenceDeg(heading, bearingTo) * Math.PI) / 180)
    return Math.max(0, Math.min(1, (align + 1) / 2))
  }

  if (ctx.routePolyline.length >= 2) {
    const onRoute = 1 - normalize01(ctx.offRouteDistanceFeet * 0.3048, 100)
    let headingScore = 0.5
    if (heading != null) {
      const next = ctx.routePolyline[Math.min(1, ctx.routePolyline.length - 1)]
      const routeBearing = bearingDeg(pos, next)
      const align = Math.cos((angularDifferenceDeg(heading, routeBearing) * Math.PI) / 180)
      headingScore = (align + 1) / 2
    }
    return Math.max(0, Math.min(1, onRoute * 0.6 + headingScore * 0.4))
  }

  return 0.5
}

export function applySignalSmoothing(
  current: ERLState,
  targets: ERLState,
): ERLState {
  return {
    trailApproach: smoothScalar(current.trailApproach, targets.trailApproach, ALPHA_PROXIMITY),
    waypointApproach: smoothScalar(current.waypointApproach, targets.waypointApproach, ALPHA_PROXIMITY),
    campApproach: smoothScalar(current.campApproach, targets.campApproach, ALPHA_PROXIMITY),
    hazardApproach: smoothScalar(current.hazardApproach, targets.hazardApproach, ALPHA_PROXIMITY),
    forwardWeatherPressure: smoothScalar(
      current.forwardWeatherPressure,
      targets.forwardWeatherPressure,
      ALPHA_VECTOR,
    ),
    forwardHazardPressure: smoothScalar(
      current.forwardHazardPressure,
      targets.forwardHazardPressure,
      ALPHA_VECTOR,
    ),
    rearHazardPressure: smoothScalar(
      current.rearHazardPressure,
      targets.rearHazardPressure,
      ALPHA_VECTOR,
    ),
    fieldPressure: smoothScalar(current.fieldPressure, targets.fieldPressure, ALPHA_PRESSURE),
    temporalMood: smoothScalar(current.temporalMood, targets.temporalMood, ALPHA_TEMPORAL),
    navCoherence: smoothScalar(current.navCoherence, targets.navCoherence, ALPHA_COHERENCE),
  }
}

export function computeERLTargets(
  ctx: ERLTickContext,
  internal: ERLInternalState,
  nowMs: number,
): ERLState {
  const proximity = computeProximityDeltaTargetsWithHistory(ctx, internal.prevDistances)
  const vectors = computeApproachVectorTargets(ctx)
  const fieldPressure = computeEnvironmentalPressureTarget(ctx)
  const temporalMood = computeTemporalMoodTarget(ctx, internal, nowMs)
  const navCoherence = computeNavigationCoherenceTarget(ctx)

  return {
    ...proximity,
    ...vectors,
    fieldPressure,
    temporalMood,
    navCoherence,
  }
}
