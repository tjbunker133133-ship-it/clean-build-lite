import type { EnvironmentalOverlayDef, EnvironmentalOverlayId } from './types'

/** Situational overlays — drawn above basemap, below route/waypoints. Does not change basemap presets. */
export const ENVIRONMENTAL_OVERLAY_CATALOG: EnvironmentalOverlayDef[] = [
  {
    id: 'fire_firms',
    label: 'Active fire (24h)',
    hint: 'NASA FIRMS hotspots · needs free MAP_KEY',
    delivery: 'raster-wms',
    onlinePreferred: true,
    offlineCacheable: false,
    attribution: 'NASA FIRMS',
    signupUrl: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/',
    envKey: 'VITE_FIRMS_MAP_KEY',
    minZoom: 4,
  },
  {
    id: 'relief_usgs',
    label: 'Shaded relief',
    hint: 'USGS terrain shading (planning aid)',
    delivery: 'raster-wms',
    onlinePreferred: true,
    offlineCacheable: false,
    attribution: 'USGS The National Map',
    minZoom: 6,
    maxZoom: 15,
  },
  {
    id: 'forest_usfs',
    label: 'National forest',
    hint: 'USFS forest system boundaries',
    delivery: 'raster-wms',
    onlinePreferred: true,
    offlineCacheable: false,
    attribution: 'USDA USFS',
    minZoom: 7,
  },
  {
    id: 'public_lands',
    label: 'Public / federal lands',
    hint: 'Federal land management outlines',
    delivery: 'raster-wms',
    onlinePreferred: true,
    offlineCacheable: false,
    attribution: 'USGS / federal GIS',
    minZoom: 7,
  },
  {
    id: 'bike_paths',
    label: 'Bike paths',
    hint: 'OSM cycleways in view · cached when offline',
    delivery: 'geojson-overpass',
    onlinePreferred: false,
    offlineCacheable: true,
    attribution: 'OpenStreetMap contributors',
    minZoom: 8,  // REDUCED from 10: bike paths are often long corridors visible at lower zoom
  },
  {
    id: 'abandoned_rail',
    label: 'Abandoned railways',
    hint: 'Disused rail corridors · cached when offline',
    delivery: 'geojson-overpass',
    onlinePreferred: false,
    offlineCacheable: true,
    attribution: 'OpenStreetMap contributors',
    minZoom: 7,  // REDUCED from 9: rail corridors are long-range linear features
  },
  {
    id: 'mines',
    label: 'Mines & shafts',
    hint: 'Historic / abandoned mine features · cached when offline',
    delivery: 'geojson-overpass',
    onlinePreferred: false,
    offlineCacheable: true,
    attribution: 'OpenStreetMap contributors',
    minZoom: 8,  // REDUCED from 10: mine sites are often large areas
  },
  {
    id: 'hiking_trails',
    label: 'Hiking paths (OSM)',
    hint: 'Foot/hiking paths not in vector basemap · cached when offline',
    delivery: 'geojson-overpass',
    onlinePreferred: false,
    offlineCacheable: true,
    attribution: 'OpenStreetMap contributors',
    minZoom: 9,  // REDUCED from 11: major trail systems visible at moderate zoom
  },
  {
    id: 'camping',
    label: 'Camping areas',
    hint: 'Campgrounds & dispersed camping zones · cached when offline',
    delivery: 'geojson-overpass',
    onlinePreferred: false,
    offlineCacheable: true,
    attribution: 'OpenStreetMap contributors',
    minZoom: 8,  // REDUCED from 9: large campgrounds visible at moderate zoom
  },
]

export const ENVIRONMENTAL_OVERLAY_IDS: EnvironmentalOverlayId[] = ENVIRONMENTAL_OVERLAY_CATALOG.map(
  (d) => d.id,
)

export function overlayDef(id: EnvironmentalOverlayId): EnvironmentalOverlayDef {
  const d = ENVIRONMENTAL_OVERLAY_CATALOG.find((x) => x.id === id)
  if (!d) throw new Error(`unknown overlay: ${id}`)
  return d
}

export function isEnvironmentalOverlayId(raw: string): raw is EnvironmentalOverlayId {
  return (ENVIRONMENTAL_OVERLAY_IDS as string[]).includes(raw)
}
