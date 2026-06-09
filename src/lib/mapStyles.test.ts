import type { LayerType } from '../types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FALLBACK_MAP_STYLE,
  MAP_STYLES,
  getMapTilerRasterDirectTilesStyle,
  getMapTilerRasterFallbackStyle,
  getStyleUrl,
  mapStyleFingerprint,
  mapTilerRasterFallbackFingerprint,
  maptilerRasterTileTemplates,
  maptilerTerrainRgbTileJson,
  maptilerBasemapsConfigured,
  getOpenFreeMapStyleUrl,
  isAppleWebKitMapSwitch,
  resolveBasemapStyle,
  resolveOpenFreeMapBasemapStyle,
  validatedEmergencyFallbackStyle,
} from './mapStyles'
import { __resetDeviceProfileForTests, refreshDeviceProfile } from '../runtime/deviceProfile'

const ALL_LAYERS: LayerType[] = ['streets', 'satellite', 'topo', 'outdoor']

/** MAP_STYLES URLs are baked at module load from import.meta.env (same as Vite build). */
const maptilerUrlsAtModuleLoad = MAP_STYLES.streets.length > 0

describe('MAP_STYLES (hard-locked registry)', () => {
  it('MAP_STYLES has one MapTiler style.json per layer key when key is baked at build', () => {
    if (!maptilerUrlsAtModuleLoad) return
    for (const layer of ALL_LAYERS) {
      const url = MAP_STYLES[layer]
      expect(url).toContain('api.maptiler.com')
      expect(url).toContain('style.json')
      expect(url).toContain('key=')
    }
  })

  it('each layer resolves to a distinct URL when MapTiler key is configured', () => {
    if (!maptilerBasemapsConfigured()) return
    const urls = ALL_LAYERS.map((layer) => getStyleUrl(layer))
    expect(new Set(urls).size).toBe(ALL_LAYERS.length)
  })

  it('terrain-rgb TileJSON includes a MapTiler key query param when key is present', () => {
    if (!maptilerBasemapsConfigured()) return
    const terrain = maptilerTerrainRgbTileJson()
    expect(terrain).toContain('terrain-rgb')
    expect(terrain).toMatch(/[?&]key=[^&]+/)
  })

  it('getStyleUrl matches MAP_STYLES entries', () => {
    expect(getStyleUrl('streets')).toBe(MAP_STYLES.streets)
    expect(getStyleUrl('satellite')).toBe(MAP_STYLES.satellite)
  })

  it('mapStyleFingerprint differs between two presets when MapTiler URLs are baked', () => {
    if (!maptilerUrlsAtModuleLoad) return
    expect(mapStyleFingerprint(getStyleUrl('streets'))).not.toBe(mapStyleFingerprint(getStyleUrl('outdoor')))
  })

  it('emergency fallback is v8 OSM raster', () => {
    const fb = validatedEmergencyFallbackStyle()
    expect(fb).not.toBeNull()
    expect(fb!.version).toBe(8)
    expect(fb).toEqual(FALLBACK_MAP_STYLE)
  })

  it('direct raster style uses inlined tiles (offline boot safe)', () => {
    const templates = maptilerRasterTileTemplates('outdoor')
    if (templates.length === 0) return
    const style = getMapTilerRasterDirectTilesStyle('outdoor')
    expect(style).not.toBeNull()
    const src = Object.values(style!.sources)[0] as { tiles?: string[]; url?: string }
    expect(src.tiles?.[0]).toContain('outdoor-v4/256/{z}/{x}/{y}.png')
    expect(src.url).toBeUndefined()
  })

  it('MapTiler raster fallback differs per layer and from vector URLs when key is present', () => {
    if (!maptilerBasemapsConfigured()) return
    for (const layer of ALL_LAYERS) {
      const fp = mapTilerRasterFallbackFingerprint(layer)
      expect(fp).toBeTruthy()
      expect(fp).not.toBe(mapStyleFingerprint(getStyleUrl(layer)))
      const style = getMapTilerRasterFallbackStyle(layer)
      expect(style?.sources).toBeTruthy()
      const src = Object.values(style!.sources)[0] as { url?: string }
      expect(src.url).toContain('api.maptiler.com')
      expect(src.url).toContain('/256/tiles.json')
    }
    const fps = ALL_LAYERS.map((layer) => mapTilerRasterFallbackFingerprint(layer))
    expect(new Set(fps).size).toBe(ALL_LAYERS.length)
  })
})

describe('resolveBasemapStyle', () => {
  afterEach(() => {
    __resetDeviceProfileForTests()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('uses vector style URLs on iPhone (same path as Android/desktop)', () => {
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
    expect(isAppleWebKitMapSwitch()).toBe(true)
    const topo = resolveBasemapStyle('topo')
    expect(topo.delivery).toBe('vector')
    if (maptilerUrlsAtModuleLoad) {
      expect(topo.style).toBe(MAP_STYLES.topo)
      const streets = resolveBasemapStyle('streets')
      expect(streets.style).toBe(MAP_STYLES.streets)
    } else {
      expect(String(topo.style)).toContain('openfreemap.org')
    }
  })

  it('MapTiler raster fallback uses TileJSON per layer when key is present', () => {
    if (!maptilerBasemapsConfigured()) return
    const topo = getMapTilerRasterFallbackStyle('topo')
    const satellite = getMapTilerRasterFallbackStyle('satellite')
    expect(topo?.sources).toBeTruthy()
    const topoSrc = Object.values(topo!.sources)[0] as { url?: string }
    expect(topoSrc.url).toContain('topo-v4/256/tiles.json')
    const satSrc = Object.values(satellite!.sources)[0] as { url?: string }
    expect(satSrc.url).toContain('hybrid-v4/256/tiles.json')
    expect(mapTilerRasterFallbackFingerprint('topo')).not.toBe(
      mapTilerRasterFallbackFingerprint('satellite'),
    )
  })

  it('without MapTiler key uses OpenFreeMap vector for streets/topo/outdoor', () => {
    vi.stubEnv('VITE_MAPTILER_KEY', '')
    expect(getOpenFreeMapStyleUrl('streets')).toContain('openfreemap.org')
    expect(getOpenFreeMapStyleUrl('satellite')).toBeNull()
    const streets = resolveBasemapStyle('streets')
    expect(streets.delivery).toBe('vector')
    expect(streets.style).toBe('https://tiles.openfreemap.org/styles/liberty')
    const outdoor = resolveBasemapStyle('outdoor')
    expect(outdoor.style).toBe('https://tiles.openfreemap.org/styles/liberty')
    const satellite = resolveBasemapStyle('satellite')
    expect(satellite.delivery).toBe('maptiler-raster')
    expect(satellite.style).toEqual(FALLBACK_MAP_STYLE)
  })

  it('resolveOpenFreeMapBasemapStyle returns vector delivery', () => {
    const ofm = resolveOpenFreeMapBasemapStyle('topo')
    expect(ofm?.delivery).toBe('vector')
    expect(ofm?.style).toContain('positron')
  })
})
