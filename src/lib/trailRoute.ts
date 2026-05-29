/**
 * Trail-following route geometry — local MapLibre vector queries only.
 *
 * Routes along trail polylines (segment graph + full vertex chains), not
 * crow-flies between waypoint pins.
 */

import type { Map as MapLibreMap } from 'maplibre-gl'
import { haversineMeters, midpointAlongPolyline, polylineDistance } from './haversine'
import {
  collectTrailSnapLayerIds,
  findNearestTrailForRouting,
  projectPointOnSegment,
  resolveTrailSnapClass,
  ROUTE_TRACE_SNAP_M,
  type LatLng,
} from './snapToTrail'
import { tier1Debug } from './tier1DebugLog'

export type TrailLegMode = 'trail' | 'direct'

export type TrailLegResult = {
  points: LatLng[]
  mode: TrailLegMode
  distance: { miles: number; feet: number }
  midpoint: { lat: number; lng: number }
}

export type TrailRouteResult = {
  coordinates: [number, number][]
  legs: TrailLegResult[]
  totalDistance: { miles: number; feet: number }
  allTrail: boolean
}

/** One vector-tile polyline with all vertices preserved for switchbacks. */
type RichSegment = {
  coords: LatLng[]
  lengthM: number
}

type SnapOnSegment = {
  segIdx: number
  point: LatLng
  /** Distance along segment polyline from coords[0] in meters. */
  alongM: number
}

const MAX_ROUTE_SEGMENTS = 1200
const MAX_SEGMENT_GRAPH_NODES = 800
const ROUTE_CONNECT_RADIUS_M = 200
const MIN_BBOX_PAD_M = 180
const ENDPOINT_MERGE_M = 45
const ROUTE_GAP_BRIDGE_M = 55
/** Sample interval along each leg when tracing trails via snap queries. */
const CORRIDOR_SAMPLE_M = 10

function nodeId(lat: number, lng: number): string {
  return `${Math.round(lat * 1e4)}_${Math.round(lng * 1e4)}`
}

function samePoint(a: LatLng, b: LatLng, epsM = 2): boolean {
  return haversineMeters(a.lat, a.lng, b.lat, b.lng) <= epsM
}

function padLegBBox(from: LatLng, to: LatLng) {
  const directM = haversineMeters(from.lat, from.lng, to.lat, to.lng)
  const pad = Math.max(MIN_BBOX_PAD_M, directM * 0.55)
  const minLat = Math.min(from.lat, to.lat)
  const maxLat = Math.max(from.lat, to.lat)
  const minLng = Math.min(from.lng, to.lng)
  const maxLng = Math.max(from.lng, to.lng)
  const midLat = (minLat + maxLat) / 2
  const padLat = pad / 111320
  const cos = Math.max(0.2, Math.cos((midLat * Math.PI) / 180))
  const padLng = pad / (111320 * cos)
  return {
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
    minLng: minLng - padLng,
    maxLng: maxLng + padLng,
  }
}

function pointInBox(p: LatLng, box: ReturnType<typeof padLegBBox>): boolean {
  return (
    p.lat >= box.minLat &&
    p.lat <= box.maxLat &&
    p.lng >= box.minLng &&
    p.lng <= box.maxLng
  )
}

function segmentIntersectsBox(coords: LatLng[], box: ReturnType<typeof padLegBBox>): boolean {
  for (const p of coords) {
    if (pointInBox(p, box)) return true
  }
  for (let i = 1; i < coords.length; i++) {
    const mid = {
      lat: (coords[i - 1].lat + coords[i].lat) / 2,
      lng: (coords[i - 1].lng + coords[i].lng) / 2,
    }
    if (pointInBox(mid, box)) return true
  }
  return false
}

function forEachTrailLineInFeature(
  feature: { geometry?: { type?: string; coordinates?: unknown } },
  budget: { left: number },
  fn: (coords: LatLng[]) => void,
): void {
  const geom = feature.geometry
  if (!geom?.coordinates || budget.left <= 0) return

  const toLatLngs = (ring: unknown): LatLng[] | null => {
    if (!Array.isArray(ring) || ring.length < 2) return null
    const out: LatLng[] = []
    for (const c of ring) {
      if (!Array.isArray(c) || c.length < 2) return null
      if (typeof c[0] !== 'number' || typeof c[1] !== 'number') return null
      if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null
      out.push({ lat: c[1], lng: c[0] })
    }
    return out.length >= 2 ? out : null
  }

  if (geom.type === 'LineString') {
    const line = toLatLngs(geom.coordinates)
    if (line) {
      budget.left -= 1
      fn(line)
    }
    return
  }
  if (geom.type === 'MultiLineString') {
    const lines = geom.coordinates as unknown
    if (!Array.isArray(lines)) return
    for (const line of lines) {
      if (budget.left <= 0) break
      const coords = toLatLngs(line)
      if (coords) {
        budget.left -= 1
        fn(coords)
      }
    }
  }
}

function polylineLengthM(coords: LatLng[]): number {
  let m = 0
  for (let i = 1; i < coords.length; i++) {
    m += haversineMeters(coords[i - 1].lat, coords[i - 1].lng, coords[i].lat, coords[i].lng)
  }
  return m
}

function extractRichSegmentsFromFeatures(
  features: Array<{
    geometry?: { type?: string; coordinates?: unknown }
    properties?: Record<string, unknown>
    sourceLayer?: string
    layer?: { id?: string }
  }>,
  box: ReturnType<typeof padLegBBox>,
): RichSegment[] {
  const out: RichSegment[] = []
  const seen = new Set<string>()
  const budget = { left: MAX_ROUTE_SEGMENTS }

  for (const f of features) {
    if (budget.left <= 0) break
    if (!isTrailFeatureForRouting(f)) continue
    forEachTrailLineInFeature(f, budget, (coords) => {
      if (!segmentIntersectsBox(coords, box)) return
      const lengthM = polylineLengthM(coords)
      if (lengthM < 0.5) return
      const key = coords
        .map((c) => nodeId(c.lat, c.lng))
        .join('>')
      const keyRev = [...coords].reverse().map((c) => nodeId(c.lat, c.lng)).join('>')
      if (seen.has(key) || seen.has(keyRev)) return
      seen.add(key)
      out.push({ coords, lengthM })
    })
  }
  return out
}

function isTrailFeatureForRouting(f: {
  properties?: Record<string, unknown> | null
  sourceLayer?: string
  layer?: { id?: string }
}): boolean {
  if (resolveTrailSnapClass(f)) return true
  const lid = (f.layer?.id ?? '').toLowerCase()
  if (['path', 'trail', 'track', 'footway', 'hiking', 'foot', 'cycleway'].some((h) => lid.includes(h))) {
    return true
  }
  const sl = (f.sourceLayer ?? '').toLowerCase()
  return sl === 'trail' || sl.includes('transportation')
}

/** Merge tile fragments that share endpoints into longer trail polylines. */
function mergeConnectedRichSegments(input: RichSegment[]): RichSegment[] {
  let pool = input.map((s) => ({ coords: [...s.coords], lengthM: s.lengthM }))

  const tryJoin = (a: LatLng[], b: LatLng[]): LatLng[] | null => {
    const aEnd = a[a.length - 1]
    const bStart = b[0]
    const bEnd = b[b.length - 1]
    const aStart = a[0]
    if (haversineMeters(aEnd.lat, aEnd.lng, bStart.lat, bStart.lng) <= ENDPOINT_MERGE_M) {
      return [...a, ...b.slice(1)]
    }
    if (haversineMeters(aEnd.lat, aEnd.lng, bEnd.lat, bEnd.lng) <= ENDPOINT_MERGE_M) {
      return [...a, ...[...b].reverse().slice(1)]
    }
    if (haversineMeters(aStart.lat, aStart.lng, bEnd.lat, bEnd.lng) <= ENDPOINT_MERGE_M) {
      return [...[...b].reverse(), ...a.slice(1)]
    }
    if (haversineMeters(aStart.lat, aStart.lng, bStart.lat, bStart.lng) <= ENDPOINT_MERGE_M) {
      return [...b, ...a.slice(1)]
    }
    return null
  }

  let merged = true
  while (merged && pool.length > 1) {
    merged = false
    outer: for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const joined = tryJoin(pool[i].coords, pool[j].coords)
        if (joined) {
          pool[i] = { coords: joined, lengthM: polylineLengthM(joined) }
          pool.splice(j, 1)
          merged = true
          break outer
        }
      }
    }
  }
  return pool
}

function cumulativeDistances(coords: LatLng[]): number[] {
  const cum = [0]
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversineMeters(coords[i - 1].lat, coords[i - 1].lng, coords[i].lat, coords[i].lng))
  }
  return cum
}

function pointAtDistance(coords: LatLng[], cum: number[], distM: number): LatLng {
  if (distM <= 0) return { ...coords[0] }
  const total = cum[cum.length - 1]
  if (distM >= total) return { ...coords[coords.length - 1] }
  for (let i = 1; i < coords.length; i++) {
    if (cum[i] >= distM) {
      const segM = cum[i] - cum[i - 1]
      const t = segM > 0 ? (distM - cum[i - 1]) / segM : 0
      return {
        lat: coords[i - 1].lat + t * (coords[i].lat - coords[i - 1].lat),
        lng: coords[i - 1].lng + t * (coords[i].lng - coords[i - 1].lng),
      }
    }
  }
  return { ...coords[coords.length - 1] }
}

function extractSubPolylineByDistance(coords: LatLng[], startM: number, endM: number): LatLng[] {
  const lo = Math.max(0, Math.min(startM, endM))
  const hi = Math.max(startM, endM)
  const cum = cumulativeDistances(coords)
  const total = cum[cum.length - 1]
  if (total <= 0) return [{ ...coords[0] }]
  const out: LatLng[] = [pointAtDistance(coords, cum, lo)]
  for (let i = 0; i < coords.length; i++) {
    if (cum[i] > lo && cum[i] < hi) {
      const p = coords[i]
      if (!samePoint(out[out.length - 1], p, 0.5)) out.push({ ...p })
    }
  }
  const endPt = pointAtDistance(coords, cum, hi)
  if (!samePoint(out[out.length - 1], endPt, 0.5)) out.push(endPt)
  return out
}

function collectVectorTrailSources(map: MapLibreMap): Array<{ sourceId: string; sourceLayers: Set<string> }> {
  const out: Array<{ sourceId: string; sourceLayers: Set<string> }> = []
  let spec: unknown
  try {
    spec = map.getStyle?.()
  } catch {
    return out
  }
  const layers = (spec as { layers?: unknown })?.layers
  const sources = (spec as { sources?: Record<string, { type?: string }> })?.sources ?? {}
  if (!Array.isArray(layers)) return out

  const bySource = new Map<string, Set<string>>()
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue
    const L = layer as Record<string, unknown>
    if (L.type !== 'line') continue
    const src = L.source
    const sl = L['source-layer']
    if (typeof src !== 'string' || typeof sl !== 'string') continue
    const srcType = sources[src]?.type
    if (srcType !== 'vector' && srcType !== 'geojson') continue
    const slLower = sl.toLowerCase()
    if (slLower === 'trail' || slLower.includes('transportation') || slLower === 'ski') {
      if (!bySource.has(src)) bySource.set(src, new Set())
      bySource.get(src)!.add(sl)
    }
  }
  for (const [sourceId, sourceLayers] of bySource) {
    out.push({ sourceId, sourceLayers })
  }
  return out
}

function queryTrailFeaturesForLeg(map: MapLibreMap, from: LatLng, to: LatLng) {
  const box = padLegBBox(from, to)
  const merged: Array<{
    geometry?: { type?: string; coordinates?: unknown }
    properties?: Record<string, unknown>
    sourceLayer?: string
    layer?: { id?: string }
  }> = []

  const directM = haversineMeters(from.lat, from.lng, to.lat, to.lng)
  const sampleCount = Math.min(14, Math.max(3, Math.ceil(directM / 35)))
  const samplePoints: LatLng[] = [{ ...from }]
  for (let i = 1; i < sampleCount; i++) {
    const t = i / sampleCount
    samplePoints.push({
      lat: from.lat + t * (to.lat - from.lat),
      lng: from.lng + t * (to.lng - from.lng),
    })
  }
  samplePoints.push({ ...to })

  try {
    const layerIds = collectTrailSnapLayerIds(map)
    for (const pt of samplePoints) {
      const screen = map.project([pt.lng, pt.lat])
      const pad = Math.min(220, 120 + directM * 0.12)
      const screenBox: [[number, number], [number, number]] = [
        [screen.x - pad, screen.y - pad],
        [screen.x + pad, screen.y + pad],
      ]
      let rendered: ReturnType<MapLibreMap['queryRenderedFeatures']> = []
      if (layerIds.length > 0) {
        rendered = map.queryRenderedFeatures(screenBox, { layers: layerIds })
        if (rendered.length === 0) rendered = map.queryRenderedFeatures(screenBox, {})
      } else {
        rendered = map.queryRenderedFeatures(screenBox, {})
      }
      merged.push(...rendered)
    }
  } catch {
    /* ignore */
  }

  for (const { sourceId, sourceLayers } of collectVectorTrailSources(map)) {
    for (const sourceLayer of sourceLayers) {
      try {
        const srcFeats = map.querySourceFeatures(sourceId, { sourceLayer })
        for (const f of srcFeats) {
          merged.push(f)
        }
      } catch {
        /* ignore */
      }
    }
  }

  return { box, features: merged }
}

function alongPolylineM(coords: LatLng[], point: LatLng): number {
  let m = 0
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]
    const b = coords[i]
    const edgeLen = haversineMeters(a.lat, a.lng, b.lat, b.lng)
    const proj = projectPointOnSegment(point, a, b)
    if (!proj) {
      m += edgeLen
      continue
    }
    const onEdge =
      haversineMeters(a.lat, a.lng, proj.lat, proj.lng) +
        haversineMeters(proj.lat, proj.lng, b.lat, b.lng) <=
      edgeLen + 1.5
    if (onEdge && proj.t >= -0.02 && proj.t <= 1.02) {
      return m + haversineMeters(a.lat, a.lng, proj.lat, proj.lng)
    }
    m += edgeLen
  }
  return m
}

function snapToNearestSegment(
  point: LatLng,
  segments: RichSegment[],
  maxRadiusM = ROUTE_CONNECT_RADIUS_M,
): SnapOnSegment | null {
  let best: SnapOnSegment | null = null
  for (let i = 0; i < segments.length; i++) {
    const coords = segments[i].coords
    for (let j = 1; j < coords.length; j++) {
      const proj = projectPointOnSegment(point, coords[j - 1], coords[j])
      if (!proj || proj.distanceMeters > maxRadiusM) continue
      const alongM = alongPolylineM(coords, proj)
      if (best === null || proj.distanceMeters < haversineMeters(point.lat, point.lng, best.point.lat, best.point.lng)) {
        best = { segIdx: i, point: { lat: proj.lat, lng: proj.lng }, alongM }
      }
    }
  }
  return best
}

function segmentsShareEndpoint(a: RichSegment, b: RichSegment): boolean {
  const aEnds = [a.coords[0], a.coords[a.coords.length - 1]]
  const bEnds = [b.coords[0], b.coords[b.coords.length - 1]]
  for (const ae of aEnds) {
    for (const be of bEnds) {
      if (haversineMeters(ae.lat, ae.lng, be.lat, be.lng) <= ROUTE_GAP_BRIDGE_M) return true
    }
  }
  return false
}

function sliceSegmentBetween(seg: RichSegment, enter: SnapOnSegment, exit: SnapOnSegment): LatLng[] {
  if (enter.segIdx !== exit.segIdx) return [enter.point, exit.point]
  return extractSubPolylineByDistance(seg.coords, enter.alongM, exit.alongM)
}

function trimPolylineFromTo(coords: LatLng[], from: LatLng, to: LatLng): LatLng[] {
  const out: LatLng[] = [{ ...from }]
  let started = false
  for (let i = 0; i < coords.length; i++) {
    const p = coords[i]
    if (!started) {
      if (samePoint(p, from, 3) || haversineMeters(p.lat, p.lng, from.lat, from.lng) < 8) started = true
      continue
    }
    if (samePoint(p, to, 3)) {
      out.push({ ...to })
      return out
    }
    if (!samePoint(out[out.length - 1], p, 1)) out.push(p)
  }
  if (!samePoint(out[out.length - 1], to, 1)) out.push({ ...to })
  return out
}

function dijkstraSegmentPath(
  segments: RichSegment[],
  startSeg: number,
  endSeg: number,
): number[] | null {
  if (startSeg === endSeg) return [startSeg]
  const n = segments.length
  if (n > MAX_SEGMENT_GRAPH_NODES) return null

  const adj = new Map<number, number[]>()
  for (let i = 0; i < n; i++) adj.set(i, [])
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (segmentsShareEndpoint(segments[i], segments[j])) {
        adj.get(i)!.push(j)
        adj.get(j)!.push(i)
      }
    }
  }

  const dist = new Map<number, number>()
  const prev = new Map<number, number>()
  const visited = new Set<number>()
  dist.set(startSeg, 0)

  while (visited.size < n) {
    let u = -1
    let best = Infinity
    for (const [id, d] of dist) {
      if (visited.has(id)) continue
      if (d < best) {
        best = d
        u = id
      }
    }
    if (u < 0 || best === Infinity) break
    if (u === endSeg) break
    visited.add(u)
    for (const v of adj.get(u) ?? []) {
      if (visited.has(v)) continue
      const alt = best + segments[v].lengthM
      const cur = dist.get(v)
      if (cur == null || alt < cur) {
        dist.set(v, alt)
        prev.set(v, u)
      }
    }
  }

  if (!dist.has(endSeg)) return null
  const path: number[] = [endSeg]
  let cur: number | undefined = endSeg
  while (cur != null && cur !== startSeg) {
    const p = prev.get(cur)
    if (p == null) return null
    path.push(p)
    cur = p
  }
  path.reverse()
  return path
}

function buildPolylineAlongSegmentPath(
  segments: RichSegment[],
  segPath: number[],
  start: SnapOnSegment,
  end: SnapOnSegment,
  from: LatLng,
  to: LatLng,
): LatLng[] {
  const out: LatLng[] = [{ ...from }]
  if (!samePoint(out[0], start.point, 2)) out.push({ ...start.point })

  if (segPath.length === 1) {
    const slice = sliceSegmentBetween(segments[start.segIdx], start, end)
    for (const p of slice) {
      if (!samePoint(out[out.length - 1], p, 1)) out.push(p)
    }
  } else {
    for (let k = 0; k < segPath.length; k++) {
      const idx = segPath[k]
      const seg = segments[idx]
      let slice: LatLng[]
      if (k === 0) {
        const exitEnd =
          k + 1 < segPath.length
            ? pickSharedEndpoint(seg, segments[segPath[k + 1]])
            : end.point
        slice = trimPolylineFromTo(seg.coords, start.point, exitEnd)
      } else if (k === segPath.length - 1) {
        const enterEnd =
          k > 0 ? pickSharedEndpoint(seg, segments[segPath[k - 1]]) : start.point
        slice = trimPolylineFromTo(seg.coords, enterEnd, end.point)
      } else {
        const enterEnd = pickSharedEndpoint(seg, segments[segPath[k - 1]])
        const exitEnd = pickSharedEndpoint(seg, segments[segPath[k + 1]])
        slice = trimPolylineFromTo(seg.coords, enterEnd, exitEnd)
      }
      for (const p of slice) {
        if (!samePoint(out[out.length - 1], p, 1)) out.push(p)
      }
    }
  }

  if (!samePoint(out[out.length - 1], end.point, 2)) out.push({ ...end.point })
  if (!samePoint(out[out.length - 1], to, 2)) out.push({ ...to })
  return out
}

function pickSharedEndpoint(a: RichSegment, b: RichSegment): LatLng {
  const aEnds = [a.coords[0], a.coords[a.coords.length - 1]]
  const bEnds = [b.coords[0], b.coords[b.coords.length - 1]]
  let best = aEnds[0]
  let bestD = Infinity
  for (const ae of aEnds) {
    for (const be of bEnds) {
      const d = haversineMeters(ae.lat, ae.lng, be.lat, be.lng)
      if (d < bestD) {
        bestD = d
        best = ae
      }
    }
  }
  return best
}

function directLeg(from: LatLng, to: LatLng): TrailLegResult {
  const points = [from, to]
  return {
    points,
    mode: 'direct',
    distance: polylineDistance(points),
    midpoint: { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 },
  }
}

function routeOnSingleTrailSegment(
  segments: RichSegment[],
  from: LatLng,
  to: LatLng,
): LatLng[] | null {
  const start = snapToNearestSegment(from, segments)
  const end = snapToNearestSegment(to, segments)
  if (!start || !end || start.segIdx !== end.segIdx) return null

  const seg = segments[start.segIdx]
  const slice = extractSubPolylineByDistance(seg.coords, start.alongM, end.alongM)
  if (slice.length < 2) return null

  const poly: LatLng[] = [{ ...from }]
  for (const p of slice) {
    if (!samePoint(poly[poly.length - 1], p, 1)) poly.push(p)
  }
  if (!samePoint(poly[poly.length - 1], to, 1)) poly.push({ ...to })

  const directM = haversineMeters(from.lat, from.lng, to.lat, to.lng)
  const trailM = polylineDistance(poly).miles * 1609.344
  if (poly.length < 3) return null
  if (trailM < directM * 0.97) return null

  return poly
}

function routeAlongTrailSegments(
  segments: RichSegment[],
  from: LatLng,
  to: LatLng,
): LatLng[] | null {
  const single = routeOnSingleTrailSegment(segments, from, to)
  if (single) return single

  const start = snapToNearestSegment(from, segments)
  const end = snapToNearestSegment(to, segments)
  if (!start || !end) return null

  const segPath = dijkstraSegmentPath(segments, start.segIdx, end.segIdx)
  if (!segPath || segPath.length === 0) return null

  const poly = buildPolylineAlongSegmentPath(segments, segPath, start, end, from, to)
  if (poly.length < 2) return null

  const directM = haversineMeters(from.lat, from.lng, to.lat, to.lng)
  const trailM = polylineDistance(poly).miles * 1609.344
  if (poly.length <= 2) return null
  if (poly.length <= 3 && trailM < directM * 0.72) return null
  if (directM > 25 && trailM > directM * 28) return null

  return poly
}

/** Prefer the candidate that follows trail bends (more vertices, not a chord shortcut). */
function pickBestTrailPolyline(candidates: Array<LatLng[] | null>, directM: number): LatLng[] | null {
  let best: LatLng[] | null = null
  let bestScore = -1
  for (const poly of candidates) {
    if (!poly || poly.length < 3) continue
    const trailM = polylineDistance(poly).miles * 1609.344
    if (trailM < directM * 0.96) continue
    const score = poly.length * 2000 + trailM
    if (score > bestScore) {
      bestScore = score
      best = poly
    }
  }
  return best
}

/**
 * Trace a leg by snapping sample points along the chord to rendered trail geometry.
 * Reuses the same query path as waypoint snap (reliable on MapTiler Outdoor).
 */
function routeTrailLegByCorridorSnap(map: MapLibreMap, from: LatLng, to: LatLng): LatLng[] | null {
  const directM = haversineMeters(from.lat, from.lng, to.lat, to.lng)
  if (directM < 6) return null

  const stepM = Math.min(CORRIDOR_SAMPLE_M, Math.max(6, directM / 60))
  const n = Math.max(12, Math.ceil(directM / stepM))
  const samples: LatLng[] = []
  for (let i = 0; i <= n; i += 1) {
    const t = i / n
    samples.push({
      lat: from.lat + t * (to.lat - from.lat),
      lng: from.lng + t * (to.lng - from.lng),
    })
  }

  const path: LatLng[] = []
  let snapHits = 0
  for (const s of samples) {
    const cand = findNearestTrailForRouting(map, {
      lat: s.lat,
      lng: s.lng,
      radiusMeters: ROUTE_TRACE_SNAP_M,
    })
    const p: LatLng = cand ? { lat: cand.snappedLat, lng: cand.snappedLng } : s
    if (cand) snapHits += 1
    if (path.length === 0 || !samePoint(path[path.length - 1], p, 2)) {
      path.push(p)
    }
  }

  path[0] = { ...from }
  path[path.length - 1] = { ...to }

  const minHits = Math.max(4, Math.floor(n * 0.28))
  if (snapHits < minHits || path.length < 4) return null

  const trailM = polylineDistance(path).miles * 1609.344
  if (path.length <= 3 && trailM < directM * 0.9) return null

  return path
}

function trailLegFromPolyline(poly: LatLng[], from: LatLng, to: LatLng): TrailLegResult {
  return {
    points: poly,
    mode: 'trail',
    distance: polylineDistance(poly),
    midpoint: midpointAlongPolyline(poly) ?? { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 },
  }
}

/** Route one leg along trail geometry; falls back to straight line only when trail cannot be resolved. */
export function routeTrailLeg(map: MapLibreMap | null | undefined, from: LatLng, to: LatLng): TrailLegResult {
  if (map == null) return directLeg(from, to)
  if (samePoint(from, to)) {
    return { points: [from], mode: 'direct', distance: { miles: 0, feet: 0 }, midpoint: from }
  }

  const directM = haversineMeters(from.lat, from.lng, to.lat, to.lng)

  let segmentPoly: LatLng[] | null = null
  let singleSegmentPoly: LatLng[] | null = null
  let segments: RichSegment[] = []
  try {
    const { box, features } = queryTrailFeaturesForLeg(map, from, to)
    segments = mergeConnectedRichSegments(extractRichSegmentsFromFeatures(features, box))
    if (segments.length > 0) {
      singleSegmentPoly = routeOnSingleTrailSegment(segments, from, to)
      segmentPoly = routeAlongTrailSegments(segments, from, to)
    }
  } catch {
    segments = []
  }

  const corridor = routeTrailLegByCorridorSnap(map, from, to)
  const best = pickBestTrailPolyline([singleSegmentPoly, segmentPoly, corridor], directM)
  if (best && best.length >= 3) {
    tier1Debug('trail-route', 'leg-trail', {
      from,
      to,
      points: best.length,
      via: best === corridor ? 'corridor' : best === segmentPoly ? 'segment-graph' : 'merged',
    })
    return trailLegFromPolyline(best, from, to)
  }

  tier1Debug('trail-route', 'leg-fallback-direct', {
    from,
    to,
    segmentCount: segments.length,
  })
  return directLeg(from, to)
}

/** Build full multi-leg route with trail-following where geometry allows. */
export function computeTrailRoute(
  map: MapLibreMap | null | undefined,
  waypoints: Array<{ lat: number; lng: number }>,
  trailFollowEnabled: boolean,
): TrailRouteResult {
  if (waypoints.length < 2) {
    return { coordinates: [], legs: [], totalDistance: { miles: 0, feet: 0 }, allTrail: false }
  }

  const legs: TrailLegResult[] = []
  const coordinates: [number, number][] = []

  for (let i = 1; i < waypoints.length; i += 1) {
    const from = { lat: waypoints[i - 1].lat, lng: waypoints[i - 1].lng }
    const to = { lat: waypoints[i].lat, lng: waypoints[i].lng }
    const leg = trailFollowEnabled ? routeTrailLeg(map, from, to) : directLeg(from, to)
    legs.push(leg)

    for (let j = 0; j < leg.points.length; j += 1) {
      const p = leg.points[j]
      if (j === 0 && coordinates.length > 0) {
        const last = coordinates[coordinates.length - 1]
        const prev = { lat: last[1], lng: last[0] }
        if (samePoint(prev, p)) continue
      }
      coordinates.push([p.lng, p.lat])
    }
  }

  let totalMiles = 0
  for (const leg of legs) totalMiles += leg.distance.miles

  return {
    coordinates,
    legs,
    totalDistance: { miles: totalMiles, feet: totalMiles * 5280 },
    allTrail: legs.every((l) => l.mode === 'trail'),
  }
}

/** DEV: inspect one leg's trail routing (segment count, mode, point count). */
export function diagnoseTrailLeg(
  map: MapLibreMap | null | undefined,
  from: LatLng,
  to: LatLng,
): Record<string, unknown> {
  if (!map) return { error: 'no map' }
  const { box, features } = queryTrailFeaturesForLeg(map, from, to)
  const raw = extractRichSegmentsFromFeatures(features, box)
  const segments = mergeConnectedRichSegments(raw)
  const leg = routeTrailLeg(map, from, to)
  const corridorOnly = routeTrailLegByCorridorSnap(map, from, to)
  return {
    featureCount: features.length,
    rawSegmentCount: raw.length,
    mergedSegmentCount: segments.length,
    legMode: leg.mode,
    legPoints: leg.points.length,
    legMiles: leg.distance.miles,
    directMiles: polylineDistance([from, to]).miles,
    corridorSnapPoints: corridorOnly?.length ?? 0,
    bbox: box,
  }
}

/** Test hook — route on synthetic polylines without a map. */
export function __routeOnRichSegmentsForTests(
  segments: RichSegment[],
  from: LatLng,
  to: LatLng,
): TrailLegResult {
  const poly = routeAlongTrailSegments(segments, from, to)
  if (!poly) return directLeg(from, to)
  return {
    points: poly,
    mode: 'trail',
    distance: polylineDistance(poly),
    midpoint: midpointAlongPolyline(poly) ?? { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 },
  }
}
