export type EnvironmentalOverlayId =
  | 'fire_firms'
  | 'relief_usgs'
  | 'forest_usfs'
  | 'public_lands'
  | 'bike_paths'
  | 'abandoned_rail'
  | 'mines'
  | 'hiking_trails'

export type OverlayDelivery = 'raster-wms' | 'geojson-overpass'

export type EnvironmentalOverlayDef = {
  id: EnvironmentalOverlayId
  label: string
  hint: string
  delivery: OverlayDelivery
  /** Shown in panel when layer needs network tiles. */
  onlinePreferred: boolean
  /** GeoJSON overlays can show last cached fetch when offline. */
  offlineCacheable: boolean
  attribution: string
  signupUrl?: string
  envKey?: 'VITE_FIRMS_MAP_KEY'
  minZoom?: number
  maxZoom?: number
}

export type OverlayRuntimeStatus = {
  enabled: boolean
  loading: boolean
  error: string | null
  stale: boolean
  fromCache: boolean
}

export type MapBbox = {
  south: number
  west: number
  north: number
  east: number
}
