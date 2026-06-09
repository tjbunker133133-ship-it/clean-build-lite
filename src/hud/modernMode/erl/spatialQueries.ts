/**
 * Spatial feature queries for ERL — cached per tick, read-only.
 */

import type { Map as MapLibreMap } from 'maplibre-gl'
import { haversineMeters } from '../../../lib/haversine'
import { findNearestTrailCandidate } from '../../../lib/snapToTrail'
import { envLayerId } from '../../../lib/environmentalOverlays/mapOverlayRuntime'
import { getActiveWaypoint } from '../../../lib/waypointNavigation'
import type { Waypoint } from '../../../types'
import type { LatLng, SpatialFeature } from './types'

const TRAIL_QUERY_RADIUS_M = 320
const CAMP_QUERY_RADIUS_M = 520
const CAMP_LAYER_SUFFIXES = ['-points', '-polygons-fill'] as const

export type SpatialQueryInput = {
  map: MapLibreMap | null
  position: LatLng | null
  waypoints: Waypoint[]
  campingEnabled: boolean
  fireEnabled: boolean
  weatherCentroid: LatLng | null
}

function queryNearestCampMeters(
  map: MapLibreMap,
  position: LatLng,
): number | null {
  try {
    const px = map.project([position.lng, position.lat])
    const pad = 48
    const box: [[number, number], [number, number]] = [
      [px.x - pad, px.y - pad],
      [px.x + pad, px.y + pad],
    ]
    const base = envLayerId('camping')
    const layerIds = CAMP_LAYER_SUFFIXES.map((s) => `${base}${s}`).filter((id) => map.getLayer(id))
    if (layerIds.length === 0) return null

    const features = map.queryRenderedFeatures(box, { layers: layerIds })
    let nearest: number | null = null

    for (const f of features) {
      const geom = f.geometry
      if (geom.type === 'Point') {
        const [lng, lat] = geom.coordinates as [number, number]
        const d = haversineMeters(position.lat, position.lng, lat, lng)
        if (nearest == null || d < nearest) nearest = d
      } else if (geom.type === 'Polygon' && Array.isArray(geom.coordinates?.[0]?.[0])) {
        const ring = geom.coordinates[0] as [number, number][]
        for (const [lng, lat] of ring) {
          const d = haversineMeters(position.lat, position.lng, lat, lng)
          if (nearest == null || d < nearest) nearest = d
        }
      }
    }
    return nearest
  } catch {
    return null
  }
}

export function querySpatialFeatures(input: SpatialQueryInput): {
  features: SpatialFeature[]
  activeWaypoint: SpatialFeature | null
  nearestTrailDistanceM: number | null
  nearestCampDistanceM: number | null
} {
  const features: SpatialFeature[] = []
  let nearestTrailDistanceM: number | null = null
  let nearestCampDistanceM: number | null = null

  const activeWp = getActiveWaypoint(input.waypoints)
  const activeWaypoint: SpatialFeature | null = activeWp
    ? {
        id: `wp:${activeWp.id}`,
        kind: 'waypoint',
        position: { lat: activeWp.lat, lng: activeWp.lng },
      }
    : null

  if (input.position && input.map) {
    try {
      const trail = findNearestTrailCandidate(input.map, {
        lat: input.position.lat,
        lng: input.position.lng,
        radiusMeters: TRAIL_QUERY_RADIUS_M,
      })
      if (trail) {
        nearestTrailDistanceM = trail.distanceMeters
        features.push({
          id: `trail:${trail.snappedLat.toFixed(5)},${trail.snappedLng.toFixed(5)}`,
          kind: 'trail',
          position: { lat: trail.snappedLat, lng: trail.snappedLng },
        })
      }
    } catch {
      // map style not ready
    }

    if (input.campingEnabled) {
      nearestCampDistanceM = queryNearestCampMeters(input.map, input.position)
      if (nearestCampDistanceM != null && nearestCampDistanceM <= CAMP_QUERY_RADIUS_M) {
        features.push({
          id: 'camp:nearest',
          kind: 'camp',
          position: input.position,
        })
      }
    }
  }

  if (input.position && input.fireEnabled) {
    features.push({
      id: 'hazard:fire-overlay',
      kind: 'hazard',
      position: input.position,
      centroid: input.position,
      severity: 0.65,
    })
  }

  if (input.weatherCentroid) {
    features.push({
      id: 'weather:cell',
      kind: 'weather',
      position: input.weatherCentroid,
      centroid: input.weatherCentroid,
    })
  }

  return { features, activeWaypoint, nearestTrailDistanceM, nearestCampDistanceM }
}
