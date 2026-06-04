import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OUTDOOR_TILE_CACHE_NAME,
  computeRouteFingerprint,
  getOutdoorCorridorTileTemplates,
  hasCorridorOutdoorCache,
  loadCorridorCacheRegion,
  prefetchCorridorTiles,
  saveCorridorCacheRegion,
  shouldRefreshCorridorPrefetch,
  type CorridorCacheRegion,
} from './corridorPrefetch'

describe('corridorPrefetch', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v)
      },
      removeItem: (k: string) => {
        storage.delete(k)
      },
      clear: () => storage.clear(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('re-prefetches when waypoint route fingerprint changes', () => {
    const region: CorridorCacheRegion = {
      bounds: { minLat: 40, maxLat: 41, minLng: -75, maxLng: -74 },
      centerLat: 40.5,
      centerLng: -74.5,
      updatedAt: Date.now(),
      layer: 'outdoor',
      routeFingerprint: computeRouteFingerprint([
        { lat: 40.1, lng: -74.9 },
        { lat: 40.2, lng: -74.8 },
      ]),
      tilesLoaded: 12,
    }
    const nextFp = computeRouteFingerprint([
      { lat: 40.1, lng: -74.9 },
      { lat: 40.2, lng: -74.8 },
      { lat: 40.3, lng: -74.7 },
    ])
    expect(shouldRefreshCorridorPrefetch(40.5, -74.5, region, nextFp)).toBe(true)
    expect(shouldRefreshCorridorPrefetch(40.5, -74.5, region, region.routeFingerprint)).toBe(
      false,
    )
  })

  it('outdoor tile templates use direct MapTiler XYZ (not style.json)', () => {
    const templates = getOutdoorCorridorTileTemplates()
    if (templates.length === 0) return
    expect(templates[0]).toContain('outdoor-v4/256/{z}/{x}/{y}.png')
    expect(templates[0]).not.toContain('style.json')
  })

  it('hasCorridorOutdoorCache requires tilesLoaded > 0', () => {
    const region: CorridorCacheRegion = {
      bounds: { minLat: 40, maxLat: 41, minLng: -75, maxLng: -74 },
      centerLat: 40.5,
      centerLng: -74.5,
      updatedAt: Date.now(),
      layer: 'outdoor',
      routeFingerprint: 'fp',
      tilesLoaded: 0,
    }
    saveCorridorCacheRegion(region)
    expect(hasCorridorOutdoorCache()).toBe(false)
    saveCorridorCacheRegion({ ...region, tilesLoaded: 8 })
    expect(hasCorridorOutdoorCache()).toBe(true)
    expect(loadCorridorCacheRegion()?.tilesLoaded).toBe(8)
  })

  it('prefetch uses Workbox-aligned cache bucket', async () => {
    expect(OUTDOOR_TILE_CACHE_NAME).toBe('maptiler-outdoor-tiles-v1')
    const templates = getOutdoorCorridorTileTemplates()
    if (templates.length === 0) return

    const put = vi.fn().mockResolvedValue(undefined)
    const legacyOpen = vi.fn().mockResolvedValue({ keys: vi.fn().mockResolvedValue([]) })
    const open = vi.fn().mockResolvedValue({ put })
    vi.stubGlobal('caches', {
      open: (name: string) => (name === 'hud-outdoor-tiles-v1' ? legacyOpen() : open(name)),
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        clone: vi.fn().mockReturnValue({}),
      }),
    )

    await prefetchCorridorTiles(templates, {
      minLat: 40,
      maxLat: 40.01,
      minLng: -75,
      maxLng: -74.99,
    }, { zoomLevels: [12], maxTiles: 1 })
    expect(open).toHaveBeenCalledWith('maptiler-outdoor-tiles-v1')
  })

  it('prefetchCorridorTiles stores successful responses in Cache Storage', async () => {
    const templates = getOutdoorCorridorTileTemplates()
    if (templates.length === 0) return

    const put = vi.fn().mockResolvedValue(undefined)
    const open = vi.fn().mockResolvedValue({ put })
    vi.stubGlobal('caches', { open })

    const clone = vi.fn().mockReturnValue({})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        clone,
      }),
    )

    const bounds = {
      minLat: 40.0,
      maxLat: 40.02,
      minLng: -75.0,
      maxLng: -74.98,
    }
    const loaded = await prefetchCorridorTiles(templates, bounds, {
      zoomLevels: [12],
      maxTiles: 4,
    })
    expect(loaded).toBeGreaterThan(0)
    expect(loaded).toBeLessThanOrEqual(4)
    expect(open).toHaveBeenCalled()
    expect(put).toHaveBeenCalled()
  })
})
