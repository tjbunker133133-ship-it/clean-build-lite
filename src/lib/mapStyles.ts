import type { StyleSpecification } from 'maplibre-gl'
import type { LayerType } from '../types'

/**
 * Canonical MapLibre styles for `LayerType`. MapCanvas must import from here only —
 * do not duplicate tile URLs or style JSON in components (prevents drift / blank maps).
 *
 * Guardrails: raster-only basemaps for predictable rendering; vector styles belong here
 * only after worker URL + offline story are validated.
 */
function rasterStyle(
  sourceId: string,
  tiles: string[],
  attribution: string,
  sourceMaxzoom = 19,
): StyleSpecification {
  return {
    version: 8,
    sources: {
      [sourceId]: {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution,
        maxzoom: sourceMaxzoom,
      },
    },
    layers: [
      {
        id: sourceId,
        type: 'raster',
        source: sourceId,
        minzoom: 0,
        maxzoom: 22,
      },
    ],
  }
}

/** Every `LayerType` must have an entry — TypeScript enforces the mapping. */
export const MAP_STYLES: Record<LayerType, StyleSpecification> = {
  /**
   * Road-forward basemap (distinct from `outdoor` / fallback OSM).
   * Carto Voyager raster — avoids duplicate tile stack vs outdoor-only OSM.
   */
  streets: rasterStyle(
    'carto-voyager',
    [
      'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    ],
    '© OpenStreetMap contributors © CARTO',
  ),
  satellite: rasterStyle(
    'satellite-tiles',
    [
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    'Tiles © Esri',
  ),
  topo: rasterStyle(
    'topo-tiles',
    ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
    '© OpenStreetMap contributors, © OpenTopoMap',
    17,
  ),
  /** Trail/outdoor-oriented — OSM raster until a dedicated outdoor style is wired */
  outdoor: rasterStyle(
    'outdoor-tiles',
    ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    '© OpenStreetMap contributors',
  ),
}

/** Used when tile errors fire — OSM only (not Carto) to avoid fail → same-style loops. */
export const FALLBACK_MAP_STYLE: StyleSpecification = rasterStyle(
  'osm-fallback',
  ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
  '© OpenStreetMap contributors',
)

export const WAYPOINT_COLORS: Record<string, string> = {
  default: '#00ffb4',
  camp: '#ffe033',
  water: '#33c4ff',
  danger: '#ff3b3b',
}

export const WAYPOINT_ICONS: Record<string, string> = {
  default: '◈',
  camp: '⛺',
  water: '💧',
  danger: '⚠',
}
