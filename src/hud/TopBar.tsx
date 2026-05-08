import React, { useEffect, useRef } from 'react'
import { useCockpit } from '../context/CockpitContext'
import { useMapContext } from '../context/MapContext'
import { useGPS } from '../hooks/useGPS'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { emitHaptic } from '../runtime/haptics'
import { touchFontSm, touchFontMd, touchGapMd, touchMinTarget } from './tokens'

export default function TopBar() {
  const { prefs } = useCockpit()
  const { map } = useMapContext()
  const gps = useGPS()
  const pendingCenterAfterFixRef = useRef(false)
  const profile = getDeviceProfile()
  const isMobile = profile.interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const fontMd = touchFontMd(isMobile)
  const gapMd = touchGapMd(isMobile)
  const tapMin = touchMinTarget(isMobile)
  const isCompact = profile.width < 720 || profile.isCoarsePointer
  const hasCoords = gps.lat != null && gps.lng != null
  /** Center only when we already have coordinates and an active grant or in-flight browser request. */
  const canCenterNow =
    Boolean(map) &&
    hasCoords &&
    (gps.locationState === 'granted' || gps.locationState === 'requesting')
  const canRequestLocation =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.geolocation) &&
    gps.locationState !== 'denied'
  const locateEnabled = Boolean(map) && (canCenterNow || canRequestLocation)

  useEffect(() => {
    if (gps.locationState === 'denied' || gps.locationState === 'error') {
      pendingCenterAfterFixRef.current = false
    }
  }, [gps.locationState])

  useEffect(() => {
    if (!map || !pendingCenterAfterFixRef.current) return
    if (gps.lat == null || gps.lng == null) return
    if (gps.locationState !== 'granted') return
    pendingCenterAfterFixRef.current = false
    map.easeTo({
      center: [gps.lng!, gps.lat!],
      zoom: Math.max(map.getZoom(), 14),
      duration: 750,
      essential: true,
    })
  }, [map, gps.lat, gps.lng, gps.locationState])

  const locateMe = () => {
    if (!map) return
    if (canCenterNow) {
      pendingCenterAfterFixRef.current = false
      emitHaptic('wakeWord', 'locate.center')
      map.easeTo({
        center: [gps.lng!, gps.lat!],
        zoom: Math.max(map.getZoom(), 14),
        duration: 750,
        essential: true,
      })
      return
    }
    if (!canRequestLocation) {
      emitHaptic('commandFailure', 'locate.unavailable')
      return
    }
    pendingCenterAfterFixRef.current = true
    void gps.requestLocation()
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: isCompact ? 52 : 48,
        zIndex: 200,
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `calc(env(safe-area-inset-top, 0px) + 2px) ${isCompact ? 12 : 16}px 0 ${isCompact ? 12 : 16}px`,
        background: 'rgba(10, 12, 13, 0.9)',
        borderBottom: '1px solid rgba(199, 206, 198, 0.22)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 30px rgba(0, 0, 0, 0.35)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: gapMd,
          fontFamily: 'var(--font-ui)',
          fontWeight: 700,
          fontSize: isCompact ? fontSm : fontMd,
          letterSpacing: '0.18em',
          color: '#c7cec6',
          textShadow: '0 0 10px rgba(199,206,198,0.25)',
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#c7cec6',
            boxShadow: '0 0 8px rgba(199,206,198,0.65)',
          }}
        />
        NIGHTFORCE
        {!isCompact && (
          <span
            style={{
              fontSize: fontSm,
              color: '#9ea7a0',
              letterSpacing: '0.12em',
              fontWeight: 400,
              opacity: 0.9,
            }}
          >
            Ctrl+E export · ⇧Ctrl+E import
          </span>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: gapMd,
          fontFamily: 'var(--font-ui, system-ui)',
          fontSize: fontSm,
          color: '#9ea7a0',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        <button
          type="button"
          onClick={locateMe}
          disabled={!locateEnabled}
          aria-busy={gps.locationState === 'requesting'}
          style={{
            minHeight: tapMin,
            padding: isCompact ? '0 12px' : '0 14px',
            borderRadius: 8,
            border: canCenterNow ? '1px solid rgba(125,255,138,0.65)' : '1px solid rgba(130,138,132,0.45)',
            background: canCenterNow ? 'rgba(125,255,138,0.14)' : 'rgba(60,66,62,0.35)',
            color: locateEnabled ? (canCenterNow ? '#b8f7c1' : '#aab5ae') : '#8e9992',
            cursor: locateEnabled ? 'pointer' : 'not-allowed',
            letterSpacing: '0.08em',
            fontSize: fontSm,
            fontWeight: 700,
          }}
          title={
            canCenterNow
              ? gps.locationState === 'requesting'
                ? 'Center map on current coordinates (still fixing position…)'
                : 'Center map on your position'
              : canRequestLocation
                ? 'Start location and center map'
                : 'Location unavailable'
          }
        >
          {gps.locationState === 'requesting' ? 'LOCATING…' : 'LOCATE ME'}
        </button>
        {gps.locationState === 'requesting' && (
          <span style={{ color: '#ffd166', fontSize: fontSm, letterSpacing: '0.06em' }}>Waiting for fix…</span>
        )}
        <span>{prefs.screen_hue.replace('_', ' ')}</span>
      </div>
    </div>
  )
}
