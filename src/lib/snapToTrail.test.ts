import { describe, expect, it } from 'vitest'
import type { Map } from 'maplibre-gl'
import {
  __probeStyleForTrailLayersForTests,
  createTrailSnapPreviewGate,
  distancePointToSegmentMeters,
  findNearestTrailCandidate,
  isSnapAvailable,
  MAX_SNAP_RADIUS_M,
  MIN_SNAP_ZOOM,
  projectPointOnSegment,
} from './snapToTrail'

type StubFeature = {
  type: 'Feature'
  geometry: {
    type: string
    coordinates?: unknown
  }
  properties?: Record<string, unknown>
}

function vectorTrailStyle() {
  return {
    version: 8 as const,
    name: 'MapTiler Outdoor (test)',
    sources: { openmaptiles: { type: 'vector' } },
    layers: [
      {
        id: 'road_path_trail',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
      },
    ],
  }
}

function relaxedTransportationNameStyle() {
  return {
    version: 8 as const,
    name: 'MapTiler Topo (test)',
    sources: { openmaptiles: { type: 'vector' } },
    layers: [
      {
        id: 'transportation_name_minor',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
      },
    ],
  }
}

function rasterOnlyStyle() {
  return {
    version: 8 as const,
    name: 'OSM Fallback (raster)',
    sources: { 'osm-fallback': { type: 'raster' } },
    layers: [
      {
        id: 'osm-fallback',
        type: 'raster',
        source: 'osm-fallback',
      },
    ],
  }
}

function malformedStyle() {
  return { version: 8, layers: 'not-an-array' }
}

/** Minimal MapLibre stub — only APIs used by snap helpers. */
function stubMap(overrides: {
  styleLoaded?: boolean
  features?: StubFeature[]
  screen?: { x: number; y: number }
  getZoom?: () => number
  getStyle?: () => unknown
}): Map {
  const screen = overrides.screen ?? { x: 500, y: 400 }
  return {
    isStyleLoaded: () => overrides.styleLoaded !== false,
    project: () => screen,
    queryRenderedFeatures: () => overrides.features ?? [],
    getZoom: overrides.getZoom ?? (() => 14),
    getStyle: overrides.getStyle ?? (() => vectorTrailStyle()),
  } as unknown as Map
}

describe('projectPointOnSegment (point projection invariant)', () => {
  it('returns null for non-finite coordinates', () => {
    expect(
      projectPointOnSegment({ lat: NaN, lng: 0 }, { lat: 0, lng: 0 }, { lat: 1, lng: 1 }),
    ).toBeNull()
    expect(
      projectPointOnSegment({ lat: 0, lng: 0 }, { lat: 1, lng: NaN }, { lat: 1, lng: 1 }),
    ).toBeNull()
  })

  it('at endpoint A has t=0, distance 0', () => {
    const a = { lat: 40.0, lng: -74.0 }
    const b = { lat: 40.01, lng: -74.01 }
    const r = projectPointOnSegment(a, a, b)
    expect(r).not.toBeNull()
    expect(r!.t).toBe(0)
    expect(r!.distanceMeters).toBe(0)
    expect(r!.lat).toBeCloseTo(a.lat, 8)
    expect(r!.lng).toBeCloseTo(a.lng, 8)
  })

  it('endpoint clamp invariant: at B has t=1', () => {
    const a = { lat: 40.0, lng: -74.0 }
    const b = { lat: 40.02, lng: -74.02 }
    const r = projectPointOnSegment(b, a, b)
    expect(r).not.toBeNull()
    expect(r!.t).toBe(1)
    expect(r!.distanceMeters).toBe(0)
  })

  it('t stays within [0, 1] for an exterior query point', () => {
    const r = projectPointOnSegment({ lat: 41.0, lng: -75.0 }, { lat: 40.0, lng: -74.0 }, { lat: 40.01, lng: -74.01 })
    expect(r).not.toBeNull()
    expect(r!.t).toBeGreaterThanOrEqual(0)
    expect(r!.t).toBeLessThanOrEqual(1)
  })
})

describe('distancePointToSegmentMeters', () => {
  it('is ~0 when P lies on the segment', () => {
    const d = distancePointToSegmentMeters(
      { lat: 40.0, lng: -74.005 },
      { lat: 40.0, lng: -74.01 },
      { lat: 40.0, lng: -74.0 },
    )
    expect(d).not.toBeNull()
    expect(d!).toBeLessThan(2)
  })

  it('returns null when projection inputs invalid', () => {
    expect(distancePointToSegmentMeters({ lat: NaN, lng: 0 }, { lat: 0, lng: 0 }, { lat: 1, lng: 1 })).toBeNull()
  })
})

describe('findNearestTrailCandidate', () => {
  it('returns null for non-finite raw coordinates', () => {
    const map = stubMap({
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-74.02, 40.0],
              [-74.0, 40.0],
            ],
          },
          properties: { class: 'path' },
        },
      ],
    })
    expect(findNearestTrailCandidate(map, { lat: NaN, lng: -74.0, radiusMeters: MAX_SNAP_RADIUS_M })).toBeNull()
    expect(
      findNearestTrailCandidate(map, { lat: 40.0, lng: Number.POSITIVE_INFINITY, radiusMeters: MAX_SNAP_RADIUS_M }),
    ).toBeNull()
  })

  it('max radius rejection beyond clamp / query radius', () => {
    const map = stubMap({
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-74.2, 40.0],
              [-74.19, 40.0],
            ],
          },
          properties: { class: 'path' },
        },
      ],
    })
    expect(findNearestTrailCandidate(map, { lat: 40.0, lng: -73.5, radiusMeters: 5 })).toBeNull()
  })

  it('returns null when style is not loaded (safe fallback)', () => {
    const map = stubMap({
      styleLoaded: false,
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[-74.01, 40.0], [-74.0, 40.0]] },
          properties: { class: 'path' },
        },
      ],
    })
    expect(findNearestTrailCandidate(map, { lat: 40.0, lng: -74.005, radiusMeters: MAX_SNAP_RADIUS_M })).toBeNull()
  })

  it('invalid geometry: rejects non-LineString', () => {
    const map = stubMap({
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [-74.02, 40.0],
                [-74.0, 40.0],
              ],
            ],
          },
          properties: { class: 'path' },
        },
      ],
    })
    expect(findNearestTrailCandidate(map, { lat: 40.0, lng: -74.01, radiusMeters: MAX_SNAP_RADIUS_M })).toBeNull()
  })

  it('invalid geometry: rejects empty LineString', () => {
    const map = stubMap({
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[-74.0, 40.0]] },
          properties: { class: 'path' },
        },
      ],
    })
    expect(findNearestTrailCandidate(map, { lat: 40.0, lng: -74.0, radiusMeters: MAX_SNAP_RADIUS_M })).toBeNull()
  })

  it('ignores non-whitelisted classes', () => {
    const map = stubMap({
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[-74.01, 40.0], [-74.0, 40.0]] },
          properties: { class: 'motorway' },
        },
      ],
    })
    expect(findNearestTrailCandidate(map, { lat: 40.0, lng: -74.005, radiusMeters: MAX_SNAP_RADIUS_M })).toBeNull()
  })

  it('nearest segment selection on whitelisted trail', () => {
    const map = stubMap({
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-74.02, 40.0],
              [-74.0, 40.0],
            ],
          },
          properties: { class: 'footway' },
        },
      ],
    })
    const c = findNearestTrailCandidate(map, { lat: 40.0, lng: -74.01, radiusMeters: MAX_SNAP_RADIUS_M })
    expect(c).not.toBeNull()
    expect(c!.sourceClass).toBe('footway')
    expect(c!.distanceMeters).toBeLessThan(MAX_SNAP_RADIUS_M)
    expect(Number.isFinite(c!.snappedLat) && Number.isFinite(c!.snappedLng)).toBe(true)
  })

  it('deterministic output: identical queries yield identical candidates', () => {
    const features: StubFeature[] = [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-118.3, 34.05],
            [-118.28, 34.05],
          ],
        },
        properties: { class: 'track' },
      },
    ]
    const map = stubMap({ features })
    const opts = { lat: 34.05, lng: -118.29, radiusMeters: MAX_SNAP_RADIUS_M }
    const a = findNearestTrailCandidate(map, opts)
    const b = findNearestTrailCandidate(map, opts)
    expect(a).toEqual(b)
  })
})

describe('isSnapAvailable (capability gate)', () => {
  it('is false for null / undefined map', () => {
    expect(isSnapAvailable(null)).toBe(false)
    expect(isSnapAvailable(undefined)).toBe(false)
  })

  it('is true when style spec is parsed even if isStyleLoaded() returns false (tiles still loading)', () => {
    // Real-world iOS / mobile: `isStyleLoaded()` flickers false during pan/zoom.
    // Capability must depend on the parsed style spec, not tile readiness.
    const map = stubMap({ styleLoaded: false })
    expect(isSnapAvailable(map)).toBe(true)
  })

  it('is false when getStyle() returns null/undefined (pre-load)', () => {
    const map = stubMap({ getStyle: () => null })
    expect(isSnapAvailable(map)).toBe(false)
    const map2 = stubMap({ getStyle: () => undefined })
    expect(isSnapAvailable(map2)).toBe(false)
  })

  it('is false when getStyle() throws (style transition in flight)', () => {
    const map = stubMap({
      getStyle: () => {
        throw new Error('style transition')
      },
    })
    expect(isSnapAvailable(map)).toBe(false)
  })

  it('is false below MIN_SNAP_ZOOM', () => {
    const map = stubMap({ getZoom: () => MIN_SNAP_ZOOM - 0.5 })
    expect(isSnapAvailable(map)).toBe(false)
  })

  it('is true at exactly MIN_SNAP_ZOOM (threshold crossing)', () => {
    const map = stubMap({ getZoom: () => MIN_SNAP_ZOOM })
    expect(isSnapAvailable(map)).toBe(true)
  })

  it('is false for raster-only style (emergency / satellite fallback)', () => {
    const map = stubMap({ getStyle: () => rasterOnlyStyle() })
    expect(isSnapAvailable(map)).toBe(false)
  })

  it('is false when style has no qualifying line layers', () => {
    const map = stubMap({
      getStyle: () => ({ version: 8, sources: {}, layers: [] }),
    })
    expect(isSnapAvailable(map)).toBe(false)
  })

  it('is false for malformed style (layers not an array)', () => {
    const map = stubMap({ getStyle: () => malformedStyle() })
    expect(isSnapAvailable(map)).toBe(false)
  })

  it('is idempotent across repeat calls (no internal state mutation that flips result)', () => {
    const map = stubMap({})
    const a = isSnapAvailable(map)
    const b = isSnapAvailable(map)
    const c = isSnapAvailable(map)
    expect([a, b, c]).toEqual([true, true, true])
  })

  it('recovers true after a transient style-transition failure', () => {
    let callCount = 0
    const map = stubMap({
      getStyle: () => {
        callCount += 1
        if (callCount === 1) throw new Error('mid-transition')
        return vectorTrailStyle()
      },
    })
    expect(isSnapAvailable(map)).toBe(false)
    expect(isSnapAvailable(map)).toBe(true)
  })

  it('is true for realistic transportation line layer (id includes path/trail)', () => {
    const map = stubMap({})
    expect(isSnapAvailable(map)).toBe(true)
  })

  it('is true when source-layer is transportation_name (relaxed match)', () => {
    const map = stubMap({ getStyle: () => relaxedTransportationNameStyle() })
    expect(isSnapAvailable(map)).toBe(true)
  })

  it('is false when only matching layer is over a raster source', () => {
    const map = stubMap({
      getStyle: () => ({
        version: 8,
        name: 'mixed',
        sources: { rastersrc: { type: 'raster' } },
        layers: [
          {
            id: 'fake_path',
            type: 'line',
            source: 'rastersrc',
            'source-layer': 'transportation',
          },
        ],
      }),
    })
    expect(isSnapAvailable(map)).toBe(false)
  })

  it('is false when matching layer has visibility: none', () => {
    const map = stubMap({
      getStyle: () => ({
        version: 8,
        name: 'hidden',
        sources: { openmaptiles: { type: 'vector' } },
        layers: [
          {
            id: 'road_path',
            type: 'line',
            source: 'openmaptiles',
            'source-layer': 'transportation',
            layout: { visibility: 'none' },
          },
        ],
      }),
    })
    expect(isSnapAvailable(map)).toBe(false)
  })
})

describe('probeStyleForTrailLayers (__probeStyleForTrailLayersForTests)', () => {
  it('records style id, source-layer mismatch, and id mismatch for non-trail vector lines', () => {
    const map = stubMap({
      getStyle: () => ({
        version: 8 as const,
        id: 'probe-test-style',
        name: 'Probe',
        sources: { openmaptiles: { type: 'vector' } },
        layers: [
          {
            id: 'water_outline',
            type: 'line',
            source: 'openmaptiles',
            'source-layer': 'waterway',
          },
        ],
      }),
    })
    const p = __probeStyleForTrailLayersForTests(map)
    expect(p.styleId).toBe('probe-test-style')
    expect(p.lineLayerCount).toBe(1)
    expect(p.rejectedSourceLayerMismatch).toBe(1)
    expect(p.rejectedIdMismatch).toBe(1)
    expect(p.matchedTransportationSourceLayers).toBe(0)
    expect(p.matchedTrailIdLayers).toBe(0)
  })

  it('does not increment mismatch counters for layers rejected as hidden or raster-backed', () => {
    const map = stubMap({
      getStyle: () => ({
        version: 8,
        sources: { omv: { type: 'vector' }, sat: { type: 'raster' } },
        layers: [
          {
            id: 'trail_fake',
            type: 'line',
            source: 'omv',
            'source-layer': 'transportation',
            layout: { visibility: 'none' },
          },
          {
            id: 'bogus_path',
            type: 'line',
            source: 'sat',
            'source-layer': 'transportation',
          },
        ],
      }),
    })
    const p = __probeStyleForTrailLayersForTests(map)
    expect(p.lineLayerCount).toBe(2)
    expect(p.rejectedHidden).toBe(1)
    expect(p.rejectedRasterBacked).toBe(1)
    expect(p.rejectedSourceLayerMismatch).toBe(0)
    expect(p.rejectedIdMismatch).toBe(0)
  })

  it('matches trail id hint without transportation source-layer (id-only path)', () => {
    const map = stubMap({
      getStyle: () => ({
        version: 8,
        sources: { openmaptiles: { type: 'vector' } },
        layers: [
          {
            id: 'trail_primary',
            type: 'line',
            source: 'openmaptiles',
            'source-layer': 'park',
          },
        ],
      }),
    })
    const p = __probeStyleForTrailLayersForTests(map)
    expect(p.matchedTrailIdLayers).toBe(1)
    expect(p.rejectedSourceLayerMismatch).toBe(1)
    expect(p.rejectedIdMismatch).toBe(0)
    expect(isSnapAvailable(map)).toBe(true)
  })
})

describe('createTrailSnapPreviewGate (preview idempotency)', () => {
  it('repeated lock/unlock cycles do not leave stale lock (no duplicate placement window)', () => {
    const g = createTrailSnapPreviewGate()
    for (let i = 0; i < 8; i++) {
      expect(g.tryLock()).toBe(true)
      expect(g.tryLock()).toBe(false)
      expect(g.isLocked()).toBe(true)
      g.unlock()
      expect(g.isLocked()).toBe(false)
    }
    expect(g.tryLock()).toBe(true)
  })
})
