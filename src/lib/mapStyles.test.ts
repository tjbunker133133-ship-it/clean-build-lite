import type { LayerType } from '../types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FALLBACK_MAP_STYLE,
  MAP_STYLES,
  getMapTilerRasterFallbackStyle,
  getStyleUrl,
  mapStyleFingerprint,
  mapTilerRasterFallbackFingerprint,
  maptilerTerrainRgbTileJson,
  preferRasterBasemapOnAppleWebKit,
  resolveBasemapStyle,
  validatedEmergencyFallbackStyle,
} from './mapStyles'
import { __resetDeviceProfileForTests, refreshDeviceProfile } from '../runtime/deviceProfile'

const ALL_LAYERS: LayerType[] = ['streets', 'satellite', 'topo', 'outdoor']

describe('MAP_STYLES (hard-locked registry)', () => {
  it('MAP_STYLES has one MapTiler style.json per layer key', () => {
    for (const layer of ALL_LAYERS) {
      const url = MAP_STYLES[layer]
      expect(url).toContain('api.maptiler.com')
      expect(url).toContain('style.json')
      expect(url).toContain('key=')
    }
  })

  it('each layer resolves to a distinct URL', () => {
    const urls = ALL_LAYERS.map((layer) => getStyleUrl(layer))
    expect(new Set(urls).size).toBe(ALL_LAYERS.length)
  })

  it('terrain-rgb TileJSON includes a MapTiler key query param', () => {
    const terrain = maptilerTerrainRgbTileJson()
    expect(terrain).toContain('terrain-rgb')
    expect(terrain).toMatch(/[?&]key=[^&]+/)
  })

  it('getStyleUrl matches MAP_STYLES entries', () => {
    expect(getStyleUrl('streets')).toBe(MAP_STYLES.streets)
    expect(getStyleUrl('satellite')).toBe(MAP_STYLES.satellite)
  })

  it('mapStyleFingerprint differs between two presets', () => {
    expect(mapStyleFingerprint(getStyleUrl('streets'))).not.toBe(mapStyleFingerprint(getStyleUrl('outdoor')))
  })

  it('emergency fallback is v8 OSM raster', () => {
    const fb = validatedEmergencyFallbackStyle()
    expect(fb).not.toBeNull()
    expect(fb!.version).toBe(8)
    expect(fb).toEqual(FALLBACK_MAP_STYLE)
  })

  it('MapTiler raster fallback differs per layer and from vector URLs', () => {
    for (const layer of ALL_LAYERS) {
      const fp = mapTilerRasterFallbackFingerprint(layer)
      expect(fp).toBeTruthy()
      expect(fp).not.toBe(mapStyleFingerprint(getStyleUrl(layer)))
      const style = getMapTilerRasterFallbackStyle(layer)
      expect(style?.sources).toBeTruthy()
      const src = Object.values(style!.sources)[0] as { tiles?: string[] }
      expect(src.tiles?.[0]).toContain('api.maptiler.com')
    }
    const fps = ALL_LAYERS.map((layer) => mapTilerRasterFallbackFingerprint(layer))
    expect(new Set(fps).size).toBe(ALL_LAYERS.length)
  })
})

describe('resolveBasemapStyle (Apple WebKit)', () => {
  afterEach(() => {
    __resetDeviceProfileForTests()
    vi.unstubAllGlobals()
  })

  it('prefers MapTiler raster on iPhone', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
    })
    vi.stubGlobal('window', {
      innerWidth: 390,
      innerHeight: 844,
      matchMedia: () => ({ matches: false, addEventListener: undefined }),
    })
    refreshDeviceProfile()
    expect(preferRasterBasemapOnAppleWebKit()).toBe(true)
    const topo = resolveBasemapStyle('topo')
    expect(topo.delivery).toBe('maptiler-raster')
    expect(mapStyleFingerprint(topo.style)).toContain('maptiler-raster-topo')
    const streets = resolveBasemapStyle('streets')
    expect(streets.delivery).toBe('maptiler-raster')
    expect(mapStyleFingerprint(streets.style)).not.toBe(mapStyleFingerprint(topo.style))
  })

  it('uses vector style URLs on desktop Chrome', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      maxTouchPoints: 0,
    })
    vi.stubGlobal('window', {
      innerWidth: 1280,
      innerHeight: 800,
      matchMedia: () => ({ matches: false, addEventListener: undefined }),
    })
    refreshDeviceProfile()
    const resolved = resolveBasemapStyle('satellite')
    expect(preferRasterBasemapOnAppleWebKit()).toBe(false)
    expect(resolved.delivery).toBe('vector')
    expect(resolved.style).toBe(MAP_STYLES.satellite)
  })
})
