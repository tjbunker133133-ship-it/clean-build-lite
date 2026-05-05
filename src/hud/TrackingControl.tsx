import { useMapContext } from '../context/MapContext'
import { useGPS } from '../hooks/useGPS'

export default function TrackingControl() {
  const { map } = useMapContext()
  const gps = useGPS()

  const handleRecenter = () => {
    if (!map) return
    if (gps.lat === null || gps.lng === null) return

    map.easeTo({
      center: [gps.lng, gps.lat],
      zoom: 15,
      duration: 800,
    })
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        right: 20,
        zIndex: 1000,
      }}
    >
      <button
        onClick={handleRecenter}
        style={{
          padding: '8px 12px',
          background: '#00E5FF',
          color: '#000',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontWeight: 'bold',
        }}
      >
        Recenter
      </button>
    </div>
  )
}