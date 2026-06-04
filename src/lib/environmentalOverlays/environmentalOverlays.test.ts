import { describe, expect, it } from 'vitest'
import { ENVIRONMENTAL_OVERLAY_CATALOG, overlayDef } from './catalog'
import { bboxIntersects } from './overlayCache'
import { clampBbox, overpassQuery } from './overpass'
import { defaultOverlayToggles, loadOverlayToggles, setOverlayToggle } from './overlayState'
import { rasterTileUrls, readFirmsMapKey } from './sources'

describe('environmentalOverlays', () => {
  it('catalog has unique ids', () => {
    const ids = ENVIRONMENTAL_OVERLAY_CATALOG.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('fire raster URLs depend on FIRMS map key (Vite bakes import.meta.env)', () => {
    const key = readFirmsMapKey()
    const urls = rasterTileUrls('fire_firms')
    if (key) {
      expect(urls?.[0]).toContain(encodeURIComponent(key))
    } else {
      expect(urls).toBeNull()
    }
  })

  it('free USGS relief tiles do not need a key', () => {
    expect(rasterTileUrls('relief_usgs')?.length).toBeGreaterThan(0)
  })

  it('overpass query shrinks huge bbox instead of failing', () => {
    const huge = { south: 0, west: 0, north: 1, east: 1 }
    const shrunk = clampBbox(huge)
    expect(shrunk).not.toBeNull()
    expect(shrunk!.north - shrunk!.south).toBeCloseTo(0.35, 5)
    expect(overpassQuery('bike_paths', huge)).toContain('cycleway')
    const small = { south: 39.5, west: -105.2, north: 39.7, east: -105.0 }
    expect(overpassQuery('bike_paths', small)).toContain('cycleway')
  })

  it('bbox intersects', () => {
    const a = { south: 39, west: -106, north: 40, east: -105 }
    const b = { south: 39.5, west: -105.5, north: 39.6, east: -105.4 }
    expect(bboxIntersects(a, b)).toBe(true)
    expect(bboxIntersects(a, { south: 50, west: -106, north: 51, east: -105 })).toBe(false)
  })

  it('toggle persistence round-trip', () => {
    const t = setOverlayToggle(defaultOverlayToggles(), 'mines', true)
    expect(t.mines).toBe(true)
    expect(loadOverlayToggles().mines).toBe(false)
    expect(overlayDef('hiking_trails').offlineCacheable).toBe(true)
  })
})
