import type { GeoJSONSource, Map } from 'maplibre-gl'
import { traceOverlay } from '../../runtime/runtimeForensics'
import { logWarn } from '../../runtime/logger'
import { overlayDef } from './catalog'
import { readCachedOverlayGeo } from './overlayCache'
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

/** True when HUD overlay layers are already attached (skip redundant re-sync). */
export function environmentalOverlayOnMap(map: Map, id: EnvironmentalOverlayId): boolean {
  if (!mapStyleMutable(map)) return false
  try {
    if (id === 'camping') {
      const base = envLayerId(id)
      return (
        map.getLayer(`${base}-points`) != null ||
        map.getLayer(`${base}-polygons-fill`) != null ||
        map.getLayer(`${base}-polygons-outline`) != null
      )
    }
    return map.getLayer(envLayerId(id)) != null
  } catch {
    return false
  }
}

/** Style object exists — safe to add HUD overlay sources (do not gate on tile load). */
export function mapStyleMutable(map: Map): boolean {
  try {
    return map.getStyle() != null
  } catch {
    return false
  }
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

  // Camping overlay has multiple layers: points, polygon fill, polygon outline
  if (id === 'camping') {
    const pointLayerId = `${layerId}-points`
    const polygonFillLayerId = `${layerId}-polygons-fill`
    const polygonOutlineLayerId = `${layerId}-polygons-outline`
    try {
      if (map.getLayer(pointLayerId)) map.removeLayer(pointLayerId)
    } catch {
      /* ignore */
    }
    try {
      if (map.getLayer(polygonFillLayerId)) map.removeLayer(polygonFillLayerId)
    } catch {
      /* ignore */
    }
    try {
      if (map.getLayer(polygonOutlineLayerId)) map.removeLayer(polygonOutlineLayerId)
    } catch {
      /* ignore */
    }
    try {
      if (map.getSource(sourceId)) map.removeSource(sourceId)
    } catch {
      /* ignore */
    }
    return
  }

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
  traceOverlay('raster_apply_attempt', { overlayId: id })
  try {
    if (!mapStyleMutable(map)) {
      traceOverlay('raster_apply_fail', { overlayId: id, reason: 'style_not_mutable' })
      return false
    }
    const def = overlayDef(id)
    const tiles = rasterTileUrls(id)
    if (!tiles) {
      traceOverlay('raster_apply_fail', { overlayId: id, reason: 'no_tiles_configured' })
      return false
    }

    const sourceId = envSourceId(id)
    const layerId = envLayerId(id)
    const beforeId = findBeforeTacticalLayer(map)

    traceOverlay('geojson_layer_check', { overlayId: id, sourceId, layerId, beforeId, sourceExists: map.getSource(sourceId) != null })

    if (!map.getSource(sourceId)) {
      traceOverlay('geojson_source_added', { overlayId: id, sourceId })
      map.addSource(sourceId, {
        type: 'raster',
        tiles,
        tileSize: 256,
        scheme: 'xyz',
      })
    } else {
      traceOverlay('geojson_source_exists', { overlayId: id, sourceId })
    }

    if (!map.getLayer(layerId)) {
      traceOverlay('geojson_layer_added', { overlayId: id, layerId, sourceId })
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
    } else {
      traceOverlay('geojson_layer_exists', { overlayId: id, layerId })
    }

    // Verify attachment actually succeeded
    const verifySource = map.getSource(sourceId)
    const verifyLayer = map.getLayer(layerId)
    traceOverlay('source_attach_verified', { overlayId: id, sourceId, attached: verifySource != null })
    traceOverlay('layer_attach_verified', { overlayId: id, layerId, attached: verifyLayer != null })

    const success = verifySource != null && verifyLayer != null
    traceOverlay(success ? 'raster_apply_success' : 'raster_apply_fail', { overlayId: id, sourceAttached: verifySource != null, layerAttached: verifyLayer != null })
    return success
  } catch (err) {
    traceOverlay('raster_apply_fail', { overlayId: id, reason: 'threw', error: (err as Error).message })
    return false
  }
}

export function applyGeojsonOverlay(
  map: Map,
  id: EnvironmentalOverlayId,
  geojson: GeoJSON.FeatureCollection,
): boolean {
  traceOverlay('geojson_apply_attempt', { overlayId: id, featureCount: geojson.features.length })
  try {
    if (!mapStyleMutable(map)) {
      traceOverlay('raster_apply_fail', { overlayId: id, reason: 'style_not_mutable' })
      return false
    }
    const def = overlayDef(id)
    const sourceId = envSourceId(id)
    const beforeId = findBeforeTacticalLayer(map)

    traceOverlay('geojson_layer_check', { overlayId: id, sourceId, beforeId, styleMutable: true })

    const existing = map.getSource(sourceId) as GeoJSONSource | undefined
    if (existing) {
      traceOverlay('geojson_source_exists', { overlayId: id, sourceId })
      existing.setData(geojson)
      traceOverlay('geojson_data_updated', { overlayId: id, sourceId, featureCount: geojson.features.length })
    } else {
      traceOverlay('geojson_source_added', { overlayId: id, sourceId })
      map.addSource(sourceId, { type: 'geojson', data: geojson })
    }

    // Camping overlay: render points (campgrounds) + polygons (dispersed zones)
    if (id === 'camping') {
      const pointLayerId = `${envLayerId(id)}-points`
      const polygonFillLayerId = `${envLayerId(id)}-polygons-fill`
      const polygonOutlineLayerId = `${envLayerId(id)}-polygons-outline`

      traceOverlay('geojson_layer_check', { overlayId: id, pointLayerId, polygonFillLayerId, polygonOutlineLayerId })

      // Point markers for official campgrounds
      if (!map.getLayer(pointLayerId)) {
        traceOverlay('geojson_layer_added', { overlayId: id, layerId: pointLayerId, type: 'circle' })
        map.addLayer(
          {
            id: pointLayerId,
            type: 'circle',
            source: sourceId,
            filter: ['==', ['get', 'feature_type'], 'campground'],
            minzoom: def.minZoom ?? 0,
            paint: {
              'circle-radius': 8,
              'circle-color': '#7cb342',
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2,
              'circle-opacity': 0.9,
            },
          },
          beforeId,
        )
      } else {
        traceOverlay('geojson_layer_exists', { overlayId: id, layerId: pointLayerId })
      }

      // Polygon fill for dispersed camping zones
      if (!map.getLayer(polygonFillLayerId)) {
        traceOverlay('geojson_layer_added', { overlayId: id, layerId: polygonFillLayerId, type: 'fill' })
        map.addLayer(
          {
            id: polygonFillLayerId,
            type: 'fill',
            source: sourceId,
            filter: ['==', ['get', 'feature_type'], 'dispersed_zone'],
            minzoom: def.minZoom ?? 0,
            paint: {
              'fill-color': '#7cb342',
              'fill-opacity': 0.15,
            },
          },
          beforeId,
        )
      } else {
        traceOverlay('geojson_layer_exists', { overlayId: id, layerId: polygonFillLayerId })
      }

      // Polygon outline for dispersed camping zones
      if (!map.getLayer(polygonOutlineLayerId)) {
        traceOverlay('geojson_layer_added', { overlayId: id, layerId: polygonOutlineLayerId, type: 'line' })
        map.addLayer(
          {
            id: polygonOutlineLayerId,
            type: 'line',
            source: sourceId,
            filter: ['==', ['get', 'feature_type'], 'dispersed_zone'],
            minzoom: def.minZoom ?? 0,
            layout: { 'line-join': 'round' },
            paint: {
              'line-color': '#7cb342',
              'line-width': 2,
              'line-opacity': 0.6,
              'line-dasharray': [4, 2],
            },
          },
          beforeId,
        )
      } else {
        traceOverlay('geojson_layer_exists', { overlayId: id, layerId: polygonOutlineLayerId })
      }

      // Verify all camping layers attached
      const allAttached = map.getLayer(pointLayerId) && map.getLayer(polygonFillLayerId) && map.getLayer(polygonOutlineLayerId)
      traceOverlay(allAttached ? 'ready_committed' : 'error_committed', { overlayId: id, type: 'camping_multi', allAttached })
      return true
    }

    // Standard line overlay for other types
    const layerId = envLayerId(id)
    traceOverlay('geojson_layer_check', { overlayId: id, layerId, sourceId, type: 'line' })
    if (!map.getLayer(layerId)) {
      const lineColor =
        id === 'bike_paths'
          ? '#5ec8ff'
          : id === 'abandoned_rail'
            ? '#c9a227'
            : id === 'mines'
              ? '#ff6b87'
              : '#7dff8a'

      traceOverlay('geojson_layer_added', { overlayId: id, layerId, type: 'line' })
      map.addLayer(
        {
          id: layerId,
          type: 'line',
          source: sourceId,
          minzoom: def.minZoom ?? 0,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': lineColor,
            'line-width': id === 'hiking_trails' ? 2.8 : 3.2,
            'line-opacity': 0.92,
            ...(id === 'abandoned_rail' ? { 'line-dasharray': [2, 2] } : {}),
          },
        },
        beforeId,
      )
    } else {
      traceOverlay('geojson_layer_exists', { overlayId: id, layerId })
    }

    // Verify attachment succeeded
    const verifySource = map.getSource(sourceId)
    const verifyLayer = map.getLayer(layerId)
    traceOverlay('source_attach_verified', { overlayId: id, sourceId, attached: verifySource != null })
    traceOverlay('layer_attach_verified', { overlayId: id, layerId, attached: verifyLayer != null })

    // DEEP VERIFICATION: Check if features actually render (fire-and-forget, don't block)
    const success = verifySource != null && verifyLayer != null
    void verifyOverlayRendered(map, id).then(renderCheck => {
      // Log specific render failures
      if (verifySource && verifyLayer && renderCheck.renderCount === 0 && renderCheck.sourceFeatureCount > 0) {
        traceOverlay('attached_but_not_rendering', {
          overlayId: id,
          reason: 'features_in_source_not_in_render_buffer',
          issues: renderCheck.issues,
          suggestion: 'may_need_zoom_or_pan',
        })
      }

      traceOverlay(success ? 'ready_committed' : 'error_committed', {
        overlayId: id,
        success,
        sourceAttached: verifySource != null,
        layerAttached: verifyLayer != null,
        renderCount: renderCheck.renderCount,
        issues: renderCheck.issues,
      })
    })
    return success
  } catch (err) {
    traceOverlay('raster_apply_fail', { overlayId: id, reason: 'threw', error: (err as Error).message })
    return false
  }
}

/**
 * Re-attach overlay sources/layers after basemap setStyle without starting a new fetch session.
 * Returns true when layers are on-map (already present, raster applied, or cache restored).
 */
export function reattachEnvironmentalOverlay(map: Map, id: EnvironmentalOverlayId): boolean {
  if (environmentalOverlayOnMap(map, id)) return true
  const def = overlayDef(id)
  if (def.delivery === 'raster-wms') {
    const ok = applyRasterOverlay(map, id)
    traceOverlay(ok ? 'reattach_raster_success' : 'reattach_raster_fail', { overlayId: id })
    return ok
  }
  if (def.delivery === 'geojson-overpass' && def.offlineCacheable) {
    const bbox = mapBboxFromMap(map)
    const cached = readCachedOverlayGeo(id, bbox)
    if (cached && applyGeojsonOverlay(map, id, cached.geojson)) {
      traceOverlay('reattach_cache_success', {
        overlayId: id,
        featureCount: cached.geojson.features.length,
      })
      return true
    }
  }
  return false
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

/**
 * Check if overlay should be blocked by zoom level.
 *
 * SITUATIONAL vs DETAIL RENDER MODE:
 * - 'situational': Always allow (fires, USGS, boundaries, safety data)
 * - 'detail': Respect minZoom gate (trails, mines, POIs)
 */
export function overlayZoomBlocked(
  map: Map,
  id: EnvironmentalOverlayId,
): { blocked: boolean; message?: string; bypassedByRenderMode?: boolean } {
  const def = overlayDef(id)
  const renderMode = def.renderMode ?? 'detail' // Default to detail for backward compatibility

  // SITUATIONAL MODE: Always allow rendering regardless of zoom
  if (renderMode === 'situational') {
    const z = map.getZoom()
    traceOverlay('situational_zoom_bypass', {
      overlayId: id,
      currentZoom: z.toFixed(2),
      minZoom: def.minZoom ?? 0,
      renderMode,
    })
    return { blocked: false, bypassedByRenderMode: true }
  }

  // DETAIL MODE: Apply minZoom gate
  const minZ = def.minZoom ?? 0
  const z = map.getZoom()
  if (z + 0.05 < minZ) {
    traceOverlay('zoom_blocked_details', {
      overlayId: id,
      currentZoom: z.toFixed(2),
      requiredZoom: minZ,
      difference: (minZ - z).toFixed(2),
      renderMode,
      message: `Zoom in closer (map level ${minZ}+) to load ${def.label.toLowerCase()}.`
    })
    return {
      blocked: true,
      message: `Zoom in closer (map level ${minZ}+) to load ${def.label.toLowerCase()}.`,
    }
  }
  return { blocked: false }
}

/**
 * Verify overlay actually rendered visible features.
 * This queries the map to confirm features are in the render buffer.
 */
export async function verifyOverlayRendered(
  map: Map,
  id: EnvironmentalOverlayId,
): Promise<{
  sourceExists: boolean
  layerExists: boolean
  visible: boolean
  opacity: number
  renderCount: number
  sourceFeatureCount: number
  zoom: number
  minZoom: number
  issues: string[]
}> {
  const issues: string[] = []
  const sourceId = envSourceId(id)
  const layerId = envLayerId(id)
  const def = overlayDef(id)
  const zoom = map.getZoom()
  const minZoom = def.minZoom ?? 0

  // Check source
  const source = map.getSource(sourceId)
  const sourceExists = source != null

  // Check layer
  const layer = map.getLayer(layerId)
  const layerExists = layer != null

  // Check visibility
  let visible = false
  let opacity = 1
  try {
    if (layer) {
      // Check layer visibility property
      const layerVisibility = map.getLayoutProperty(layerId, 'visibility')
      visible = layerVisibility !== 'none'

      // Check opacity
      const opacityProp = layer.type === 'raster' ? 'raster-opacity' :
                          layer.type === 'line' ? 'line-opacity' :
                          layer.type === 'circle' ? 'circle-opacity' :
                          layer.type === 'fill' ? 'fill-opacity' : null
      if (opacityProp) {
        const opacityValue = map.getPaintProperty(layerId, opacityProp)
        opacity = typeof opacityValue === 'number' ? opacityValue : 1
        if (opacity === 0) {
          issues.push('layer_opacity_zero')
        }
      }

      if (!visible) {
        issues.push('layer_visibility_none')
      }
    }
  } catch (e) {
    issues.push(`visibility_check_error: ${(e as Error).message}`)
  }

  // Query rendered features
  let renderCount = 0
  try {
    if (layerExists && visible) {
      const rendered = map.queryRenderedFeatures({ layers: [layerId] })
      renderCount = rendered.length
      if (renderCount === 0) {
        issues.push('no_rendered_features_in_viewport')
      }
    }
  } catch (e) {
    issues.push(`query_error: ${(e as Error).message}`)
  }

  // Check source feature count for GeoJSON
  let sourceFeatureCount = 0
  if (source && 'getData' in source) {
    try {
      const data = (source as GeoJSONSource).getData()
      // Handle both Promise (async) and synchronous returns
      const resolvedData = data instanceof Promise ? await data : data
      if (resolvedData && typeof resolvedData === 'object' && 'features' in resolvedData) {
        sourceFeatureCount = (resolvedData as GeoJSON.FeatureCollection).features.length
        if (sourceFeatureCount === 0) {
          issues.push('source_empty_no_features')
        }
      }
    } catch (e) {
      issues.push(`source_data_error: ${(e as Error).message}`)
    }
  }

  // Zoom check
  if (zoom + 0.05 < minZoom) {
    issues.push(`zoom_too_low: ${zoom.toFixed(2)} < ${minZoom}`)
  }

  // Layer ordering check (is it below tactical layers?)
  const style = map.getStyle()
  if (style && 'layers' in style && Array.isArray(style.layers)) {
    const layerIds = style.layers.map(l => l.id)
    const tacticalLayerIds = ['tactical-route-layer', 'tactical-trail-route-layer']
    const tacticalIndex = tacticalLayerIds.findIndex(tid => layerIds.includes(tid))
    const layerIndex = layerIds.indexOf(layerId)

    if (tacticalIndex >= 0 && layerIndex >= 0 && layerIndex > tacticalIndex) {
      issues.push('layer_above_tactical_may_be_obscured')
    }
  }

  // Log detailed trace
  traceOverlay('render_verification', {
    overlayId: id,
    sourceExists,
    layerExists,
    visible,
    opacity,
    renderCount,
    sourceFeatureCount,
    zoom,
    minZoom,
    issues,
    renderSuccess: layerExists && visible && renderCount > 0,
  })

  if (layerExists && visible && renderCount === 0 && sourceFeatureCount > 0) {
    logWarn('OVERLAY', `Layer exists and visible but no features rendered: ${id}`, {
      zoom,
      minZoom,
      issues,
    })
  }

  return {
    sourceExists,
    layerExists,
    visible,
    opacity,
    renderCount,
    sourceFeatureCount,
    zoom,
    minZoom,
    issues,
  }
}
