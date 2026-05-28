import { HALF_CORRIDOR_FEET } from './corridor'
import { haversineDistance } from './haversine'

const METERS_PER_MILE = 1609.344
const HALF_CORRIDOR_MILES = HALF_CORRIDOR_FEET / 5280
export const PREFETCH_MOVE_MILES = 1.5

export type CorridorBounds = {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export type CorridorCacheRegion = {
  bounds: CorridorBounds
  centerLat: number
  centerLng: number
  updatedAt: number
  layer: 'outdoor'
}

const STORAGE_KEY = 'hud_corridor_cache_v1'
const RECENT_AREAS_KEY = 'hud_recent_operational_areas_v1'
const MAP_VIEWPORT_KEY = 'hud_map_viewport_v1'
const RECENT_AREAS_MAX = 6
const AREA_DEDUP_MILES = 0.75

export type OperationalAreaSeed = {
  centerLat: number
  centerLng: number
  updatedAt: number
  source: 'corridor' | 'viewport'
}

function padBounds(
  route: Array<{ lat: number; lng: number }>,
  halfWidthMiles: number,
): CorridorBounds | null {
  if (route.length === 0) return null
  let minLat = route[0].lat
  let maxLat = route[0].lat
  let minLng = route[0].lng
  let maxLng = route[0].lng
  for (const p of route) {
    minLat = Math.min(minLat, p.lat)
    maxLat = Math.max(maxLat, p.lat)
    minLng = Math.min(minLng, p.lng)
    maxLng = Math.max(maxLng, p.lng)
  }
  const midLat = (minLat + maxLat) / 2
  const padLat = halfWidthMiles / 69
  const cos = Math.max(0.2, Math.cos((midLat * Math.PI) / 180))
  const padLng = halfWidthMiles / (69 * cos)
  return {
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
    minLng: minLng - padLng,
    maxLng: maxLng + padLng,
  }
}

export function computeCorridorBounds(
  route: Array<{ lat: number; lng: number }>,
  halfWidthMiles = HALF_CORRIDOR_MILES,
): CorridorBounds | null {
  return padBounds(route, halfWidthMiles)
}

export function loadCorridorCacheRegion(): CorridorCacheRegion | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CorridorCacheRegion
    if (!parsed?.bounds) return null
    return parsed
  } catch {
    return null
  }
}

export function saveCorridorCacheRegion(region: CorridorCacheRegion): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(region))
    saveOperationalAreaSeed({
      centerLat: region.centerLat,
      centerLng: region.centerLng,
      updatedAt: region.updatedAt,
      source: 'corridor',
    })
  } catch {
    /* quota / private mode */
  }
}

export function loadOperationalAreaSeeds(): OperationalAreaSeed[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(RECENT_AREAS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is OperationalAreaSeed => {
        if (!item || typeof item !== 'object') return false
        const p = item as Partial<OperationalAreaSeed>
        return (
          typeof p.centerLat === 'number' &&
          Number.isFinite(p.centerLat) &&
          typeof p.centerLng === 'number' &&
          Number.isFinite(p.centerLng) &&
          typeof p.updatedAt === 'number' &&
          Number.isFinite(p.updatedAt) &&
          (p.source === 'corridor' || p.source === 'viewport')
        )
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, RECENT_AREAS_MAX)
  } catch {
    return []
  }
}

export function saveOperationalAreaSeed(seed: OperationalAreaSeed): void {
  if (typeof localStorage === 'undefined') return
  try {
    const existing = loadOperationalAreaSeeds()
    const deduped = existing.filter((item) => {
      const { miles } = haversineDistance(item.centerLat, item.centerLng, seed.centerLat, seed.centerLng)
      return miles >= AREA_DEDUP_MILES
    })
    const next = [seed, ...deduped].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_AREAS_MAX)
    localStorage.setItem(RECENT_AREAS_KEY, JSON.stringify(next))
  } catch {
    /* quota / private mode */
  }
}

export function saveOperationalAreaSeedFromViewport(): void {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(MAP_VIEWPORT_KEY)
    if (!raw) return
    const p = JSON.parse(raw) as Partial<{
      lat: number
      lng: number
      ts: number
    }>
    if (
      typeof p.lat !== 'number' ||
      !Number.isFinite(p.lat) ||
      typeof p.lng !== 'number' ||
      !Number.isFinite(p.lng)
    ) {
      return
    }
    saveOperationalAreaSeed({
      centerLat: p.lat,
      centerLng: p.lng,
      updatedAt: typeof p.ts === 'number' && Number.isFinite(p.ts) ? p.ts : Date.now(),
      source: 'viewport',
    })
  } catch {
    /* ignore parse/storage errors */
  }
}

export function shouldRefreshCorridorPrefetch(
  userLat: number,
  userLng: number,
  region: CorridorCacheRegion | null,
  moveThresholdMiles = PREFETCH_MOVE_MILES,
): boolean {
  if (!region) return true
  const { miles } = haversineDistance(userLat, userLng, region.centerLat, region.centerLng)
  return miles >= moveThresholdMiles
}

export function distanceToCorridorEdgeFeet(
  userLat: number,
  userLng: number,
  bounds: CorridorBounds,
): number {
  const midLat = (bounds.minLat + bounds.maxLat) / 2
  const mPerDegLat = 111320
  const mPerDegLng = 111320 * Math.cos((midLat * Math.PI) / 180)

  const x = userLng * mPerDegLng
  const y = userLat * mPerDegLat
  const minX = bounds.minLng * mPerDegLng
  const maxX = bounds.maxLng * mPerDegLng
  const minY = bounds.minLat * mPerDegLat
  const maxY = bounds.maxLat * mPerDegLat

  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0
  const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0
  return Math.hypot(dx, dy) * 3.28084
}

/** Extract raster tile URL templates from a loaded MapLibre style. */
export function extractOutdoorTileUrls(style: unknown): string[] {
  if (!style || typeof style !== 'object') return []
  const spec = style as { sources?: Record<string, { type?: string; tiles?: string[] }> }
  const urls: string[] = []
  for (const src of Object.values(spec.sources ?? {})) {
    if (src.type === 'raster' && Array.isArray(src.tiles)) {
      urls.push(...src.tiles.filter((t) => typeof t === 'string'))
    }
  }
  return urls.filter((u) => u.includes('maptiler') || u.includes('openstreetmap'))
}

function lngLatToTile(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  )
  return { x, y }
}

function tileUrlFromTemplate(template: string, z: number, x: number, y: number): string {
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('@2x', '')
}

/**
 * Bounded tile warm-up for corridor offline use. Outdoor tiles only; fails gracefully.
 * Does not modify map view or GPS state.
 */
export async function prefetchCorridorTiles(
  tileTemplates: string[],
  bounds: CorridorBounds,
  options?: { zoomLevels?: number[]; maxTiles?: number },
): Promise<number> {
  if (tileTemplates.length === 0 || typeof fetch === 'undefined') return 0
  const zoomLevels = options?.zoomLevels ?? [12, 13]
  const maxTiles = options?.maxTiles ?? 48
  let loaded = 0

  for (const z of zoomLevels) {
    const tl = lngLatToTile(bounds.minLng, bounds.maxLat, z)
    const br = lngLatToTile(bounds.maxLng, bounds.minLat, z)
    for (let x = tl.x; x <= br.x; x++) {
      for (let y = tl.y; y <= br.y; y++) {
        if (loaded >= maxTiles) return loaded
        for (const template of tileTemplates.slice(0, 2)) {
          const url = tileUrlFromTemplate(template, z, x, y)
          try {
            await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' })
            loaded++
          } catch {
            /* degrade gracefully */
          }
        }
      }
    }
  }
  return loaded
}

export function buildCorridorCacheRegion(
  route: Array<{ lat: number; lng: number }>,
  userLat: number,
  userLng: number,
): CorridorCacheRegion | null {
  const bounds = computeCorridorBounds(route)
  if (!bounds) return null
  return {
    bounds,
    centerLat: userLat,
    centerLng: userLng,
    updatedAt: Date.now(),
    layer: 'outdoor',
  }
}

export { HALF_CORRIDOR_MILES, METERS_PER_MILE }
