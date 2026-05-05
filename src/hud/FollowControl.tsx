import { useState, useEffect } from 'react'
import { useMapContext } from '../context/MapContext'
import { useGPS } from '../hooks/useGPS'

export default function FollowControl() {
  const { map } = useMapContext()
  const gps = useGPS()

  const [follow, setFollow] = useState(false)

  // 🔁 Follow behavior (safe external control)
  useEffect(() => {
    if (!follow) return

    if (!map) return
    if (gps.lat === null || gps.lng === null) return

    map.easeTo({
      center: [gps.lng, gps.lat],
      duration: 600,
    })
  }, [gps, follow, map])

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 80,
        right: 20,
        zIndex: 1000,
      }}
    >
      <button
        onClick={() => setFollow((f) => !f)}
        style={{
          padding: '8px 12px',
          background: follow ? '#00E5FF' : '#222',
          color: follow ? '#000' : '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontWeight: 'bold',
        }}
      >
        {follow ? 'FOLLOW ON' : 'FOLLOW OFF'}
      </button>
    </div>
  )
}