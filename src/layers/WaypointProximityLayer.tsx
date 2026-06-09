/**
 * WaypointProximityLayer — Modern Layer Only
 *
 * Adds ambient proximity rings to the MapLibre map for the nearest
 * pending/active waypoint. Rings are rendered as MapLibre circle layers,
 * not DOM overlays — GPU-native, no layout cost.
 *
 * Visual behavior:
 *   - 300m ring: barely visible (opacity 0.06) — ambient awareness
 *   - 80m ring:  soft (opacity 0.14) — approaching
 *   - 25m ring:  visible (opacity 0.25) — arriving
 *
 * Performance contract:
 *   - Only one GeoJSON source (single point — the nearest target)
 *   - Source updated only when nearest waypoint changes (not every GPS tick)
 *   - Self-disables when no waypoints exist
 *   - Self-disables when mode !== 'immersive'
 *   - All layer opacity via MapLibre paint transitions (GPU)
 *   - Respects reduced-motion (static, no pulse)
 */

import { useEffect, useRef } from 'react'
import { useMapContext } from '../context/MapContext'
import { useHudPresentation } from '../context/HudPresentationContext'
import { usePanelData } from '../context/PanelDataContext'
import { useAppContext } from '../context/AppContext'
import { haversineMeters } from '../hooks/useMovementEngine'
import { getMapLayerRegistry } from '../lib/mapLayerRegistry'
import type { Waypoint } from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_ID = 'hud-modern-proximity-source'
const LAYER_OUTER = 'hud-modern-proximity-outer'
const LAYER_MID = 'hud-modern-proximity-mid'
const LAYER_INNER = 'hud-modern-proximity-inner'

/** Distance thresholds in meters */
const DIST_OUTER = 300
const DIST_MID = 80
const DIST_INNER = 25

// Pixel radii per zoom level via MapLibre interpolate expression
// These approximate the real-world distances on screen
const OUTER_RADIUS_EXPR = ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 40, 17, 180]
const MID_RADIUS_EXPR = ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 18, 17, 80]
const INNER_RADIUS_EXPR = ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 8, 17, 32]

const TRANSITION = { duration: 1200, delay: 0 }

// ─── Layer setup ──────────────────────────────────────────────────────────────

function initLayers(map: maplibregl.Map) {
  const registry = getMapLayerRegistry()

  // Skip if source already registered in this session
  if (registry.shouldSkipSource(map, SOURCE_ID)) return

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  registry.registerSource(SOURCE_ID)

  // Outer ring — wide awareness halo
  if (!registry.shouldSkipLayer(map, LAYER_OUTER)) {
    map.addLayer(
      {
        id: LAYER_OUTER,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': OUTER_RADIUS_EXPR as maplibregl.ExpressionSpecification,
          'circle-color': '#5ad4b8',
          'circle-blur': 0.8,
          'circle-opacity': 0,
          'circle-opacity-transition': TRANSITION,
          'circle-stroke-width': 0,
          'circle-pitch-alignment': 'map',
        },
      },
      findInsertBefore(map),
    )
    registry.registerLayer(LAYER_OUTER)
  }

  // Mid ring — approaching
  if (!registry.shouldSkipLayer(map, LAYER_MID)) {
    map.addLayer(
      {
        id: LAYER_MID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': MID_RADIUS_EXPR as maplibregl.ExpressionSpecification,
          'circle-color': '#6ee8c8',
          'circle-blur': 0.5,
          'circle-opacity': 0,
          'circle-opacity-transition': TRANSITION,
          'circle-stroke-width': 0,
          'circle-pitch-alignment': 'map',
        },
      },
      findInsertBefore(map),
    )
    registry.registerLayer(LAYER_MID)
  }

  // Inner ring — arriving
  if (!registry.shouldSkipLayer(map, LAYER_INNER)) {
    map.addLayer(
      {
        id: LAYER_INNER,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': INNER_RADIUS_EXPR as maplibregl.ExpressionSpecification,
          'circle-color': '#7dffc8',
          'circle-blur': 0.3,
          'circle-opacity': 0,
          'circle-opacity-transition': TRANSITION,
          'circle-stroke-width': 0,
          'circle-pitch-alignment': 'map',
        },
      },
      findInsertBefore(map),
    )
    registry.registerLayer(LAYER_INNER)
  }
}

function findInsertBefore(map: maplibregl.Map): string | undefined {
  // Insert below existing route layer so rings appear underneath
  const style = map.getStyle()
  if (!style?.layers) return undefined
  const route = style.layers.find((l) => l.id === 'tactical-route-layer')
  if (route) return route.id
  // Fallback: insert before first symbol layer
  const sym = style.layers.find(
    (l) => l.type === 'symbol' && typeof (l as { 'source-layer'?: string })['source-layer'] === 'string',
  )
  return sym?.id
}

function removeLayers(map: maplibregl.Map) {
  for (const id of [LAYER_INNER, LAYER_MID, LAYER_OUTER]) {
    try {
      if (map.getLayer(id)) map.removeLayer(id)
    } catch {
      // ignore
    }
  }
  try {
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
  } catch {
    // ignore
  }
}

function setLayerOpacities(
  map: maplibregl.Map,
  outer: number,
  mid: number,
  inner: number,
) {
  const set = (id: string, opacity: number) => {
    try {
      if (map.getLayer(id)) {
        map.setPaintProperty(id, 'circle-opacity', opacity * 0.2)
        map.setPaintProperty(id, 'circle-stroke-opacity', opacity)
      }
    } catch {
      // ignore if style reset
    }
  }
  set(LAYER_OUTER, outer)
  set(LAYER_MID, mid)
  set(LAYER_INNER, inner)
}

// ─── Nearest waypoint logic ────────────────────────────────────────────────────

function findNearestTarget(
  waypoints: Waypoint[],
  lat: number,
  lng: number,
): { wp: Waypoint; dist: number } | null {
  let nearest: { wp: Waypoint; dist: number } | null = null

  for (const wp of waypoints) {
    if (wp.status === 'completed' || wp.status === 'archived') continue
    const dist = haversineMeters(lat, lng, wp.lat, wp.lng)
    if (nearest === null || dist < nearest.dist) {
      nearest = { wp, dist }
    }
  }

  return nearest
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function WaypointProximityLayer() {
  const { map } = useMapContext()
  const { mode } = useHudPresentation()
  const { userLocation } = usePanelData()
  const { state } = useAppContext()

  const isImmersive = mode === 'immersive'
  const waypoints = state.waypoints

  const nearestIdRef = useRef<string | null>(null)
  const layersReadyRef = useRef(false)

  // ── Initialize layers ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !isImmersive) return

    const apply = () => {
      initLayers(map)
      layersReadyRef.current = true
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('style.load', apply)
      return () => { map.off('style.load', apply) }
    }
  }, [map, isImmersive])

  // ── Re-init after basemap style change ────────────────────────────────────
  useEffect(() => {
    if (!map || !isImmersive) return
    const onStyleData = () => {
      // On style reset, clear registry and reinitialize layers
      const registry = getMapLayerRegistry()
      registry.onStyleReset()
      
      if (!map.getLayer(LAYER_OUTER)) {
        initLayers(map)
      }
    }
    map.on('styledata', onStyleData)
    return () => { map.off('styledata', onStyleData) }
  }, [map, isImmersive])

  // ── Update proximity rings on GPS / waypoint changes ──────────────────────
  useEffect(() => {
    if (!map || !isImmersive || !layersReadyRef.current) return
    if (!userLocation || waypoints.length === 0) {
      setLayerOpacities(map, 0, 0, 0)
      nearestIdRef.current = null
      return
    }

    const nearest = findNearestTarget(waypoints, userLocation.lat, userLocation.lng)
    if (!nearest) {
      setLayerOpacities(map, 0, 0, 0)
      nearestIdRef.current = null
      return
    }

    const { wp, dist } = nearest

    // Update GeoJSON source only when nearest waypoint changes
    if (nearestIdRef.current !== wp.id) {
      nearestIdRef.current = wp.id
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
      source?.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [wp.lng, wp.lat] },
            properties: { id: wp.id },
          },
        ],
      })
    }

    // Set opacity based on distance bands
    const outerOpacity = dist < DIST_OUTER ? 1 : 0
    const midOpacity = dist < DIST_MID ? 1 : 0
    const innerOpacity = dist < DIST_INNER ? 1 : 0

    setLayerOpacities(map, outerOpacity, midOpacity, innerOpacity)
  }, [map, isImmersive, userLocation?.lat, userLocation?.lng, waypoints])

  // ── Cleanup ──────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (map) removeLayers(map)
    }
  }, [map])

  return null
}

export default WaypointProximityLayer
