import type { EnvironmentalOverlayId } from './types'

function readViteEnv(name: string): string {
  return (
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name] ?? ''
  ).trim()
}

/** Read any Vite environment variable by name. */
export function readEnvKey(name: string): string {
  return readViteEnv(name)
}

/** @deprecated Use readEnvKey('VITE_FIRMS_MAP_KEY') for new code. */
export function readFirmsMapKey(): string {
  return readEnvKey('VITE_FIRMS_MAP_KEY')
}

/** True when Vite inlined a FIRMS MAP_KEY at build time (production needs Vercel env + redeploy). */
export function firmsMapKeyConfigured(): boolean {
  return readFirmsMapKey().length > 0
}

/** WMS tile templates for MapLibre raster sources ({bbox-epsg-3857}). */
export function rasterTileUrls(id: EnvironmentalOverlayId): string[] | null {
  switch (id) {
    case 'fire_firms': {
      const key = readFirmsMapKey()
      if (!key) return null
      const layer = 'fires_viirs_noaa20_24'
      return [
        `https://firms.modaps.eosdis.nasa.gov/mapserver/wms/fires/${encodeURIComponent(key)}/?service=WMS&version=1.1.1&request=GetMap&srs=EPSG:3857&bbox={bbox-epsg-3857}&format=image/png&transparent=true&width=256&height=256&layers=${layer}`,
      ]
    }
    case 'relief_usgs':
      return [
        'https://basemap.nationalmap.gov/arcgis/services/USGSShadedReliefOnly/MapServer/WMSServer?service=WMS&version=1.1.1&request=GetMap&srs=EPSG:3857&bbox={bbox-epsg-3857}&format=image/png&transparent=true&width=256&height=256&layers=0',
      ]
    case 'forest_usfs':
      // ArcGIS export tiles — WMSServer returns 400 for MapLibre bbox template on this host.
      return [
        'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/export?f=image&format=png32&transparent=true&size=256,256&bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&layers=show:0',
      ]
    case 'public_lands':
      // BLM_Natl_LandCAD_WGS84 was retired (404). SMA Cached = federal surface managing agency.
      return [
        'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/export?f=image&format=png32&transparent=true&size=256,256&bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&layers=show:1',
      ]
    default:
      return null
  }
}

export function rasterPaint(id: EnvironmentalOverlayId): Record<string, number> {
  switch (id) {
    case 'relief_usgs':
      return { 'raster-opacity': 0.72 }
    case 'forest_usfs':
      return { 'raster-opacity': 0.58 }
    case 'public_lands':
      return { 'raster-opacity': 0.5 }
    case 'fire_firms':
      return { 'raster-opacity': 0.85 }
    default:
      return { 'raster-opacity': 0.55 }
  }
}
