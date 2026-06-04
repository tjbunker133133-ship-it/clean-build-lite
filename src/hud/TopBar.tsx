import React, { useCallback } from 'react'
import { useMapContext } from '../context/MapContext'
import { useDeviceHeading } from '../hooks/useDeviceHeading'
import { deriveGpsUiStatus, useGPS } from '../hooks/useGPS'
import { useTravelSpeed } from '../hooks/useTravelSpeed'
import { requestDeviceOrientationPermission } from '../lib/deviceHeading'
import { getDeviceProfile } from '../runtime/deviceProfile'
import CompassDial from './CompassDial'
import { topBarContentHeightPx } from './hudLayout'
import { touchFontSm, touchFontMd, touchGapMd, touchMinTarget } from './tokens'

function LocateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  )
}

export default function TopBar() {
  const { map } = useMapContext()
  const gps = useGPS()
  const gpsUi = deriveGpsUiStatus(gps)
  const { display: speed } = useTravelSpeed(gps.lat, gps.lng, gpsUi === 'locked')
  const { heading, status, cardinal } = useDeviceHeading()
  const profile = getDeviceProfile()
  const isMobile = profile.interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const fontMd = touchFontMd(isMobile)
  const gapMd = touchGapMd(isMobile)
  const tapMin = touchMinTarget(isMobile)
  const isCompact = profile.width < 720 || profile.isCoarsePointer
  const hasFix = gps.lat != null && gps.lng != null
  const dialSize = isCompact ? 52 : 56
  const barHeight = topBarContentHeightPx()

  const enableCompass = useCallback(async () => {
    const result = await requestDeviceOrientationPermission()
    if (result === 'denied') {
      /* iOS Settings → Safari → Motion; user can retry tap */
    }
  }, [])

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
        height: barHeight,
        zIndex: 200,
        pointerEvents: 'auto',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
        alignItems: 'center',
        columnGap: isCompact ? 8 : 12,
        padding: `calc(env(safe-area-inset-top, 0px) + 4px) ${isCompact ? 10 : 14}px 0`,
        background: isMobile ? 'rgba(10, 12, 13, 0.96)' : 'rgba(10, 12, 13, 0.9)',
        borderBottom: '1px solid rgba(199, 206, 198, 0.2)',
        backdropFilter: isMobile ? undefined : 'blur(12px)',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.32)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: gapMd,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: isCompact ? '5px 9px' : '5px 11px',
            borderRadius: 7,
            border: '1px solid rgba(125,255,138,0.42)',
            background: 'rgba(125,255,138,0.06)',
            boxShadow: 'inset 0 0 0 1px rgba(125,255,138,0.08)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontWeight: 700,
              fontSize: isCompact ? fontSm : fontMd,
              letterSpacing: isCompact ? '0.14em' : '0.16em',
              color: '#c7cec6',
              whiteSpace: 'nowrap',
            }}
          >
            SIGNAL ONE
          </span>
          {!isCompact && (
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontWeight: 600,
                fontSize: fontSm,
                letterSpacing: '0.12em',
                color: '#7dffa8',
                opacity: 0.92,
              }}
            >
              HUD
            </span>
          )}
        </div>
        {!isCompact && profile.interactionMode === 'desktop' && !profile.isIOS && (
          <span
            style={{
              fontSize: fontSm,
              color: '#9ea7a0',
              letterSpacing: '0.1em',
              fontWeight: 400,
              opacity: 0.88,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Ctrl+E export · ⇧Ctrl+E import
          </span>
        )}
      </div>

      <div style={{ justifySelf: 'center', paddingBottom: 2 }}>
        <CompassDial
          heading={heading}
          status={status}
          cardinal={cardinal}
          size={dialSize}
          onRequestPermission={status === 'unavailable' ? () => void enableCompass() : undefined}
        />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: gapMd,
          minWidth: 0,
        }}
      >
        <div
          aria-label={speed.moving ? `Travel speed ${speed.primary}` : 'Not moving'}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            padding: '4px 10px',
            borderRadius: 8,
            border: speed.moving
              ? '1px solid rgba(94, 234, 212, 0.45)'
              : '1px solid rgba(130, 138, 132, 0.35)',
            background: speed.moving ? 'rgba(4, 48, 42, 0.55)' : 'rgba(20, 24, 22, 0.65)',
            minWidth: isCompact ? 52 : 58,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: isCompact ? fontSm : fontMd,
              fontWeight: 800,
              letterSpacing: '0.04em',
              color: speed.moving ? '#7dffa8' : '#9ea7a0',
              lineHeight: 1.1,
            }}
          >
            {speed.primary}
          </span>
          <span
            style={{
              fontSize: Math.max(9, fontSm - 2),
              color: '#7a827a',
              letterSpacing: '0.08em',
              lineHeight: 1.2,
            }}
          >
            {gpsUi === 'locked' ? speed.secondary : 'GPS…'}
          </span>
        </div>
        <button
          type="button"
          onClick={locateMe}
          disabled={!hasFix}
          aria-label={hasFix ? 'Center map on live GPS' : 'Waiting for GPS fix'}
          title={hasFix ? 'Center map on live GPS' : 'Waiting for GPS fix'}
          style={{
            minHeight: tapMin,
            minWidth: isCompact ? tapMin : undefined,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: isCompact ? '0 10px' : '0 12px',
            borderRadius: 8,
            border: hasFix ? '1px solid rgba(125,255,138,0.55)' : '1px solid rgba(130,138,132,0.4)',
            background: hasFix ? 'rgba(125,255,138,0.12)' : 'rgba(60,66,62,0.32)',
            color: hasFix ? '#b8f7c1' : '#8e9992',
            cursor: hasFix ? 'pointer' : 'not-allowed',
            letterSpacing: '0.08em',
            fontSize: fontSm,
            fontWeight: 700,
            fontFamily: 'var(--font-ui, system-ui)',
          }}
        >
          <LocateIcon />
          {!isCompact && <span>LOCATE</span>}
        </button>
      </div>
    </div>
  )
}
