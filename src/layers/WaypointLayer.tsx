import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'
import { useTrailRoute } from '../context/TrailRouteContext'
import type { WaypointType } from '../types'
import { haversineDistance, formatDistance } from '../lib/haversine'
import { getDeviceProfile } from '../runtime/deviceProfile'
import {
  bindWaypointMarkerPointerDrag,
  bindWaypointMarkerTouchSuppress,
  shouldUseWaypointPointerDrag,
} from '../lib/waypointMarkerDrag'
import { setWaypointMarkerTouchActive } from '../lib/waypointMarkerTouchGate'
import { hudConfirm } from '../lib/hudConfirm'

/** Micro-shift so visual circle tip meets route vertex ([y negative] = nudge up). Tune: [0,-1] … [0,-3] or ±x for horizontal. */
const WAYPOINT_PIN_OFFSET_PX: [number, number] = [0, -2]

function markerVisual(type: WaypointType): { color: string; symbol: string } {
  if (type === 'start') return { color: '#22c55e', symbol: '🚩' }
  if (type === 'water') return { color: '#38bdf8', symbol: '💧' }
  if (type === 'camp') return { color: '#34d399', symbol: '⛺' }
  if (type === 'rest') return { color: '#fbbf24', symbol: '☕' }
  if (type === 'poi') return { color: '#a78bfa', symbol: '🔍' }
  if (type === 'pin') return { color: '#ef4444', symbol: '📍' }
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
  const { waypoints, showMapLabels, showMapDistances, snapToTrailEnabled } = state
  const trailRoute = useTrailRoute()

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
      const usePointerDrag = shouldUseWaypointPointerDrag()
      const markerDragTolerance = usePointerDrag ? 24 : 6

      // rebuild markers — archived hidden, completed dimmed
      waypoints.forEach((wp) => {
        if (!wp || wp.status === 'archived') return

        const isCompleted = wp.status === 'completed'
        const isActive = wp.status === 'active'
        const v = markerVisual(wp.type)
        const dimOpacity = isCompleted ? 0.45 : 1

        if (debugDefaultMarker) {
          const marker = new maplibregl.Marker({
            draggable: !usePointerDrag,
            color: v.color,
            scale: usePointerDrag ? 1.35 : 1,
            anchor: 'bottom',
            offset: WAYPOINT_PIN_OFFSET_PX,
            pitchAlignment: 'map',
            rotationAlignment: 'map',
            subpixelPositioning: true,
            clickTolerance: markerDragTolerance,
          })
            .setLngLat([wp.lng, wp.lat])
            .addTo(map)
          const markerEl = marker.getElement()
          if (usePointerDrag) {
            bindWaypointMarkerPointerDrag({
              map,
              root: markerEl,
              marker,
              onCommit: (lng, lat) => updateWaypoint(wp.id, { lng, lat }),
            })
          } else {
            marker.on('dragstart', () => {
              setWaypointMarkerTouchActive(true)
              map.dragPan.disable()
            })
            marker.on('dragend', () => {
              setWaypointMarkerTouchActive(false)
              map.dragPan.enable()
              const pos = marker.getLngLat()
              updateWaypoint(wp.id, { lng: pos.lng, lat: pos.lat })
            })
            bindWaypointMarkerTouchSuppress(markerEl)
          }
          marker.getElement().addEventListener('contextmenu', (ev) => {
            ev.preventDefault()
            ev.stopPropagation()
            void hudConfirm({
              title: 'Delete waypoint?',
              message: `Delete waypoint "${wp.label}"?`,
              confirmLabel: 'Delete',
              destructive: true,
            }).then((ok) => {
              if (ok) removeWaypoint(wp.id)
            })
          })
          markersRef.current[wp.id] = marker
          markerEl.style.opacity = String(dimOpacity)
          if (isActive) markerEl.style.filter = 'drop-shadow(0 0 6px rgba(125,255,138,0.75))'
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
        root.dataset.testid = 'waypoint'
        root.setAttribute('data-testid', 'waypoint')
        root.dataset.lowPower = lowPowerMode ? '1' : '0'
        root.style.opacity = String(dimOpacity)
        root.style.cursor = 'pointer'
        if (isActive) {
          root.style.filter = 'drop-shadow(0 0 6px rgba(125,255,138,0.75))'
        }

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
        deleteBadge.setAttribute('data-testid', 'waypoint-delete')
        deleteBadge.textContent = '×'
        deleteBadge.setAttribute('aria-label', `Delete waypoint ${wp.label}`)
        root.appendChild(deleteBadge)

        deleteBadge.addEventListener('click', (ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          ev.stopImmediatePropagation()
          if (!wp.id || !removeWaypoint) {
            console.warn('[WaypointLayer] Delete attempted without valid ID or handler')
            return
          }
          void hudConfirm({
            title: 'Delete waypoint?',
            message: `Delete waypoint "${wp.label}"?`,
            confirmLabel: 'Delete',
            destructive: true,
          }).then((ok) => {
            if (ok) removeWaypoint(wp.id)
          })
        })

        const marker = new maplibregl.Marker({
          element: root,
          draggable: !usePointerDrag,
          clickTolerance: markerDragTolerance,
          anchor: 'bottom',
          offset: WAYPOINT_PIN_OFFSET_PX,
          pitchAlignment: 'map',
          rotationAlignment: 'map',
          subpixelPositioning: true,
        })
          .setLngLat([wp.lng, wp.lat])
          .addTo(map)
        if (usePointerDrag) {
          bindWaypointMarkerPointerDrag({
            map,
            root,
            marker,
            onCommit: (lng, lat) => updateWaypoint(wp.id, { lng, lat }),
          })
        } else {
          marker.on('dragstart', () => {
            setWaypointMarkerTouchActive(true)
            map.dragPan.disable()
          })
          marker.on('dragend', () => {
            setWaypointMarkerTouchActive(false)
            map.dragPan.enable()
            const pos = marker.getLngLat()
            updateWaypoint(wp.id, { lng: pos.lng, lat: pos.lat })
          })
          bindWaypointMarkerTouchSuppress(root)
        }
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
        const visible = waypoints.filter((w) => w.status !== 'archived')
        for (let i = 1; i < visible.length; i++) {
          const a = visible[i - 1]
          const b = visible[i]
          const legIdx = i - 1
          const trailLeg = snapToTrailEnabled ? trailRoute.legs[legIdx] : undefined
          const useTrailDist = trailLeg?.mode === 'trail'
          const seg = useTrailDist ? trailLeg.distance : haversineDistance(a.lat, a.lng, b.lat, b.lng)
          const text = formatDistance(seg.miles)
          const midLng = useTrailDist ? trailLeg.midpoint.lng : (a.lng + b.lng) / 2
          const midLat = useTrailDist ? trailLeg.midpoint.lat : (a.lat + b.lat) / 2

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
  }, [
    waypoints,
    map,
    showMapLabels,
    showMapDistances,
    overlaysReady,
    lowPowerMode,
    removeWaypoint,
    updateWaypoint,
    snapToTrailEnabled,
    trailRoute.legs,
  ])

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