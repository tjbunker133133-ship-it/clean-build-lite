import { describe, expect, it } from 'vitest'
import { ENVIRONMENTAL_OVERLAY_CATALOG, overlayDef } from './catalog'
import { bboxIntersects } from './overlayCache'
import { clampBbox, estimateOverpassLoadingBudgetMs, overpassQuery } from './overpass'
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

  it('forest raster uses ArcGIS export tiles (WMSServer 400 on MapLibre bbox)', () => {
    const urls = rasterTileUrls('forest_usfs')
    expect(urls?.[0]).toContain('/export?')
    expect(urls?.[0]).toContain('bbox={bbox-epsg-3857}')
  })

  it('public lands raster uses live BLM SMA export (LandCAD retired)', () => {
    const urls = rasterTileUrls('public_lands')
    expect(urls?.[0]).toContain('BLM_Natl_SMA_Cached_without_PriUnk')
    expect(urls?.[0]).toContain('layers=show:1')
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

  it('overpass loading budget covers first queued fetch', () => {
    expect(estimateOverpassLoadingBudgetMs(0)).toBeGreaterThanOrEqual(74_000)
    expect(estimateOverpassLoadingBudgetMs(4)).toBeGreaterThan(estimateOverpassLoadingBudgetMs(0))
  })

  it('toggle persistence round-trip', () => {
    const t = setOverlayToggle(defaultOverlayToggles(), 'mines', true)
    expect(t.mines).toBe(true)
    expect(loadOverlayToggles().mines).toBe(false)
    expect(overlayDef('hiking_trails').offlineCacheable).toBe(true)
  })
})
