/**
 * Communications Recovery Overlay (CRO) - Map Layer Component
 *
 * Renders recovery direction arcs on the map.
 *
 * Visual Design:
 * - Directional arcs (not full circles)
 * - Soft cones showing probable signal zones
 * - 2-3 directions maximum
 * - Minimal visual footprint
 * - Color-coded by confidence (green/yellow/orange)
 *
 * NO full tower rendering.
 * NO cluttered marker field.
 */

import { useEffect, useMemo, useRef } from 'react'
import type { Map } from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import { useCro } from '../hooks/useCro'
import type { RecoveryDirection } from '../lib/cro'

const SOURCE_ID = 'hud-cro-source'
const LAYER_ID = 'hud-cro-layer'
const LABEL_LAYER_ID = 'hud-cro-labels'

/**
 * Generate a GeoJSON arc for a recovery direction.
 */
function createDirectionArc(
  center: [number, number],
  direction: RecoveryDirection,
): GeoJSON.Feature {
  const arcLength = 200 // meters
  const numPoints = 30
  const coords: [number, number][] = []

  // Create arc points
  const startAngle = direction.headingDegrees - direction.arcWidthDegrees / 2
  const endAngle = direction.headingDegrees + direction.arcWidthDegrees / 2

  for (let i = 0; i <= numPoints; i++) {
    const angle = startAngle + (endAngle - startAngle) * (i / numPoints)
    const rad = angle * Math.PI / 180
    // Approximate meters to degrees (very rough, but sufficient for visual)
    const latOffset = Math.cos(rad) * arcLength / 111000
    const lngOffset = Math.sin(rad) * arcLength / (111000 * Math.cos(center[1] * Math.PI / 180))
    coords.push([center[0] + lngOffset, center[1] + latOffset])
  }

  // Close the arc back to center
  coords.push(center)

  return {
    type: 'Feature',
    properties: {
      id: direction.id,
      heading: direction.headingDegrees,
      confidence: direction.confidence,
      reason: direction.reason,
      terrainHint: direction.terrainHint,
      color: direction.color,
      opacity: direction.opacity,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [coords],
    },
  }
}

/**
 * Generate a GeoJSON line for the direction pointer.
 */
function createDirectionLine(
  center: [number, number],
  direction: RecoveryDirection,
): GeoJSON.Feature {
  const lineLength = 300 // meters
  const angle = direction.headingDegrees * Math.PI / 180
  const latOffset = Math.cos(angle) * lineLength / 111000
  const lngOffset = Math.sin(angle) * lineLength / (111000 * Math.cos(center[1] * Math.PI / 180))

  return {
    type: 'Feature',
    properties: {
      id: `${direction.id}-line`,
      color: direction.color,
      confidence: direction.confidence,
    },
    geometry: {
      type: 'LineString',
      coordinates: [
        center,
        [center[0] + lngOffset, center[1] + latOffset],
      ],
    },
  }
}

/**
 * Add CRO layers to map.
 */
function addCroLayers(map: Map, directions: RecoveryDirection[], center: [number, number]) {
  // Create GeoJSON source
  const arcs = directions.map((d) => createDirectionArc(center, d))
  const lines = directions.map((d) => createDirectionLine(center, d))

  const geojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [...arcs, ...lines],
  }

  // Remove existing source/layers if any
  try {
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
    if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID)
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
  } catch {
    // Ignore errors
  }

  // Add source
  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: geojson,
  })

  // Add fill layer for arcs
  map.addLayer({
    id: LAYER_ID,
    type: 'fill',
    source: SOURCE_ID,
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': ['get', 'opacity'],
    },
    filter: ['==', ['geometry-type'], 'Polygon'],
  })

  // Add line layer for direction indicators
  map.addLayer({
    id: `${LAYER_ID}-lines`,
    type: 'line',
    source: SOURCE_ID,
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 3,
      'line-opacity': 0.8,
    },
    filter: ['==', ['geometry-type'], 'LineString'],
  })

  // Add label layer
  map.addLayer({
    id: LABEL_LAYER_ID,
    type: 'symbol',
    source: SOURCE_ID,
    layout: {
      'text-field': ['concat', ['get', 'heading'], '°'],
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
      'text-size': 12,
      'text-anchor': 'center',
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': '#000000',
      'text-halo-width': 2,
    },
    filter: ['==', ['geometry-type'], 'Polygon'],
  })
}

/**
 * Remove CRO layers from map.
 */
function removeCroLayers(map: Map) {
  try {
    if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID)
    if (map.getLayer(`${LAYER_ID}-lines`)) map.removeLayer(`${LAYER_ID}-lines`)
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
  } catch {
    // Ignore errors
  }
}

/**
 * CRO Layer Component.
 */
export default function CommunicationsRecoveryOverlay() {
  const { map } = useMapContext()
  const { directions, isVisible } = useCro()
  const renderedRef = useRef(false)

  useEffect(() => {
    if (!map) return

    if (isVisible && directions.length > 0) {
      const center = map.getCenter()
      addCroLayers(
        map,
        directions,
        [center.lng, center.lat],
      )
      renderedRef.current = true
    } else if (renderedRef.current) {
      removeCroLayers(map)
      renderedRef.current = false
    }

    return () => {
      if (renderedRef.current && map) {
        removeCroLayers(map)
        renderedRef.current = false
      }
    }
  }, [map, directions, isVisible])

  // Update positions when map moves (throttled)
  useEffect(() => {
    if (!map || !isVisible || directions.length === 0) return

    const onMove = () => {
      if (!renderedRef.current) return
      const center = map.getCenter()
      removeCroLayers(map)
      addCroLayers(map, directions, [center.lng, center.lat])
    }

    map.on('moveend', onMove)
    return () => {
      map.off('moveend', onMove)
    }
  }, [map, directions, isVisible])

  return null // This component renders via MapLibre, not React DOM
}
