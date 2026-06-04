import type { RawGpsPoint, SnapProviderId, SnappedTrackPoint } from './types'

export type SnapProviderRequest = {
  raw: RawGpsPoint
  radiusMeters: number
}

export type SnapProvider = {
  id: SnapProviderId
  /** When false, pipeline skips network/local snap and keeps raw. */
  isAvailable(): boolean
  snap(request: SnapProviderRequest): Promise<SnappedTrackPoint | null>
}

/** Placeholder for future OSRM / GraphHopper / Valhalla / Mapbox adapters. */
export function createDisabledNetworkProvider(id: Exclude<SnapProviderId, 'maplibre-local' | 'none'>): SnapProvider {
  return {
    id,
    isAvailable: () => false,
    async snap() {
      return null
    },
  }
}

export function confidenceFromSnapDistance(distanceM: number, radiusM: number): number {
  if (!Number.isFinite(distanceM) || radiusM <= 0) return 0
  const t = 1 - Math.min(1, Math.max(0, distanceM / radiusM))
  return Math.round(t * 100) / 100
}
