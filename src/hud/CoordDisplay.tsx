import { useEffect, useState } from 'react'
import { useMapContext } from '../context/MapContext'

export default function CoordDisplay() {
  const { mapRef } = useMapContext()

  const [coords, setCoords] = useState({
    lng: 0,
    lat: 0,
  })

  const [ready, setReady] = useState(false)

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    setReady(true)

    const update = (e: any) => {
      if (!e?.lngLat) return
      setCoords({
        lng: e.lngLat.lng,
        lat: e.lngLat.lat,
      })
    }

    map.on('mousemove', update)

    return () => {
      map.off('mousemove', update)
    }
  }, [mapRef])

  // 🚨 HARD GUARD (prevents ALL undefined crashes)
  if (!ready) {
    return (
      <div style={{ position: 'absolute', bottom: 10, left: 10, color: '#666' }}>
        Loading coords...
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 10,
        left: 10,
        padding: '6px 10px',
        background: '#111',
        color: '#00E5FF',
        borderRadius: 6,
        fontFamily: 'monospace',
        fontSize: 12,
        zIndex: 1000,
      }}
    >
      Lng: {coords.lng.toFixed(5)} | Lat: {coords.lat.toFixed(5)}
    </div>
  )
}