import type { Map } from 'maplibre-gl'
import {
  findNearestTrailCandidate,
  isSnapAvailable,
  MAX_SNAP_RADIUS_M,
  type TrailSnapCandidate,
} from '../snapToTrail'
import { confidenceFromSnapDistance, type SnapProvider } from './snapProvider'
import type { RawGpsPoint, SnappedTrackPoint } from './types'

export type MapLibreTrailProviderOptions = {
  getMap: () => Map | null
  radiusMeters?: number
}

function candidateToSnapped(
  raw: RawGpsPoint,
  cand: TrailSnapCandidate,
  radiusM: number,
  latencyMs: number,
): SnappedTrackPoint {
  return {
    snappedLat: cand.snappedLat,
    snappedLng: cand.snappedLng,
    snappedRoadName: cand.sourceClass ?? null,
    confidenceScore: confidenceFromSnapDistance(cand.distanceMeters, radiusM),
    snapDistanceMeters: cand.distanceMeters,
    sourceProvider: 'maplibre-local',
    rawTimestampMs: raw.timestampMs,
    processedAtMs: Date.now(),
  }
}

/** Wraps existing vector-tile trail snap — no routing API. */
export function createMapLibreTrailProvider(opts: MapLibreTrailProviderOptions): SnapProvider {
  const radiusM = opts.radiusMeters ?? MAX_SNAP_RADIUS_M

  return {
    id: 'maplibre-local',
    isAvailable() {
      const map = opts.getMap()
      return map != null && isSnapAvailable(map)
    },
    async snap(request) {
      const map = opts.getMap()
      if (!map || !isSnapAvailable(map)) return null
      const started = performance.now()
      const cand = findNearestTrailCandidate(map, {
        lat: request.raw.lat,
        lng: request.raw.lng,
        radiusMeters: request.radiusMeters ?? radiusM,
      })
      const latencyMs = performance.now() - started
      if (!cand) return null
      const snapped = candidateToSnapped(request.raw, cand, radiusM, latencyMs)
      return snapped
    },
  }
}
