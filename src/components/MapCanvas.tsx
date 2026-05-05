import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    console.log('INIT MAP TEST')

    const map = new maplibregl.Map({
      container,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [-105.1, 37.6],
      zoom: 10,
    })

    map.on('load', () => {
      console.log('MAP LOADED')
      map.resize()
    })

    return () => map.remove()
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        background: '#000',
      }}
    />
  )
}