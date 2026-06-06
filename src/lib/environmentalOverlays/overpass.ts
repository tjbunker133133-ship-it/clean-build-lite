import { getDeviceProfile } from '../../runtime/deviceProfile'
import { traceOverlay } from '../../runtime/runtimeForensics'
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
    case 'camping':
      // Fetch both nodes (campground points) and ways/relations (dispersed camping zones)
      return `[out:json][timeout:${timeout}];(node["tourism"="camp_site"](${box});way["tourism"="camp_site"](${box});relation["tourism"="camp_site"](${box}););out geom 100;`
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

function elementToFeature(el: OverpassElement, id?: EnvironmentalOverlayId): GeoJSON.Feature | null {
  // Camping overlay: handle nodes as Points, ways/relations as Polygons
  if (id === 'camping') {
    // Nodes become Point markers (official campgrounds)
    if (el.type === 'node' && el.geometry && el.geometry.length === 1) {
      const p = el.geometry[0]
      const name = el.tags?.name?.trim()
      const siteType = el.tags?.['camp_site'] ?? el.tags?.['site_type'] ?? ''
      const capacity = el.tags?.capacity ?? ''
      return {
        type: 'Feature',
        properties: {
          name: name ?? '',
          osm_id: el.id,
          feature_type: 'campground',
          site_type: siteType,
          capacity: capacity,
        },
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      }
    }
    // Ways/relations become Polygons (dispersed camping zones)
    if ((el.type === 'way' || el.type === 'relation') && el.geometry && el.geometry.length >= 3) {
      const coords = el.geometry.map((p) => [p.lon, p.lat] as [number, number])
      // Close polygon if not closed
      if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
        coords.push(coords[0])
      }
      const name = el.tags?.name?.trim()
      const siteType = el.tags?.['camp_site'] ?? el.tags?.['site_type'] ?? ''
      return {
        type: 'Feature',
        properties: {
          name: name ?? 'Dispersed Camping Area',
          osm_id: el.id,
          feature_type: 'dispersed_zone',
          site_type: siteType,
        },
        geometry: { type: 'Polygon', coordinates: [coords] },
      }
    }
    return null
  }

  // Standard handling for other overlays (ways as LineString)
  if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) return null
  const coords = el.geometry.map((p) => [p.lon, p.lat] as [number, number])
  const name = el.tags?.name?.trim()
  return {
    type: 'Feature',
    properties: { name: name ?? '', osm_id: el.id },
    geometry: { type: 'LineString', coordinates: coords },
  }
}

export function overpassToGeojson(raw: unknown, id?: EnvironmentalOverlayId): GeoJSON.FeatureCollection {
  if (!raw || typeof raw !== 'object') {
    return { type: 'FeatureCollection', features: [] }
  }
  const elements = (raw as { elements?: OverpassElement[] }).elements
  if (!Array.isArray(elements)) {
    return { type: 'FeatureCollection', features: [] }
  }
  const features: GeoJSON.Feature[] = []
  for (const el of elements) {
    const f = elementToFeature(el, id)
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

/** Fetch with explicit timeout to prevent hanging requests */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response
  } catch (err) {
    clearTimeout(timeoutId)
    throw err
  }
}

async function postOverpass(
  endpoint: string,
  query: string,
  overlayId: EnvironmentalOverlayId,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = endpoint
  const body = `data=${encodeURIComponent(query)}`

  traceOverlay('fetch_request_start', { overlayId, endpoint, bodyLength: body.length })

  try {
    // Use 8s timeout per endpoint attempt (fails fast, retries to next endpoint)
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      mode: 'cors',
    }, 8000)

    traceOverlay('fetch_request_complete', { overlayId, endpoint, status: res.status, ok: res.ok })

    if (res.status === 429) {
      traceOverlay('fetch_rate_limited', { overlayId, endpoint })
      throw new Error('OSM busy (rate limit) — wait 30s and retry')
    }
    if (!res.ok) {
      traceOverlay('fetch_http_error', { overlayId, endpoint, status: res.status })
      throw new Error(`OSM data unavailable (${res.status})`)
    }

    const json = await res.json()
    traceOverlay('fetch_json_parsed', { overlayId, endpoint, hasElements: !!json?.elements })
    return json
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    const isTimeout = errorMsg.includes('abort') || errorMsg.includes('timeout')
    traceOverlay(isTimeout ? 'fetch_timeout' : 'fetch_network_error', {
      overlayId,
      endpoint,
      error: errorMsg.slice(0, 100),
    })
    throw err
  }
}

export async function fetchOverpassGeojson(
  id: EnvironmentalOverlayId,
  bbox: MapBbox,
  signal?: AbortSignal,
): Promise<GeoJSON.FeatureCollection> {
  traceOverlay('fetch_overpass_geojson_start', { overlayId: id, bbox })

  const q = overpassQuery(id, bbox)
  if (!q) {
    traceOverlay('fetch_invalid_bbox', { overlayId: id })
    throw new Error('Map area invalid — pan or zoom and try again.')
  }

  traceOverlay('fetch_query_built', { overlayId: id, queryLength: q.length })

  return enqueueOverpass(async () => {
    let lastErr: unknown = null
    let attempt = 0

    for (const endpoint of OVERPASS_ENDPOINTS) {
      attempt++
      traceOverlay('fetch_endpoint_attempt', { overlayId: id, endpoint, attempt })

      try {
        const json = await postOverpass(endpoint, q, id, signal)
        const geojson = overpassToGeojson(json, id)
        traceOverlay('fetch_success', {
          overlayId: id,
          endpoint,
          featureCount: geojson.features.length,
          attempt,
        })
        return geojson
      } catch (e) {
        lastErr = e
        traceOverlay('fetch_endpoint_failed', {
          overlayId: id,
          endpoint,
          attempt,
          error: (e instanceof Error ? e.message : String(e)).slice(0, 100),
        })
        if (signal?.aborted) throw e
        // Continue to next endpoint
      }
    }

    traceOverlay('fetch_all_endpoints_failed', { overlayId: id, attempts: attempt })
    throw networkOverlayError(lastErr)
  })
}
