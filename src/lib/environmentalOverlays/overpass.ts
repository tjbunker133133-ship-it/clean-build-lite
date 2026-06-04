import { getDeviceProfile } from '../../runtime/deviceProfile'
import type { EnvironmentalOverlayId, MapBbox } from './types'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

function maxBboxDeg(): number {
  return getDeviceProfile().interactionMode === 'mobile' ? 0.22 : 0.35
}

let overpassChain: Promise<unknown> = Promise.resolve()

function enqueueOverpass<T>(task: () => Promise<T>): Promise<T> {
  const run = overpassChain.then(task, task)
  overpassChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** Shrink wide viewports to a fetchable box (centered) instead of failing silently. */
export function clampBbox(bbox: MapBbox): MapBbox | null {
  const latSpan = bbox.north - bbox.south
  const lngSpan = bbox.east - bbox.west
  if (latSpan <= 0 || lngSpan <= 0) return null

  const cap = maxBboxDeg()
  if (latSpan <= cap && lngSpan <= cap) return bbox

  const centerLat = (bbox.south + bbox.north) / 2
  const centerLng = (bbox.west + bbox.east) / 2
  const halfLat = Math.min(cap / 2, latSpan / 2)
  const halfLng = Math.min(cap / 2, lngSpan / 2)
  return {
    south: centerLat - halfLat,
    north: centerLat + halfLat,
    west: centerLng - halfLng,
    east: centerLng + halfLng,
  }
}

export function overpassQuery(id: EnvironmentalOverlayId, bbox: MapBbox): string | null {
  const b = clampBbox(bbox)
  if (!b) return null
  const box = `${b.south},${b.west},${b.north},${b.east}`
  const timeout = 25

  switch (id) {
    case 'bike_paths':
      return `[out:json][timeout:${timeout}];(way["highway"="cycleway"](${box});way["cycleway"](${box});way["bicycle"="designated"](${box}););out geom 120;`
    case 'abandoned_rail':
      return `[out:json][timeout:${timeout}];(way["railway"~"abandoned|disused|razed"](${box}););out geom 120;`
    case 'mines':
      return `[out:json][timeout:${timeout}];(node["man_made"="mineshaft"](${box});node["historic"="mine"](${box});way["man_made"="adit"](${box});way["abandoned"="mine"](${box}););out geom 80;`
    case 'hiking_trails':
      return `[out:json][timeout:${timeout}];(way["highway"~"path|footway"](${box})["sac_scale"];way["route"="hiking"](${box});way["highway"="path"]["foot"~"designated|yes"](${box}););out geom 120;`
    default:
      return null
  }
}

type OverpassElement = {
  type: string
  id: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
}

function elementToFeature(el: OverpassElement): GeoJSON.Feature | null {
  if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) return null
  const coords = el.geometry.map((p) => [p.lon, p.lat] as [number, number])
  const name = el.tags?.name?.trim()
  return {
    type: 'Feature',
    properties: { name: name ?? '', osm_id: el.id },
    geometry: { type: 'LineString', coordinates: coords },
  }
}

export function overpassToGeojson(raw: unknown): GeoJSON.FeatureCollection {
  if (!raw || typeof raw !== 'object') {
    return { type: 'FeatureCollection', features: [] }
  }
  const elements = (raw as { elements?: OverpassElement[] }).elements
  if (!Array.isArray(elements)) {
    return { type: 'FeatureCollection', features: [] }
  }
  const features: GeoJSON.Feature[] = []
  for (const el of elements) {
    const f = elementToFeature(el)
    if (f) features.push(f)
  }
  return { type: 'FeatureCollection', features }
}

function networkOverlayError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err)
  if (raw.toLowerCase().includes('failed to fetch') || raw.toLowerCase().includes('network')) {
    return new Error('OSM layer blocked or offline — retry on signal or zoom in closer')
  }
  return err instanceof Error ? err : new Error(raw || 'OSM load failed')
}

async function postOverpass(
  endpoint: string,
  query: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    signal,
    mode: 'cors',
  })
  if (res.status === 429) {
    throw new Error('OSM busy (rate limit) — wait 30s and retry')
  }
  if (!res.ok) {
    throw new Error(`OSM data unavailable (${res.status})`)
  }
  return res.json() as Promise<unknown>
}

export async function fetchOverpassGeojson(
  id: EnvironmentalOverlayId,
  bbox: MapBbox,
  signal?: AbortSignal,
): Promise<GeoJSON.FeatureCollection> {
  const q = overpassQuery(id, bbox)
  if (!q) {
    throw new Error('Map area invalid — pan or zoom and try again.')
  }

  return enqueueOverpass(async () => {
    let lastErr: unknown = null
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const json = await postOverpass(endpoint, q, signal)
        return overpassToGeojson(json)
      } catch (e) {
        lastErr = e
        if (signal?.aborted) throw e
      }
    }
    throw networkOverlayError(lastErr)
  })
}
