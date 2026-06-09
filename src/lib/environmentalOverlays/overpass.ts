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

/** Serial Overpass POSTs — public overpass-api.de 429s above 1 concurrent. */
const MAX_CONCURRENT_OVERPASS = 1
const OVERPASS_STAGGER_MS = 1_000
/** Match Overpass QL `[timeout:25]` — 8s client abort caused false failures. */
const OVERPASS_FETCH_TIMEOUT_MS = 22_000
const OVERPASS_RATE_LIMIT_BACKOFF_MS = 30_000

type OverpassQueueEntry<T> = {
  task: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
  enqueuedAt: number
}

let overpassInFlight = 0
const overpassPending: OverpassQueueEntry<unknown>[] = []
let overpassLastStartAt = 0
let overpassDispatchTimer: ReturnType<typeof setTimeout> | null = null
let overpassRateLimitUntil = 0

function signalOverpassRateLimit(endpoint: string): void {
  if (!endpoint.includes('overpass-api.de')) return
  overpassRateLimitUntil = Date.now() + OVERPASS_RATE_LIMIT_BACKOFF_MS
  traceOverlay('overpass_rate_limit_backoff', {
    backoffMs: OVERPASS_RATE_LIMIT_BACKOFF_MS,
    until: overpassRateLimitUntil,
  })
}

function dispatchOverpassQueue(): void {
  if (overpassDispatchTimer !== null) return
  if (overpassInFlight >= MAX_CONCURRENT_OVERPASS || overpassPending.length === 0) return

  const now = Date.now()
  const rateLimitWait = Math.max(0, overpassRateLimitUntil - now)
  const staggerWait = Math.max(0, overpassLastStartAt + OVERPASS_STAGGER_MS - now)
  const waitMs = Math.max(rateLimitWait, staggerWait)

  const runDispatch = () => {
    overpassDispatchTimer = null
    if (overpassInFlight >= MAX_CONCURRENT_OVERPASS || overpassPending.length === 0) return

    const entry = overpassPending.shift()!
    overpassInFlight++
    overpassLastStartAt = Date.now()

    traceOverlay('overpass_queue_dispatched', {
      queueDepth: overpassPending.length,
      inFlight: overpassInFlight,
      waitedMs: overpassLastStartAt - entry.enqueuedAt,
    })

    entry
      .task()
      .then(entry.resolve, entry.reject)
      .finally(() => {
        overpassInFlight--
        dispatchOverpassQueue()
      })

    if (overpassInFlight < MAX_CONCURRENT_OVERPASS && overpassPending.length > 0) {
      dispatchOverpassQueue()
    }
  }

  if (waitMs > 0) {
    overpassDispatchTimer = setTimeout(runDispatch, waitMs)
  } else {
    runDispatch()
  }
}

function enqueueOverpass<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    overpassPending.push({
      task,
      resolve: resolve as (value: T) => void,
      reject,
      enqueuedAt: Date.now(),
    })
    traceOverlay('overpass_queue_enqueued', {
      queueDepth: overpassPending.length,
      inFlight: overpassInFlight,
    })
    dispatchOverpassQueue()
  })
}

export function getOverpassQueueStats(): { pending: number; inFlight: number } {
  return { pending: overpassPending.length, inFlight: overpassInFlight }
}

/** Budget for overlay loading timeout: queue wait + two endpoint attempts per slot. */
export function estimateOverpassLoadingBudgetMs(queueAhead: number): number {
  const perSlotMs = OVERPASS_FETCH_TIMEOUT_MS * 2 + OVERPASS_STAGGER_MS
  // Always budget at least one full fetch (2 endpoints × timeout) — queueAhead=0 skips extension otherwise.
  const slots = Math.max(1, queueAhead + 1)
  return 30_000 + slots * perSlotMs
}

/** Reset queue state between unit tests. */
export function resetOverpassQueueForTests(): void {
  overpassPending.length = 0
  overpassInFlight = 0
  overpassLastStartAt = 0
  overpassRateLimitUntil = 0
  if (overpassDispatchTimer !== null) {
    clearTimeout(overpassDispatchTimer)
    overpassDispatchTimer = null
  }
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
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId)
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response
  } catch (err) {
    clearTimeout(timeoutId)
    if (controller.signal.aborted) {
      if (externalSignal?.aborted) {
        throw new DOMException('Overlay fetch cancelled.', 'AbortError')
      }
      throw new Error('OSM request timed out — retry or zoom in closer')
    }
    throw err
  } finally {
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort)
    }
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
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      mode: 'cors',
    }, OVERPASS_FETCH_TIMEOUT_MS, signal)

    traceOverlay('fetch_request_complete', { overlayId, endpoint, status: res.status, ok: res.ok })

    if (res.status === 429) {
      traceOverlay('fetch_rate_limited', { overlayId, endpoint })
      signalOverpassRateLimit(endpoint)
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
