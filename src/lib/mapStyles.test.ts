import { describe, expect, it } from 'vitest'
import type { LayerType } from '../types'
import {
  FALLBACK_MAP_STYLE,
  MAP_STYLES,
  getStyleUrl,
  mapStyleFingerprint,
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

  it('terrain-rgb TileJSON uses the same key query as MAP_STYLES.topo', () => {
    const topoKey = new URL(MAP_STYLES.topo).searchParams.get('key')
    const terrain = maptilerTerrainRgbTileJson()
    expect(terrain).toContain('terrain-rgb')
    expect(terrain).toContain(`key=${topoKey}`)
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
})
