import { describe, expect, it } from 'vitest'
import type { LayerType } from '../types'
import {
  FALLBACK_MAP_STYLE,
  MAP_STYLES,
  getMapTilerRasterFallbackStyle,
  getStyleUrl,
  mapStyleFingerprint,
  mapTilerRasterFallbackFingerprint,
  maptilerTerrainRgbTileJson,
  validatedEmergencyFallbackStyle,
} from './mapStyles'

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
