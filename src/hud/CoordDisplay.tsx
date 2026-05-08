import { useEffect, useState } from 'react'
import type { MapMouseEvent } from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontMd } from './tokens'

/** Map viewport center readout (same hooks as legacy Coordinates panel). */
export function CoordReadoutBody() {
  const { map } = useMapContext()

  const [coords, setCoords] = useState({
    lng: 0,
    lat: 0,
  })

  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!map) return

    setReady(true)

    const setFromLngLat = (lng: number, lat: number) => {
      setCoords({
        lng,
        lat,
      })
    }

    const updateFromEvent = (e: MapMouseEvent) => {
      if (!e?.lngLat) return
      setFromLngLat(e.lngLat.lng, e.lngLat.lat)
    }
    const updateFromCenter = () => {
      const c = map.getCenter()
      setFromLngLat(c.lng, c.lat)
    }

    // Initialize immediately so panel is useful before pointer movement.
    updateFromCenter()
    // Desktop pointer tracking.
    map.on('mousemove', updateFromEvent)
    // Mobile + keyboard navigation + programmatic camera updates.
    map.on('move', updateFromCenter)
    map.on('moveend', updateFromCenter)
    map.on('idle', updateFromCenter)

    return () => {
      map.off('mousemove', updateFromEvent)
      map.off('move', updateFromCenter)
      map.off('moveend', updateFromCenter)
      map.off('idle', updateFromCenter)
    }
  }, [map])

  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontMd = touchFontMd(isMobile)

  return (
    <div
      style={{
        padding: '6px 10px',
        color: '#c7cec6',
        borderRadius: 6,
        fontFamily: 'monospace',
        fontSize: fontMd,
      }}
    >
      {ready
        ? `Lng: ${coords.lng.toFixed(5)} | Lat: ${coords.lat.toFixed(5)}`
        : 'Loading coords...'}
    </div>
  )
}