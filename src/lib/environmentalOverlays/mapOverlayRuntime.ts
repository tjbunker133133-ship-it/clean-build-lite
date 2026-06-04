import type { GeoJSONSource, Map } from 'maplibre-gl'
import { overlayDef } from './catalog'
import { rasterPaint, rasterTileUrls } from './sources'
import type { EnvironmentalOverlayId } from './types'

const SOURCE_PREFIX = 'hud-env-src-'
const LAYER_PREFIX = 'hud-env-lyr-'

const TACTICAL_LAYER_IDS = ['tactical-route-layer', 'tactical-trail-route-layer']

export function envSourceId(id: EnvironmentalOverlayId): string {
  return `${SOURCE_PREFIX}${id}`
}

export function envLayerId(id: EnvironmentalOverlayId): string {
  return `${LAYER_PREFIX}${id}`
}

function findBeforeTacticalLayer(map: Map): string | undefined {
  for (const id of TACTICAL_LAYER_IDS) {
    if (map.getLayer(id)) return id
  }
  return undefined
}

export function removeEnvironmentalOverlay(map: Map, id: EnvironmentalOverlayId): void {
  const layerId = envLayerId(id)
  const sourceId = envSourceId(id)
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId)
  } catch {
    /* ignore */
  }
  try {
    if (map.getSource(sourceId)) map.removeSource(sourceId)
  } catch {
    /* ignore */
  }
}

export function applyRasterOverlay(map: Map, id: EnvironmentalOverlayId): boolean {
  const def = overlayDef(id)
  const tiles = rasterTileUrls(id)
  if (!tiles) return false

  const sourceId = envSourceId(id)
  const layerId = envLayerId(id)
  const beforeId = findBeforeTacticalLayer(map)

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: 'raster',
      tiles,
      tileSize: 256,
    })
  }

  if (!map.getLayer(layerId)) {
    map.addLayer(
      {
        id: layerId,
        type: 'raster',
        source: sourceId,
        minzoom: def.minZoom ?? 0,
        maxzoom: def.maxZoom ?? 22,
        paint: rasterPaint(id),
      },
      beforeId,
    )
  }
  return true
}

export function applyGeojsonOverlay(
  map: Map,
  id: EnvironmentalOverlayId,
  geojson: GeoJSON.FeatureCollection,
): void {
  const def = overlayDef(id)
  const sourceId = envSourceId(id)
  const layerId = envLayerId(id)
  const beforeId = findBeforeTacticalLayer(map)

  const existing = map.getSource(sourceId) as GeoJSONSource | undefined
  if (existing) {
    existing.setData(geojson)
  } else {
    map.addSource(sourceId, { type: 'geojson', data: geojson })
  }

  if (!map.getLayer(layerId)) {
    const lineColor =
      id === 'bike_paths'
        ? '#5ec8ff'
        : id === 'abandoned_rail'
          ? '#c9a227'
          : id === 'mines'
            ? '#ff6b87'
            : '#7dff8a'

    map.addLayer(
      {
        id: layerId,
        type: 'line',
        source: sourceId,
        minzoom: def.minZoom ?? 0,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': lineColor,
          'line-width': id === 'hiking_trails' ? 1.5 : 2,
          'line-opacity': 0.75,
          ...(id === 'abandoned_rail' ? { 'line-dasharray': [2, 2] } : {}),
        },
      },
      beforeId,
    )
  }
}

export function mapBboxFromMap(map: Map): import('./types').MapBbox {
  const b = map.getBounds()
  return {
    south: b.getSouth(),
    west: b.getWest(),
    north: b.getNorth(),
    east: b.getEast(),
  }
}
