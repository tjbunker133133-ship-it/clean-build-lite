import type { Waypoint } from '../../types'
import {
  computeCorridorBounds,
  computeRouteFingerprint,
  getOutdoorCorridorTileTemplates,
  loadCorridorCacheRegion,
  prefetchCorridorTiles,
  saveCorridorCacheRegion,
  PREFETCH_MAX_TILES_PER_RUN,
  type CorridorCacheRegion,
} from '../corridorPrefetch'
import type { MissionCorridorHint } from './types'

function routeFromWaypoints(waypoints: Waypoint[]): Array<{ lat: number; lng: number }> {
  return waypoints
    .filter((w) => w.status !== 'archived')
    .map((w) => ({ lat: w.lat, lng: w.lng }))
}

function routeCenter(route: Array<{ lat: number; lng: number }>): { lat: number; lng: number } | null {
  if (route.length === 0) return null
  let lat = 0
  let lng = 0
  for (const p of route) {
    lat += p.lat
    lng += p.lng
  }
  return { lat: lat / route.length, lng: lng / route.length }
}

export function buildMissionCorridorHint(args: {
  missionId: string
  sourceDeviceId: string
  sourceCallsign: string
  waypoints: Waypoint[]
}): MissionCorridorHint | null {
  const route = routeFromWaypoints(args.waypoints)
  if (route.length < 2) return null
  const bounds = computeCorridorBounds(route)
  if (!bounds) return null
  const center = routeCenter(route)
  if (!center) return null
  return {
    missionId: args.missionId,
    sourceDeviceId: args.sourceDeviceId,
    sourceCallsign: args.sourceCallsign,
    bounds,
    routeFingerprint: computeRouteFingerprint(route),
    centerLat: center.lat,
    centerLng: center.lng,
    updatedAt: Date.now(),
  }
}

export function shouldApplyCorridorHint(hint: MissionCorridorHint, missionId: string | null): boolean {
  if (!missionId || hint.missionId !== missionId) return false
  const region = loadCorridorCacheRegion()
  if (!region) return true
  if (region.routeFingerprint !== hint.routeFingerprint) return true
  return hint.updatedAt > region.updatedAt
}

/**
 * Save team corridor bounds locally; prefetch tiles when online (bounded run).
 */
export async function applyMissionCorridorHint(
  hint: MissionCorridorHint,
): Promise<{ applied: boolean; tilesAdded: number }> {
  const prior = loadCorridorCacheRegion()
  const region: CorridorCacheRegion = {
    bounds: hint.bounds,
    centerLat: hint.centerLat,
    centerLng: hint.centerLng,
    updatedAt: hint.updatedAt,
    layer: 'outdoor',
    routeFingerprint: hint.routeFingerprint,
    tilesLoaded:
      prior?.routeFingerprint === hint.routeFingerprint ? (prior?.tilesLoaded ?? 0) : 0,
  }
  saveCorridorCacheRegion(region)

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { applied: true, tilesAdded: 0 }
  }

  const templates = getOutdoorCorridorTileTemplates()
  if (templates.length === 0) return { applied: true, tilesAdded: 0 }

  try {
    const loaded = await prefetchCorridorTiles(templates, hint.bounds, {
      maxTiles: PREFETCH_MAX_TILES_PER_RUN,
    })
    if (loaded > 0) {
      saveCorridorCacheRegion({
        ...region,
        tilesLoaded: region.tilesLoaded + loaded,
        updatedAt: Date.now(),
      })
    }
    return { applied: true, tilesAdded: loaded }
  } catch {
    return { applied: true, tilesAdded: 0 }
  }
}
