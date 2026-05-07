import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'
import type { WaypointType } from '../types'
import { haversineDistance, formatDistance } from '../lib/haversine'
import { getDeviceProfile } from '../runtime/deviceProfile'

/** Micro-shift so visual circle tip meets route vertex ([y negative] = nudge up). Tune: [0,-1] … [0,-3] or ±x for horizontal. */
const WAYPOINT_PIN_OFFSET_PX: [number, number] = [0, -2]

function markerVisual(type: WaypointType): { color: string; symbol: string } {
  if (type === 'water') return { color: '#38bdf8', symbol: '💧' }
  if (type === 'camp') return { color: '#34d399', symbol: '⛺' }
  if (type === 'rest') return { color: '#fbbf24', symbol: '☕' }
  if (type === 'finish') return { color: '#f472b6', symbol: '🏁' }
  return { color: '#f87171', symbol: '•' }
}

/** `?waypointMarker=default` or `localStorage.hud_waypoint_default_marker=1` → MapLibre built-in marker (diagnostics). */
function useDefaultWaypointMarkerDebug(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.location.search.includes('waypointMarker=default')) return true
    if (window.localStorage.getItem('hud_waypoint_default_marker') === '1') return true
  } catch {
    /* ignore */
  }
  return false
}

export default function WaypointLayer() {
  const { map } = useMapContext()
  const { state, removeWaypoint, updateWaypoint } = useAppContext()
  const { waypoints, showMapLabels, showMapDistances } = state

  const markersRef = useRef<Record<string, maplibregl.Marker>>({})
  const labelMarkersRef = useRef<Record<string, maplibregl.Marker>>({})
  const segmentMarkersRef = useRef<maplibregl.Marker[]>([])
  const rebuildRafRef = useRef<number | null>(null)
  const [overlaysReady, setOverlaysReady] = useState(false)
  const lowPowerMode = useMemo(() => {
    const nav = navigator as Navigator & { deviceMemory?: number }
    const cores = nav.hardwareConcurrency ?? 8
    const mem = nav.deviceMemory ?? 8
    return getDeviceProfile().isCoarsePointer && (cores <= 6 || mem <= 4)
  }, [])

  useEffect(() => {
    if (!map) return
    setOverlaysReady(false)
    let timeoutId: number | null = null
    const markReady = () => setOverlaysReady(true)

    // Defer non-essential overlays (labels/distance pills) until map settles.
    map.once('idle', markReady)
    timeoutId = window.setTimeout(markReady, 900)

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId)
      map.off('idle', markReady)
    }
  }, [map])

  useEffect(() => {
    if (!map) return
    if (rebuildRafRef.current != null) {
      window.cancelAnimationFrame(rebuildRafRef.current)
      rebuildRafRef.current = null
    }

    rebuildRafRef.current = window.requestAnimationFrame(() => {
      rebuildRafRef.current = null
      // clear old markers safely
      Object.values(markersRef.current).forEach((m) => m.remove())
      markersRef.current = {}
      Object.values(labelMarkersRef.current).forEach((m) => m.remove())
      labelMarkersRef.current = {}
      segmentMarkersRef.current.forEach((m) => m.remove())
      segmentMarkersRef.current = []

      const debugDefaultMarker = useDefaultWaypointMarkerDebug()

      // rebuild markers
      waypoints.forEach((wp) => {
        if (!wp) return

        const v = markerVisual(wp.type)

        if (debugDefaultMarker) {
          const marker = new maplibregl.Marker({
            draggable: true,
            color: v.color,
            scale: 1,
            anchor: 'bottom',
            offset: WAYPOINT_PIN_OFFSET_PX,
            pitchAlignment: 'map',
            rotationAlignment: 'map',
            subpixelPositioning: true,
          })
            .setLngLat([wp.lng, wp.lat])
            .addTo(map)
          marker.on('dragstart', () => {
            map.dragPan.disable()
          })
          marker.on('dragend', () => {
            map.dragPan.enable()
            const pos = marker.getLngLat()
            updateWaypoint(wp.id, { lng: pos.lng, lat: pos.lat })
          })
          marker.getElement().addEventListener('contextmenu', (ev) => {
            ev.preventDefault()
            ev.stopPropagation()
            const ok = window.confirm(`Delete waypoint "${wp.label}"?`)
            if (ok) removeWaypoint(wp.id)
          })
          markersRef.current[wp.id] = marker
          if (overlaysReady && showMapLabels) {
            const labelEl = document.createElement('div')
            labelEl.className = 'waypoint-label-float'
            if (!lowPowerMode) {
              labelEl.style.boxShadow = '0 1px 4px rgba(0,0,0,0.45)'
            }
            labelEl.innerText = wp.label ?? ''
            const labelMarker = new maplibregl.Marker({
              element: labelEl,
              anchor: 'top',
              offset: [0, 4],
              pitchAlignment: 'map',
              rotationAlignment: 'map',
            })
              .setLngLat([wp.lng, wp.lat])
              .addTo(map)
            labelMarkersRef.current[wp.id] = labelMarker
          }
          return
        }

        const root = document.createElement('div')
        root.className = 'marker'
        root.dataset.lowPower = lowPowerMode ? '1' : '0'

        const icon = document.createElement('div')
        icon.className = 'marker-icon'
        icon.style.background = lowPowerMode
          ? v.color
          : `radial-gradient(circle at 30% 25%, #ffffff, ${v.color})`
        icon.style.border = lowPowerMode ? '1px solid rgba(255,255,255,0.8)' : '2px solid rgba(255,255,255,0.9)'
        icon.style.boxShadow = lowPowerMode
          ? '0 1px 3px rgba(0,0,0,0.3)'
          : `0 0 16px ${v.color}66, 0 2px 8px rgba(0,0,0,0.45)`
        icon.textContent = v.symbol
        root.appendChild(icon)

        const deleteBadge = document.createElement('button')
        deleteBadge.type = 'button'
        deleteBadge.className = 'marker-badge'
        deleteBadge.textContent = '×'
        deleteBadge.setAttribute('aria-label', `Delete waypoint ${wp.label}`)
        root.appendChild(deleteBadge)

        const askDelete = () => {
          const ok = window.confirm(`Delete waypoint "${wp.label}"?`)
          if (!ok) return
          removeWaypoint(wp.id)
        }
        deleteBadge.addEventListener('pointerdown', (ev) => {
          ev.preventDefault()
          ev.stopPropagation()
        })
        deleteBadge.addEventListener('click', (ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          askDelete()
        })
        root.addEventListener('contextmenu', (ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          askDelete()
        })

        const marker = new maplibregl.Marker({
          element: root,
          draggable: true,
          clickTolerance: 4,
          anchor: 'bottom',
          offset: WAYPOINT_PIN_OFFSET_PX,
          pitchAlignment: 'map',
          rotationAlignment: 'map',
          subpixelPositioning: true,
        })
          .setLngLat([wp.lng, wp.lat])
          .addTo(map)
        marker.on('dragstart', () => {
          map.dragPan.disable()
        })
        marker.on('dragend', () => {
          map.dragPan.enable()
          const pos = marker.getLngLat()
          updateWaypoint(wp.id, { lng: pos.lng, lat: pos.lat })
        })
        markersRef.current[wp.id] = marker

        if (overlaysReady && showMapLabels) {
          const labelEl = document.createElement('div')
          labelEl.className = 'waypoint-label-float'
          if (!lowPowerMode) {
            labelEl.style.boxShadow = '0 1px 4px rgba(0,0,0,0.45)'
          }
          labelEl.innerText = wp.label ?? ''
          const labelMarker = new maplibregl.Marker({
            element: labelEl,
            anchor: 'top',
            offset: [0, 4],
            pitchAlignment: 'map',
            rotationAlignment: 'map',
          })
            .setLngLat([wp.lng, wp.lat])
            .addTo(map)
          labelMarkersRef.current[wp.id] = labelMarker
        }
      })

      if (overlaysReady && showMapDistances && waypoints.length >= 2) {
        for (let i = 1; i < waypoints.length; i++) {
          const a = waypoints[i - 1]
          const b = waypoints[i]
          const midLng = (a.lng + b.lng) / 2
          const midLat = (a.lat + b.lat) / 2
          const seg = haversineDistance(a.lat, a.lng, b.lat, b.lng)
          const text = formatDistance(seg.miles)

          const segEl = document.createElement('div')
          segEl.style.padding = '2px 7px'
          segEl.style.borderRadius = '999px'
          segEl.style.border = '1px solid #1f8f76'
          segEl.style.background = lowPowerMode
            ? 'rgba(4,30,26,0.82)'
            : 'linear-gradient(180deg, rgba(4,30,26,0.88), rgba(5,20,18,0.72))'
          segEl.style.color = '#81f7dd'
          segEl.style.fontSize = '10px'
          segEl.style.fontWeight = '700'
          segEl.style.letterSpacing = '0.03em'
          segEl.style.boxShadow = lowPowerMode ? 'none' : '0 0 8px rgba(0,255,180,0.3)'
          segEl.style.whiteSpace = 'nowrap'
          segEl.textContent = text

          const segMarker = new maplibregl.Marker({
            element: segEl,
            anchor: 'center',
            pitchAlignment: 'map',
            rotationAlignment: 'map',
          })
            .setLngLat([midLng, midLat])
            .addTo(map)
          segmentMarkersRef.current.push(segMarker)
        }
      }
    })
    return () => {
      if (rebuildRafRef.current != null) {
        window.cancelAnimationFrame(rebuildRafRef.current)
        rebuildRafRef.current = null
      }
    }
  }, [waypoints, map, showMapLabels, showMapDistances, overlaysReady, lowPowerMode, removeWaypoint, updateWaypoint])

  useEffect(() => {
    return () => {
      if (rebuildRafRef.current != null) {
        window.cancelAnimationFrame(rebuildRafRef.current)
        rebuildRafRef.current = null
      }
      Object.values(markersRef.current).forEach((m) => m.remove())
      Object.values(labelMarkersRef.current).forEach((m) => m.remove())
      segmentMarkersRef.current.forEach((m) => m.remove())
      markersRef.current = {}
      labelMarkersRef.current = {}
      segmentMarkersRef.current = []
    }
  }, [])

  return null
}