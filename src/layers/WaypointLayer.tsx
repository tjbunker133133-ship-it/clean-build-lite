import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'

export default function WaypointLayer() {
  const { mapRef } = useMapContext()
  const { waypoints } = useAppContext()

  const markersRef = useRef<Record<string, maplibregl.Marker>>({})

  useEffect(() => {
    const map = mapRef.current
    if (!map || !waypoints) return

    // clear old markers safely
    Object.values(markersRef.current).forEach(m => m.remove())
    markersRef.current = {}

    // rebuild markers
    waypoints.forEach(wp => {
      if (!wp) return

      const el = document.createElement('div')

      el.style.width = '14px'
      el.style.height = '14px'
      el.style.borderRadius = '50%'
      el.style.background = '#ff3b3b'
      el.style.cursor = 'pointer'

      const label = document.createElement('div')
      label.style.position = 'absolute'
      label.style.top = '16px'
      label.style.left = '0'
      label.style.fontSize = '12px'
      label.style.color = '#fff'
      label.style.background = 'rgba(0,0,0,0.6)'
      label.style.padding = '2px 6px'
      label.style.borderRadius = '4px'
      label.innerText = wp.label ?? ''

      el.appendChild(label)

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([wp.lng, wp.lat])
        .addTo(map)

      markersRef.current[wp.id] = marker
    })
  }, [waypoints, mapRef])

  return null
}