import React from 'react'
import { useCockpit } from '../context/CockpitContext'
import { useMapContext } from '../context/MapContext'
import { useGPS } from '../hooks/useGPS'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchFontMd, touchGapMd, touchMinTarget } from './tokens'

export default function TopBar() {
  const { prefs } = useCockpit()
  const { map } = useMapContext()
  const gps = useGPS()
  const profile = getDeviceProfile()
  const isMobile = profile.interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const fontMd = touchFontMd(isMobile)
  const gapMd = touchGapMd(isMobile)
  const tapMin = touchMinTarget(isMobile)
  const isCompact = profile.width < 720 || profile.isCoarsePointer
  const hasFix = gps.lat != null && gps.lng != null

  const locateMe = () => {
    if (!map || !hasFix) return
    map.easeTo({
      center: [gps.lng!, gps.lat!],
      zoom: Math.max(map.getZoom(), 14),
      duration: 750,
      essential: true,
    })
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
          disabled={!hasFix}
          style={{
            minHeight: tapMin,
            padding: isCompact ? '0 12px' : '0 14px',
            borderRadius: 8,
            border: hasFix ? '1px solid rgba(125,255,138,0.65)' : '1px solid rgba(130,138,132,0.45)',
            background: hasFix ? 'rgba(125,255,138,0.14)' : 'rgba(60,66,62,0.35)',
            color: hasFix ? '#b8f7c1' : '#8e9992',
            cursor: hasFix ? 'pointer' : 'not-allowed',
            letterSpacing: '0.08em',
            fontSize: fontSm,
            fontWeight: 700,
          }}
          title={hasFix ? 'Center map on live GPS' : 'Waiting for GPS fix'}
        >
          LOCATE ME
        </button>
        <span>{prefs.screen_hue.replace('_', ' ')}</span>
      </div>
    </div>
  )
}
