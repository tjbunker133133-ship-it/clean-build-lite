/**
 * MapMeasureLayer — shared measure line rendering (Balanced + Modern).
 * Geometry lives in mapInteractionController; this layer only renders.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import maplibregl from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import { haversineMeters, formatDistance } from '../lib/haversine'
import {
  getMapInteractionSnapshot,
  subscribeMapInteraction,
  updateMeasurePoint,
} from '../lib/mapInteractionController'

const SOURCE_ID = 'hud-map-measure-source'
const LINE_LAYER_ID = 'hud-map-measure-line'

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function formatMeasureDistance(meters: number): string {
  return formatDistance(meters / 1609.344)
}

function ensureLineLayer(map: maplibregl.Map) {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.getLayer(LINE_LAYER_ID)) {
    map.addLayer({
      id: LINE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': '#00ffb4',
        'line-width': 3,
        'line-opacity': 0.85,
        'line-dasharray': [2, 1.5],
      },
    })
  }
}

function removeLineLayer(map: maplibregl.Map) {
  try {
    if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID)
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
  } catch {
    /* style churn */
  }
}

function createPointMarker(index: number): { el: HTMLDivElement; marker: maplibregl.Marker } {
  const el = document.createElement('div')
  el.setAttribute('data-testid', `map-measure-point-${index}`)
  el.style.cssText =
    'width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #00ffb4;box-shadow:0 1px 6px rgba(0,0,0,0.35);cursor:grab;touch-action:none;'
  const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' })
  return { el, marker }
}

export function MapMeasureLayer() {
  const { map } = useMapContext()
  const snapshot = useSyncExternalStore(subscribeMapInteraction, getMapInteractionSnapshot, getMapInteractionSnapshot)
  const labelRef = useRef<HTMLDivElement | null>(null)
  const readoutMarkerRef = useRef<maplibregl.Marker | null>(null)
  const pointMarkersRef = useRef<Array<{ marker: maplibregl.Marker; cleanup: () => void }>>([])

  const pts = snapshot.measurePoints
  const measureVisible = pts.length > 0 || snapshot.mode === 'measure'
  const ptsKey =
    pts.length === 0
      ? ''
      : pts.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|')

  useEffect(() => {
    if (!map || !measureVisible) {
      pointMarkersRef.current.forEach(({ cleanup }) => cleanup())
      pointMarkersRef.current = []
      readoutMarkerRef.current?.remove()
      readoutMarkerRef.current = null
      labelRef.current = null
      removeLineLayer(map!)
      return
    }

    const updateLine = () => {
      if (!map.isStyleLoaded()) return
      ensureLineLayer(map)
      const features: GeoJSON.Feature[] = []
      if (pts.length === 2) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [pts[0].lng, pts[0].lat],
              [pts[1].lng, pts[1].lat],
            ],
          },
          properties: {},
        })
      }
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
      source?.setData({ type: 'FeatureCollection', features })

      if (labelRef.current) {
        if (pts.length === 2) {
          const dist = haversineMeters(pts[0].lat, pts[0].lng, pts[1].lat, pts[1].lng)
          const brg = Math.round(bearingDeg(pts[0].lat, pts[0].lng, pts[1].lat, pts[1].lng))
          labelRef.current.textContent = `${formatMeasureDistance(dist)} · ${brg}°`
        } else {
          labelRef.current.textContent = pts.length === 1 ? 'Tap second point · drag to adjust' : 'Tap to measure'
        }
      }
    }

    pointMarkersRef.current.forEach(({ cleanup }) => cleanup())
    pointMarkersRef.current = []

    pts.forEach((p, index) => {
      const { marker } = createPointMarker(index)
      marker.setLngLat([p.lng, p.lat]).addTo(map)
      const onDragEnd = () => {
        const ll = marker.getLngLat()
        updateMeasurePoint(index, ll.lat, ll.lng)
      }
      marker.on('dragend', onDragEnd)
      pointMarkersRef.current.push({
        marker,
        cleanup: () => {
          marker.off('dragend', onDragEnd)
          marker.remove()
        },
      })
    })

    if (!readoutMarkerRef.current) {
      const el = document.createElement('div')
      el.setAttribute('data-testid', 'map-measure-readout')
      el.style.cssText =
        'padding:8px 12px;border-radius:10px;background:rgba(20,28,26,0.9);color:#00ffb4;font:600 12px -apple-system,system-ui,sans-serif;border:1px solid rgba(0,255,180,0.35);pointer-events:none;white-space:nowrap;'
      el.textContent = 'Tap to measure'
      labelRef.current = el
      readoutMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(map.getCenter())
        .addTo(map)
    }

    const onMove = () => readoutMarkerRef.current?.setLngLat(map.getCenter())
    map.on('move', onMove)

    if (map.isStyleLoaded()) {
      updateLine()
    } else {
      map.once('load', updateLine)
    }

    return () => {
      map.off('move', onMove)
      map.off('load', updateLine)
      pointMarkersRef.current.forEach(({ cleanup }) => cleanup())
      pointMarkersRef.current = []
    }
  }, [map, measureVisible, ptsKey, pts])

  useEffect(() => {
    return () => {
      if (map) removeLineLayer(map)
      readoutMarkerRef.current?.remove()
      readoutMarkerRef.current = null
    }
  }, [map])

  return null
}

export default MapMeasureLayer
