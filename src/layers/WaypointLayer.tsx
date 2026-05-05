import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'
import type { WaypointType } from '../types'
import { haversineDistance, formatDistance } from '../lib/haversine'

function markerVisual(type: WaypointType): { color: string; symbol: string } {
  if (type === 'water') return { color: '#38bdf8', symbol: '💧' }
  if (type === 'camp') return { color: '#34d399', symbol: '⛺' }
  if (type === 'rest') return { color: '#fbbf24', symbol: '☕' }
  if (type === 'finish') return { color: '#f472b6', symbol: '🏁' }
  return { color: '#f87171', symbol: '•' }
}

export default function WaypointLayer() {
  const { map } = useMapContext()
  const { state } = useAppContext()
  const { waypoints, showMapLabels, showMapDistances } = state

  const markersRef = useRef<Record<string, maplibregl.Marker>>({})
  const segmentMarkersRef = useRef<maplibregl.Marker[]>([])
  const rebuildRafRef = useRef<number | null>(null)
  const [overlaysReady, setOverlaysReady] = useState(false)
  const lowPowerMode = useMemo(() => {
    const nav = navigator as Navigator & { deviceMemory?: number }
    const cores = nav.hardwareConcurrency ?? 8
    const mem = nav.deviceMemory ?? 8
    const coarse = window.matchMedia('(pointer: coarse)').matches
    return coarse && (cores <= 6 || mem <= 4)
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
      segmentMarkersRef.current.forEach((m) => m.remove())
      segmentMarkersRef.current = []

      // rebuild markers
      waypoints.forEach((wp) => {
        if (!wp) return

        const el = document.createElement('div')
        const v = markerVisual(wp.type)
        el.style.width = lowPowerMode ? '22px' : '26px'
        el.style.height = lowPowerMode ? '22px' : '26px'
        el.style.borderRadius = '999px'
        el.style.background = lowPowerMode
          ? v.color
          : `radial-gradient(circle at 30% 25%, #ffffff, ${v.color})`
        el.style.border = lowPowerMode ? '1px solid rgba(255,255,255,0.8)' : '2px solid rgba(255,255,255,0.9)'
        el.style.boxShadow = lowPowerMode ? '0 1px 3px rgba(0,0,0,0.3)' : `0 0 16px ${v.color}66, 0 2px 8px rgba(0,0,0,0.45)`
        el.style.cursor = 'pointer'
        el.style.display = 'flex'
        el.style.alignItems = 'center'
        el.style.justifyContent = 'center'
        el.style.fontSize = lowPowerMode ? '11px' : '13px'
        el.style.userSelect = 'none'
        el.textContent = v.symbol

        if (overlaysReady && showMapLabels) {
          const label = document.createElement('div')
          label.style.position = 'absolute'
          label.style.top = '30px'
          label.style.left = '50%'
          label.style.transform = 'translateX(-50%)'
          label.style.fontSize = '11px'
          label.style.letterSpacing = '0.02em'
          label.style.color = '#ecf4ff'
          label.style.background = 'linear-gradient(180deg, rgba(6,10,16,0.86), rgba(8,12,20,0.68))'
          label.style.padding = '3px 8px'
          label.style.borderRadius = '999px'
          label.style.border = '1px solid #3a4250'
          label.style.boxShadow = lowPowerMode ? 'none' : '0 1px 4px rgba(0,0,0,0.45)'
          label.style.whiteSpace = 'nowrap'
          label.innerText = wp.label ?? ''
          el.appendChild(label)
        }

        const marker = new maplibregl.Marker({ element: el }).setLngLat([wp.lng, wp.lat]).addTo(map)
        markersRef.current[wp.id] = marker
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

          const segMarker = new maplibregl.Marker({ element: segEl, anchor: 'center' })
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
  }, [waypoints, map, showMapLabels, showMapDistances, overlaysReady, lowPowerMode])

  useEffect(() => {
    return () => {
      if (rebuildRafRef.current != null) {
        window.cancelAnimationFrame(rebuildRafRef.current)
        rebuildRafRef.current = null
      }
      Object.values(markersRef.current).forEach((m) => m.remove())
      segmentMarkersRef.current.forEach((m) => m.remove())
      markersRef.current = {}
      segmentMarkersRef.current = []
    }
  }, [])

  return null
}