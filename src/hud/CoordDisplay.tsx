import { useEffect, useState } from 'react'
import type { MapMouseEvent } from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import HudPanel from './HudPanel'

export default function CoordDisplay() {
  const { map } = useMapContext()

  const [coords, setCoords] = useState({
    lng: 0,
    lat: 0,
  })

  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!map) return

    setReady(true)

    const update = (e: MapMouseEvent) => {
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
  }, [map])

  return (
    <HudPanel
      panelId="coords"
      title="Coordinates"
      initialPos={{ x: 16, y: 280 }}
      initialWidth={280}
      minHeight={72}
    >
      <div
        style={{
          padding: '6px 10px',
          color: '#c7cec6',
          borderRadius: 6,
          fontFamily: 'monospace',
          fontSize: 12,
        }}
      >
        {ready
          ? `Lng: ${coords.lng.toFixed(5)} | Lat: ${coords.lat.toFixed(5)}`
          : 'Loading coords...'}
      </div>
    </HudPanel>
  )
}