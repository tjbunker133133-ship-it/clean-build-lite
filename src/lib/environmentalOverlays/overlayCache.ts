import type { EnvironmentalOverlayId, MapBbox } from './types'

const STORAGE_KEY = 'hud_env_overlay_geo_cache_v1'
const MAX_FEATURES = 800
const MAX_JSON_CHARS = 480_000

export type CachedOverlayGeo = {
  overlayId: EnvironmentalOverlayId
  bbox: MapBbox
  fetchedAt: number
  geojson: GeoJSON.FeatureCollection
}

type CacheStore = Partial<Record<EnvironmentalOverlayId, CachedOverlayGeo>>

function readStore(): CacheStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as CacheStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store: CacheStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* quota */
  }
}

export function bboxIntersects(a: MapBbox, b: MapBbox): boolean {
  return !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north)
}

function trimGeojson(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const features = fc.features.slice(0, MAX_FEATURES)
  let out: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }
  let encoded = JSON.stringify(out)
  while (encoded.length > MAX_JSON_CHARS && out.features.length > 10) {
    out = {
      type: 'FeatureCollection',
      features: out.features.slice(0, Math.floor(out.features.length * 0.7)),
    }
    encoded = JSON.stringify(out)
  }
  return out
}

export function readCachedOverlayGeo(
  id: EnvironmentalOverlayId,
  viewport: MapBbox,
): CachedOverlayGeo | null {
  const entry = readStore()[id]
  if (!entry?.geojson?.features) return null
  if (!bboxIntersects(entry.bbox, viewport)) return null
  return entry
}

export function writeCachedOverlayGeo(entry: CachedOverlayGeo): void {
  const store = readStore()
  store[entry.overlayId] = {
    ...entry,
    geojson: trimGeojson(entry.geojson),
  }
  writeStore(store)
}

export function clearOverlayGeoCache(id?: EnvironmentalOverlayId): void {
  if (!id) {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    return
  }
  const store = readStore()
  delete store[id]
  writeStore(store)
}
