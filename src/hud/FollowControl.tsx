import { useState, useEffect, useRef } from 'react'
import { useMapContext } from '../context/MapContext'
import { useGPS } from '../hooks/useGPS'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchMinTarget } from './tokens'

// ⚠️ LOCKED SYSTEM — Behavior Freeze Active
// Any change to interaction, layout, display modes, or layers requires explicit approval.

export default function FollowControl() {
  const { map } = useMapContext()
  const gps = useGPS()

  const [follow, setFollow] = useState(false)
  const lastEaseRef = useRef<{ lat: number; lng: number } | null>(null)

  // 🔒 CONTRACT: Panel interaction system is locked.
  // - Drag must not jump or offset from cursor
  // - Dock gap must remain 0 (flush stacking)
  // - Left/right dock must remain symmetrical
  // - Undock must always clear minimized
  // Do NOT modify without explicit approval
  // 🔁 Follow behavior (safe external control)
  useEffect(() => {
    if (!follow) return

    if (!map) return
    if (gps.locationState !== 'granted' || gps.lat === null || gps.lng === null) return
    const last = lastEaseRef.current
    if (last && last.lat === gps.lat && last.lng === gps.lng) {
      if (import.meta.env.DEV) {
        console.warn('[GUARD] Prevented duplicate map.easeTo in FollowControl')
      }
      return
    }
    lastEaseRef.current = { lat: gps.lat, lng: gps.lng }

    map.easeTo({
      center: [gps.lng, gps.lat],
      duration: 420,
      essential: true,
    })
  }, [follow, map, gps.locationState, gps.lat, gps.lng])

  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const tapMin = touchMinTarget(isMobile)

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
          minHeight: tapMin,
          minWidth: tapMin,
          padding: '10px 14px',
          background: follow ? '#00E5FF' : '#222',
          color: follow ? '#000' : '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontWeight: 'bold',
          fontSize: fontSm,
        }}
      >
        {follow ? 'FOLLOW ON' : 'FOLLOW OFF'}
      </button>
    </div>
  )
}