import { describe, expect, it } from 'vitest'
import type { LayerType } from '../types'
import { FALLBACK_MAP_STYLE, MAP_STYLES } from './mapStyles'

const ALL_LAYERS: LayerType[] = ['streets', 'satellite', 'topo', 'outdoor']

describe('MAP_STYLES (map regression guard)', () => {
  it('defines exactly one style per LayerType', () => {
    const keys = Object.keys(MAP_STYLES).sort() as LayerType[]
    expect(keys.sort()).toEqual([...ALL_LAYERS].sort())
  })

  it.each(ALL_LAYERS)('%s is raster v8 with tiles', (layer) => {
    const spec = MAP_STYLES[layer]
    expect(spec.version).toBe(8)
    expect(spec.sources && typeof spec.sources === 'object').toBe(true)
    const sources = spec.sources as Record<string, { type?: string; tiles?: string[] }>
    const first = Object.values(sources)[0]
    expect(first?.type).toBe('raster')
    expect(first?.tiles?.length).toBeGreaterThan(0)
    expect(first?.tiles?.every((u) => u.includes('{z}'))).toBe(true)
    expect(spec.layers?.length).toBeGreaterThan(0)
  })

  it('fallback is distinct OSM raster (avoid error-handler loops)', () => {
    const fb = FALLBACK_MAP_STYLE.sources as Record<string, { tiles?: string[] }>
    expect(Object.keys(fb)[0]).toBe('osm-fallback')
    expect(fb['osm-fallback']?.tiles?.[0]).toContain('openstreetmap.org')
  })
})
