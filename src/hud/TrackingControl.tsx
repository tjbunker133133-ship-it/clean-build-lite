import { useGPS } from '../hooks/useGPS'
import { requestCameraIntent } from '../lib/operationalPerception/perceptionEngine'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchMinTarget } from './tokens'

export default function TrackingControl() {
  const gps = useGPS()
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const tapMin = touchMinTarget(isMobile)

  const handleRecenter = () => {
    if (gps.locationState !== 'granted' || gps.lat == null || gps.lng == null) return
    requestCameraIntent({
      kind: 'ease_to',
      center: [gps.lng, gps.lat],
      zoom: 15,
      durationMs: 680,
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
          minHeight: tapMin,
          minWidth: tapMin,
          padding: '10px 14px',
          background: '#00E5FF',
          color: '#000',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontWeight: 'bold',
          fontSize: fontSm,
        }}
      >
        Recenter
      </button>
    </div>
  )
}