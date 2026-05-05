import type { LayerType } from '../types'

export const MAP_STYLES: Record<LayerType, object> = {
  streets: {
    version: 8,
    sources: {
      'osm-tiles': {
        type: 'raster',
        tiles: [
          'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        maxzoom: 19
      }
    },
    layers: [
      {
        id: 'osm-tiles',
        type: 'raster',
        source: 'osm-tiles',
        minzoom: 0,
        maxzoom: 22
      }
    ]
  },

  satellite: {
    version: 8,
    sources: {
      'satellite-tiles': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        ],
        tileSize: 256,
        attribution: 'Esri, Maxar, GeoEye, Earthstar Geographics',
        maxzoom: 19
      }
    },
    layers: [
      {
        id: 'satellite-tiles',
        type: 'raster',
        source: 'satellite-tiles',
        minzoom: 0,
        maxzoom: 22
      }
    ]
  },

  topo: {
    version: 8,
    sources: {
      'topo-tiles': {
        type: 'raster',
        tiles: [
          'https://tile.opentopomap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '© OpenTopoMap contributors',
        maxzoom: 17
      }
    },
    layers: [
      {
        id: 'topo-tiles',
        type: 'raster',
        source: 'topo-tiles',
        minzoom: 0,
        maxzoom: 22
      }
    ]
  }
}

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
