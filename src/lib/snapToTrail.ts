/**
 * Trail snap assist — pure geometry + MapLibre `queryRenderedFeatures` only.
 *
 * CONTRACT-SENSITIVE (Phase 1):
 * - MapCanvas commits snapped coordinates when the Snap To Trail toggle is ON and a
 *   candidate exists within MAX_SNAP_RADIUS_M; otherwise raw GPS drop.
 * - This module never writes app state directly.
 * - Rendered trail geometry only for actual snaps: `queryRenderedFeatures` reads pixels
 *   already drawn from locked MapTiler styles — no `querySourceFeatures`, no routing APIs,
 *   no network. Capability probes the style spec; candidates query the viewport.
 * - Capability fails closed: unknown style / raster styles / missing hints → UI stays off;
 *   operators still get raw drops (never blocked).
 * - Raster / satellite basemaps must reject capability (no vector trail layers in spec).
 * - MapCanvas re-evaluates capability after style edits, zoom, idle, BFCache `pageshow`,
 *   and visibility resume so iOS/WebKit cannot freeze `trailSnapAssistCapable` false.
 * - Snapping must never block placement: null / false → caller uses historical raw drop.
 * - Raw coordinate preserved intentionally when accepting snap (`rawLat`/`rawLng`
 *   alongside final snapped `lat`/`lng`).
 */

import type { Map } from 'maplibre-gl'
import { haversineMeters } from './haversine'

/** Hard clamp — cannot be raised without revisiting iOS perf + UX audits. */
export const MAX_SNAP_RADIUS_M = 30

/** Wider search for trail-route tracing only (never used for waypoint placement). */
export const ROUTE_TRACE_SNAP_M = 72

/** Below this zoom, MVT trails are typically unusable for snap assist. */
export const MIN_SNAP_ZOOM = 12

/** OpenMapTiles `transportation` class whitelist — expand only with schema review. */
export const ALLOWED_TRAIL_CLASSES = new Set([
  'path',
  'track',
  'footway',
  'cycleway',
  'bridleway',
])

/** OpenMapTiles `transportation.subclass` — footways often use class `path`/`minor` + subclass. */
export const ALLOWED_TRAIL_SUBCLASSES = new Set([
  'path',
  'track',
  'footway',
  'cycleway',
  'bridleway',
  'steps',
  'pedestrian',
  'corridor',
  'hiking',
])

/** MapTiler Outdoor `trail` source-layer (`foot`, `hiking`, …). */
export const OUTDOOR_TRAIL_CLASSES = new Set([
  'foot',
  'hiking',
  'via_ferrata',
  'bicycle',
  'horse',
  'wheelchair',
])

/** Ski tileset route classes that behave like hiking trails. */
export const SKI_HIKE_TRAIL_CLASSES = new Set(['hike', 'skitour', 'snowshoe'])

const TRAIL_VECTOR_SOURCE_LAYERS = new Set(['trail', 'transportation', 'ski'])

/** OpenMapTiles path-like classes used when dedicated trails are unavailable. */
export const FALLBACK_NAV_PATH_CLASSES = new Set([
  'unclassified',
  'service',
  'residential',
  'living_street',
  'tertiary',
])

/** Situational overlay line layers that can back snap on raster basemaps. */
export const OVERLAY_SNAP_LAYER_IDS = [
  'hud-env-lyr-bike_paths',
  'hud-env-lyr-hiking_trails',
  'hud-env-lyr-abandoned_rail',
] as const

/** Motor vehicle classes — never snap, even if a style mis-tags a layer id. */
const REJECTED_ROAD_CLASSES = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'busway',
  'bus_guideway',
  'ferry',
])

/** Bounding box padding in screen px around the tap for feature queries. */
const QUERY_PAD_PX = 120

function queryPadPxForZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return QUERY_PAD_PX
  if (zoom < 13) return 160
  if (zoom < 15) return 140
  return QUERY_PAD_PX
}

/** Safety cap — worst-case segment evaluations per drop (bounded O(N)). */
const MAX_SEGMENT_EVALUATIONS = 500

export type LatLng = { lat: number; lng: number }

export type ProjectOnSegmentResult = {
  lat: number
  lng: number
  /** Projection parameter along AB; clamped to [0, 1]. */
  t: number
  distanceMeters: number
}

export type TrailSnapCandidate = {
  snappedLat: number
  snappedLng: number
  distanceMeters: number
  sourceClass: string
}

export type FindNearestTrailOptions = {
  lat: number
  lng: number
  radiusMeters: number
}

function finiteLatLng(p: LatLng): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng)
}

/**
 * Closest point on segment AB to P (local equirectangular plane at A).
 * Returns null if any coordinate is non-finite.
 */
export function projectPointOnSegment(
  p: LatLng,
  a: LatLng,
  b: LatLng,
): ProjectOnSegmentResult | null {
  if (!finiteLatLng(p) || !finiteLatLng(a) || !finiteLatLng(b)) return null

  const R = 6371000
  const cosALat = Math.cos((a.lat * Math.PI) / 180)
  const bx = R * cosALat * ((b.lng - a.lng) * Math.PI) / 180
  const by = R * ((b.lat - a.lat) * Math.PI) / 180
  const px = R * cosALat * ((p.lng - a.lng) * Math.PI) / 180
  const py = R * ((p.lat - a.lat) * Math.PI) / 180
  const vx = bx
  const vy = by
  const wx = px
  const wy = py
  const vv = vx * vx + vy * vy
  let t = vv < 1e-18 ? 0 : (wx * vx + wy * vy) / vv
  t = Math.max(0, Math.min(1, t))
  const cx = t * vx
  const cy = t * vy
  const lat = a.lat + (cy / R) * (180 / Math.PI)
  const lng = a.lng + (cx / (R * cosALat)) * (180 / Math.PI)
  const dm = haversineMeters(p.lat, p.lng, lat, lng)
  return { lat, lng, t, distanceMeters: dm }
}

/** Haversine distance from P to the closest point on segment AB; null if inputs invalid. */
export function distancePointToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number | null {
  const proj = projectPointOnSegment(p, a, b)
  return proj ? proj.distanceMeters : null
}

function isFiniteLngLatPair(c: unknown): c is [number, number] {
  return (
    Array.isArray(c) &&
    c.length >= 2 &&
    typeof c[0] === 'number' &&
    typeof c[1] === 'number' &&
    Number.isFinite(c[0]) &&
    Number.isFinite(c[1])
  )
}

function forEachCoordRingSegmentsBudgeted(
  ring: unknown,
  budget: { left: number },
  fn: (c1: [number, number], c2: [number, number]) => void,
): void {
  if (!Array.isArray(ring) || ring.length < 2 || budget.left <= 0) return

  const pair = (c1: unknown, c2: unknown) => {
    if (budget.left <= 0) return
    if (!isFiniteLngLatPair(c1) || !isFiniteLngLatPair(c2)) return
    budget.left -= 1
    fn(c1, c2)
  }

  for (let i = 1; i < ring.length && budget.left > 0; i += 1) {
    pair(ring[i - 1], ring[i])
  }
}

/** LineString + MultiLineString trail segments — other geometry types rejected. */
function forEachLineStringSegmentBudgeted(
  geometry: { type?: string; coordinates?: unknown },
  budget: { left: number },
  fn: (c1: [number, number], c2: [number, number]) => void,
): void {
  if (!geometry?.coordinates || budget.left <= 0) return

  if (geometry.type === 'LineString') {
    forEachCoordRingSegmentsBudgeted(geometry.coordinates, budget, fn)
    return
  }

  if (geometry.type === 'MultiLineString') {
    const lines = geometry.coordinates as unknown
    if (!Array.isArray(lines)) return
    for (const line of lines) {
      if (budget.left <= 0) break
      forEachCoordRingSegmentsBudgeted(line, budget, fn)
    }
  }
}

/** Layer-id substrings that signal trail/foot geometry on relaxed-schema styles. */
const TRAIL_LAYER_ID_HINTS = ['trail', 'path', 'track', 'footway', 'cycleway', 'bridleway', 'road', 'street']

/** Vector source-layers that can carry hike / foot / path geometry (OpenMapTiles + MapTiler Outdoor). */
const TRAIL_SOURCE_LAYER_HINTS = ['trail', 'transportation', 'transportation_name', 'ski']

type CapabilityProbe = {
  hasStyle: boolean
  totalLayerCount: number
  lineLayerCount: number
  matchedTransportationSourceLayers: number
  matchedTrailIdLayers: number
  rejectedHidden: number
  rejectedRasterBacked: number
  rejectedMalformed: number
  rejectedNonLine: number
  /** Visible vector line layers whose `source-layer` did not match transportation hints. */
  rejectedSourceLayerMismatch: number
  /** Visible vector line layers whose `id` did not match trail/id hints. */
  rejectedIdMismatch: number
  styleName: string | null
  /** Style JSON `id` when present (MapLibre / MapTiler metadata). */
  styleId: string | null
}

/**
 * Inspect the live style for visible vector LINE layers that could carry trails.
 * Fail-closed: any thrown access or non-line/non-vector layer is ignored.
 *
 * Accepts (relaxed for MapTiler outdoor-v4 / topo-v4):
 *   - line layer whose `source-layer` is `trail`, `transportation`, `transportation_name`, or `ski`
 *   - OR line layer whose `id` includes trail / path / track / footway / cycleway / bridleway
 *
 * Rejects:
 *   - raster-only styles (e.g. emergency OSM fallback, satellite-only)
 *   - layers backed by a `raster` / `raster-dem` source
 *   - missing or non-array `layers`
 */
function probeStyleForTrailLayers(map: Map): CapabilityProbe {
  const probe: CapabilityProbe = {
    hasStyle: false,
    totalLayerCount: 0,
    lineLayerCount: 0,
    matchedTransportationSourceLayers: 0,
    matchedTrailIdLayers: 0,
    rejectedHidden: 0,
    rejectedRasterBacked: 0,
    rejectedMalformed: 0,
    rejectedNonLine: 0,
    rejectedSourceLayerMismatch: 0,
    rejectedIdMismatch: 0,
    styleName: null,
    styleId: null,
  }

  let spec: unknown
  try {
    spec = map.getStyle?.()
  } catch {
    return probe
  }
  if (!spec || typeof spec !== 'object') return probe
  probe.hasStyle = true

  try {
    const name = (spec as { name?: unknown }).name
    if (typeof name === 'string') probe.styleName = name
    const sid = (spec as { id?: unknown }).id
    if (typeof sid === 'string') probe.styleId = sid
  } catch {
    /* ignore */
  }

  let layers: unknown
  let sources: Record<string, unknown> = {}
  try {
    layers = (spec as { layers?: unknown }).layers
    const rawSources = (spec as { sources?: unknown }).sources
    if (rawSources && typeof rawSources === 'object') {
      sources = rawSources as Record<string, unknown>
    }
  } catch {
    return probe
  }
  if (!Array.isArray(layers)) return probe
  probe.totalLayerCount = layers.length

  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') {
      probe.rejectedMalformed += 1
      continue
    }
    let layerType: unknown
    let sourceLayer: unknown
    let layerId: unknown
    let layerSource: unknown
    let layout: { visibility?: unknown } | null = null
    try {
      const L = layer as Record<string, unknown>
      layerType = L.type
      sourceLayer = L['source-layer']
      layerId = L.id
      layerSource = L.source
      layout = (L.layout as { visibility?: unknown } | undefined) ?? null
    } catch {
      probe.rejectedMalformed += 1
      continue
    }
    if (layerType !== 'line') {
      probe.rejectedNonLine += 1
      continue
    }
    probe.lineLayerCount += 1
    if (layout && layout.visibility === 'none') {
      probe.rejectedHidden += 1
      continue
    }

    // Reject layers backed by raster sources (defense in depth).
    if (typeof layerSource === 'string') {
      try {
        const src = sources[layerSource] as { type?: unknown } | undefined
        const t = src?.type
        if (t === 'raster' || t === 'raster-dem') {
          probe.rejectedRasterBacked += 1
          continue
        }
      } catch {
        /* ignore — treat as unknown source, fall through */
      }
    }

    const sl = typeof sourceLayer === 'string' ? sourceLayer.toLowerCase() : ''
    let sourceLayerMatched = false
    if (sl) {
      for (const hint of TRAIL_SOURCE_LAYER_HINTS) {
        if (sl === hint || sl.includes(hint)) {
          probe.matchedTransportationSourceLayers += 1
          sourceLayerMatched = true
          break
        }
      }
    }

    const id = typeof layerId === 'string' ? layerId.toLowerCase() : ''
    let idMatched = false
    if (id) {
      for (const hint of TRAIL_LAYER_ID_HINTS) {
        if (id.includes(hint)) {
          probe.matchedTrailIdLayers += 1
          idMatched = true
          break
        }
      }
    }

    if (!sourceLayerMatched) probe.rejectedSourceLayerMismatch += 1
    if (!idMatched) probe.rejectedIdMismatch += 1
  }

  return probe
}

/** Module-local DEV log throttle — log only when capability state changes. */
let lastDevCapabilityKey: string | null = null

function devLogCapability(map: Map, zoom: number, available: boolean, probe: CapabilityProbe): void {
  let devEnabled = false
  try {
    devEnabled = Boolean(
      typeof window !== 'undefined' &&
        (window.localStorage?.getItem('hud_snap_debug') === '1' ||
          window.localStorage?.getItem('hud_tier1_debug') === '1'),
    )
  } catch {
    devEnabled = false
  }
  if (!devEnabled) return

  let styleLoaded: boolean
  try {
    styleLoaded = Boolean(map.isStyleLoaded?.())
  } catch {
    styleLoaded = false
  }
  // CONTRACT-SENSITIVE (dev log dedupe):
  //   Log only on capability change / style reload / zoom-threshold crossing /
  //   evaluation reason change. We deliberately drop fractional zoom and
  //   transient `styleLoaded` from the key — those fire every animation frame
  //   during pan/zoom on mobile and would spam the console without changing
  //   the boolean `available`. Threshold crossing is captured by the
  //   `zoomBucket` (above/below MIN_SNAP_ZOOM).
  const zoomBucket = Number.isFinite(zoom) && zoom >= MIN_SNAP_ZOOM ? 'ok' : 'lo'
  const key = [
    available ? '1' : '0',
    zoomBucket,
    probe.totalLayerCount,
    probe.lineLayerCount,
    probe.matchedTransportationSourceLayers,
    probe.matchedTrailIdLayers,
    probe.rejectedHidden,
    probe.rejectedRasterBacked,
    probe.rejectedMalformed,
    probe.rejectedNonLine,
    probe.rejectedSourceLayerMismatch,
    probe.rejectedIdMismatch,
    probe.styleName ?? '',
    probe.styleId ?? '',
  ].join('|')
  if (key === lastDevCapabilityKey) return
  lastDevCapabilityKey = key
  try {
    console.info('[snapToTrail] capability change', {
      styleName: probe.styleName,
      styleId: probe.styleId,
      styleLoaded,
      zoom,
      minSnapZoom: MIN_SNAP_ZOOM,
      totalLayers: probe.totalLayerCount,
      lineLayers: probe.lineLayerCount,
      matched: {
        transportationSourceLayers: probe.matchedTransportationSourceLayers,
        trailIdLayers: probe.matchedTrailIdLayers,
      },
      rejected: {
        hidden: probe.rejectedHidden,
        rasterBacked: probe.rejectedRasterBacked,
        malformed: probe.rejectedMalformed,
        nonLine: probe.rejectedNonLine,
        sourceLayerMismatch: probe.rejectedSourceLayerMismatch,
        idMismatch: probe.rejectedIdMismatch,
      },
      available,
    })
  } catch {
    /* ignore log failures */
  }
}

/**
 * Single-flight lock for trail-snap preview UI — prevents stacked previews /
 * duplicate gesture handling (see tests).
 */
export type TrailSnapPreviewGate = {
  tryLock: () => boolean
  unlock: () => void
  isLocked: () => boolean
}

export function createTrailSnapPreviewGate(): TrailSnapPreviewGate {
  let locked = false
  return {
    tryLock() {
      if (locked) return false
      locked = true
      return true
    },
    unlock() {
      locked = false
    },
    isLocked() {
      return locked
    },
  }
}

function normalizeTag(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().trim() : ''
}

function layerIdLooksTrail(layerId: string): boolean {
  if (!layerId) return false
  const id = layerId.toLowerCase()
  return TRAIL_LAYER_ID_HINTS.some((hint) => id.includes(hint))
}

function featureSourceLayer(feature: {
  sourceLayer?: string
  layer?: { 'source-layer'?: string; sourceLayer?: string }
}): string {
  const direct = normalizeTag(feature.sourceLayer)
  if (direct) return direct
  const fromLayer = feature.layer as { 'source-layer'?: string; sourceLayer?: string } | undefined
  return normalizeTag(fromLayer?.['source-layer'] ?? fromLayer?.sourceLayer)
}

type SnapFeatureLike = {
  properties?: Record<string, unknown> | null
  sourceLayer?: string
  layer?: { id?: string; 'source-layer'?: string; sourceLayer?: string }
}

/**
 * Decide whether a rendered vector feature is trail geometry and return a
 * diagnostic class tag for logging / waypoint metadata.
 */
export function resolveTrailSnapClass(feature: SnapFeatureLike): string | null {
  const props = feature.properties ?? {}
  const cls = normalizeTag(props.class)
  const sub = normalizeTag(props.subclass)
  const srcLayer = featureSourceLayer(feature)
  const layerId = normalizeTag(feature.layer?.id)

  if (cls && REJECTED_ROAD_CLASSES.has(cls)) return null

  if (cls && ALLOWED_TRAIL_CLASSES.has(cls)) return cls
  if (cls && OUTDOOR_TRAIL_CLASSES.has(cls)) return cls
  if (cls && SKI_HIKE_TRAIL_CLASSES.has(cls)) return cls
  if (cls && FALLBACK_NAV_PATH_CLASSES.has(cls)) return cls
  if (sub && ALLOWED_TRAIL_SUBCLASSES.has(sub)) return sub

  if (layerId.startsWith('hud-env-lyr-')) {
    if (layerId.includes('bike')) return 'cycleway'
    if (layerId.includes('hiking')) return 'footway'
    if (layerId.includes('rail')) return 'track'
    return 'path'
  }

  if (srcLayer === 'trail') return cls || sub || 'trail'
  if (srcLayer === 'ski' && cls && SKI_HIKE_TRAIL_CLASSES.has(cls)) return cls

  if (layerIdLooksTrail(layerId) && TRAIL_VECTOR_SOURCE_LAYERS.has(srcLayer)) {
    return cls || sub || 'trail'
  }

  return null
}

function trailFeaturePriority(feature: SnapFeatureLike): number {
  const src = featureSourceLayer(feature)
  if (src === 'trail') return 0
  if (src === 'transportation') return 1
  if (src === 'ski') return 2
  return 3
}

/**
 * Collect visible line layer ids that render trail / path geometry (for tighter queries).
 */
export function collectTrailSnapLayerIds(map: Map): string[] {
  let spec: unknown
  try {
    spec = map.getStyle?.()
  } catch {
    return collectActiveOverlaySnapLayerIds(map)
  }
  const layers = (spec as { layers?: unknown })?.layers
  if (!Array.isArray(layers)) return collectActiveOverlaySnapLayerIds(map)

  const ids: string[] = []
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue
    const L = layer as Record<string, unknown>
    if (L.type !== 'line') continue
    const layout = L.layout as { visibility?: unknown } | undefined
    if (layout?.visibility === 'none') continue
    const sl = normalizeTag(L['source-layer'])
    const id = typeof L.id === 'string' ? L.id : ''
    let match = false
    if (sl) {
      for (const hint of TRAIL_SOURCE_LAYER_HINTS) {
        if (sl === hint || sl.includes(hint)) {
          match = true
          break
        }
      }
    }
    if (!match && layerIdLooksTrail(id)) match = true
    if (match && id) ids.push(id)
  }
  for (const overlayId of collectActiveOverlaySnapLayerIds(map)) {
    if (!ids.includes(overlayId)) ids.push(overlayId)
  }
  return ids
}

function collectActiveOverlaySnapLayerIds(map: Map): string[] {
  const ids: string[] = []
  for (const id of OVERLAY_SNAP_LAYER_IDS) {
    try {
      if (map.getLayer(id)) ids.push(id)
    } catch {
      /* ignore */
    }
  }
  return ids
}

function hasOverlaySnapLayers(map: Map): boolean {
  return collectActiveOverlaySnapLayerIds(map).length > 0
}

/**
 * Synchronous, local-only: queries vectors already rendered in the viewport.
 * Returns null if nothing qualifies within the clamped radius.
 */
export function findNearestTrailCandidate(
  map: Map,
  opts: FindNearestTrailOptions,
): TrailSnapCandidate | null {
  const rawLat = opts.lat
  const rawLng = opts.lng
  if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return null
  const maxM = Math.min(opts.radiusMeters, MAX_SNAP_RADIUS_M)
  if (maxM <= 0) return null

  const p: LatLng = { lat: rawLat, lng: rawLng }
  const hit = queryNearestTrailHit(map, p, maxM)
  if (!hit) return null
  return trailHitToCandidate(hit)
}

function trailHitToCandidate(hit: TrailFeatureHit): TrailSnapCandidate {
  return {
    snappedLat: hit.lat,
    snappedLng: hit.lng,
    distanceMeters: hit.distanceMeters,
    sourceClass: hit.sourceClass,
  }
}

/**
 * Trail-route tracing only — wider radius than placement snap; does not change
 * MAX_SNAP_RADIUS_M placement contract.
 */
export function findNearestTrailForRouting(
  map: Map,
  opts: FindNearestTrailOptions,
): TrailSnapCandidate | null {
  const rawLat = opts.lat
  const rawLng = opts.lng
  if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return null
  const maxM = Math.min(opts.radiusMeters, ROUTE_TRACE_SNAP_M)
  if (maxM <= 0) return null
  const hit = queryNearestTrailHit(map, { lat: rawLat, lng: rawLng }, maxM)
  if (!hit) return null
  return trailHitToCandidate(hit)
}

function queryNearestTrailHit(map: Map, p: LatLng, maxM: number): TrailFeatureHit | null {
  let features: ReturnType<Map['queryRenderedFeatures']> = []
  try {
    const pt = map.project([p.lng, p.lat])
    let pad = QUERY_PAD_PX
    try {
      pad = queryPadPxForZoom(map.getZoom())
    } catch {
      /* use default pad */
    }
    const box: [[number, number], [number, number]] = [
      [pt.x - pad, pt.y - pad],
      [pt.x + pad, pt.y + pad],
    ]
    const layerIds = collectTrailSnapLayerIds(map)
    try {
      if (layerIds.length > 0) {
        features = map.queryRenderedFeatures(box, { layers: layerIds })
        if (features.length === 0) {
          features = map.queryRenderedFeatures(box, {})
        }
      } else {
        features = map.queryRenderedFeatures(box, {})
      }
    } catch {
      features = map.queryRenderedFeatures(box, {})
    }
  } catch {
    return null
  }

  const ordered = [...features].sort(
    (a, b) => trailFeaturePriority(a) - trailFeaturePriority(b),
  )

  const acc: { best: TrailFeatureHit | null } = { best: null }
  const segBudget = { left: MAX_SEGMENT_EVALUATIONS }

  const considerHit = (
    lat: number,
    lng: number,
    distanceMeters: number,
    sourceClass: string,
    properties: Record<string, unknown>,
  ) => {
    if (distanceMeters > maxM) return
    if (acc.best === null || distanceMeters < acc.best.distanceMeters) {
      acc.best = { lat, lng, distanceMeters, sourceClass, properties }
    }
  }

  for (const f of ordered) {
    if (segBudget.left <= 0) break
    const snapClass = resolveTrailSnapClass(f)
    if (!snapClass) continue
    const props = (f.properties ?? {}) as Record<string, unknown>
    const geom = f.geometry as { type?: string; coordinates?: unknown }
    forEachLineStringSegmentBudgeted(geom, segBudget, (c1, c2) => {
      const a: LatLng = { lat: c1[1], lng: c1[0] }
      const b: LatLng = { lat: c2[1], lng: c2[0] }
      const proj = projectPointOnSegment(p, a, b)
      if (proj) {
        considerHit(proj.lat, proj.lng, proj.distanceMeters, snapClass, props)
      }
      // Vertices at sharp corners: segment projection can cut the bend; endpoints win when closer.
      const distA = haversineMeters(p.lat, p.lng, a.lat, a.lng)
      considerHit(a.lat, a.lng, distA, snapClass, props)
      const distB = haversineMeters(p.lat, p.lng, b.lat, b.lng)
      considerHit(b.lat, b.lng, distB, snapClass, props)
    })
  }

  if (acc.best === null || acc.best.distanceMeters > maxM) return null
  return acc.best
}

/** Max query radius for trail inspect (tap-for-info) — wider than snap assist. */
export const TRAIL_INSPECT_MAX_RADIUS_M = 28

export type TrailFeatureHit = {
  lat: number
  lng: number
  distanceMeters: number
  sourceClass: string
  properties: Record<string, unknown>
}

/**
 * Read-only trail feature at a map point (Outdoor vector). No network.
 * Used by Tier 2 trail inspect — does not mutate placement state.
 */
export function findTrailFeatureAtPoint(
  map: Map,
  opts: FindNearestTrailOptions,
): TrailFeatureHit | null {
  const rawLat = opts.lat
  const rawLng = opts.lng
  if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return null
  const maxM = Math.min(opts.radiusMeters, TRAIL_INSPECT_MAX_RADIUS_M)
  if (maxM <= 0) return null
  return queryNearestTrailHit(map, { lat: rawLat, lng: rawLng }, maxM)
}

/**
 * Capability gate for snap assist (UI toggle may still be off).
 * Safe false on any failure — snap failure must degrade to raw placement.
 *
 * CONTRACT-SENSITIVE (capability vs render readiness):
 *   - Capability is satisfied by the parsed STYLE SPEC (`getStyle().layers`).
 *   - We deliberately do NOT gate on `map.isStyleLoaded()` here. In real
 *     MapLibre runtime that flag also reflects in-flight tile/source loads
 *     and toggles false during normal pan/zoom on mobile networks — which
 *     would make the toggle "stuck disabled" even when trails are clearly
 *     rendered. Tile readiness is enforced where it actually matters
 *     (`findNearestTrailCandidate` uses try/catch around `queryRenderedFeatures`
 *     without gating on `isStyleLoaded()`). This stays fail-closed for raster /
 *     satellite styles because they yield zero qualifying line layers.
 *
 * Compatible with MapTiler outdoor-v4 / topo-v4 / streets schemas (relaxed
 * source-layer + layer-id detection).
 */
export function isSnapAvailable(map: Map | null | undefined): boolean {
  let z = NaN
  let probe: CapabilityProbe | null = null
  try {
    if (map == null) return false
    z = map.getZoom?.() ?? NaN
    if (typeof z !== 'number' || !Number.isFinite(z) || z < MIN_SNAP_ZOOM) return false
    probe = probeStyleForTrailLayers(map)
    if (!probe.hasStyle) return false
    const matched =
      probe.matchedTransportationSourceLayers > 0 || probe.matchedTrailIdLayers > 0
    if (matched) return true
    if (hasOverlaySnapLayers(map)) return true
    return false
  } catch {
    return false
  } finally {
    try {
      if (map != null) {
        const safeZoom = Number.isFinite(z) ? z : -1
        const safeProbe: CapabilityProbe =
          probe ?? {
            hasStyle: false,
            totalLayerCount: 0,
            lineLayerCount: 0,
            matchedTransportationSourceLayers: 0,
            matchedTrailIdLayers: 0,
            rejectedHidden: 0,
            rejectedRasterBacked: 0,
            rejectedMalformed: 0,
            rejectedNonLine: 0,
            rejectedSourceLayerMismatch: 0,
            rejectedIdMismatch: 0,
            styleName: null,
            styleId: null,
          }
        const available =
          safeProbe.hasStyle &&
          (safeProbe.matchedTransportationSourceLayers > 0 ||
            safeProbe.matchedTrailIdLayers > 0 ||
            hasOverlaySnapLayers(map)) &&
          safeZoom >= MIN_SNAP_ZOOM
        devLogCapability(map, safeZoom, available, safeProbe)
      }
    } catch {
      /* never throw from capability gate */
    }
  }
}

/**
 * Test-only hook: reset the DEV capability-log dedup so consecutive tests can
 * exercise the same shape without seeing it suppressed. Not used in production.
 */
export function __resetSnapCapabilityDevLogForTests(): void {
  lastDevCapabilityKey = null
}

/** Test-only: inspect style probe counts without mutating app state. */
export function __probeStyleForTrailLayersForTests(map: Map): CapabilityProbe {
  return probeStyleForTrailLayers(map)
}
