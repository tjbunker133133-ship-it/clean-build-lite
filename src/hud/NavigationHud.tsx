import React from 'react'
import { useAppContext } from '../context/AppContext'
import { useNavigationMonitor } from '../hooks/useNavigationMonitor'
import { useTrailInspect } from '../hooks/useTrailInspect'
import { getDeviceProfile } from '../runtime/deviceProfile'
import TrailInspectCard from './TrailInspectCard'
import FieldStatusRail from './FieldStatusRail'
import { mapBannerTopCss } from './hudLayout'
import { touchFontSm, touchMinTarget } from './tokens'

export default function NavigationHud() {
  const { confirmWaypointArrival, state } = useAppContext()
  const { activeLayer } = state
  const nav = useNavigationMonitor()
  const trailInspect = useTrailInspect()
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const tapMin = touchMinTarget(isMobile)

  const hasNext = nav.activeWaypointLabel != null

  return (
    <>
      <FieldStatusRail />
      {hasNext && (
        <div
          style={{
            position: 'absolute',
            top: mapBannerTopCss(),
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 210,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            maxWidth: 'min(92vw, 420px)',
          }}
        >
          <div
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              background: 'rgba(8, 12, 14, 0.88)',
              border: '1px solid rgba(125, 255, 138, 0.45)',
              color: '#d1fae5',
              fontSize: fontSm,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textAlign: 'center',
              boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
            }}
          >
            <span style={{ color: '#9ea7a0', marginRight: 8 }}>NEXT</span>
            {nav.activeWaypointLabel}
            <span style={{ color: '#7dffa8', marginLeft: 10 }}>{nav.activeDistanceLabel}</span>
            {nav.trailDistanceLabel && (
              <span style={{ color: '#5eead4', marginLeft: 8, fontSize: '0.92em' }}>
                trail {nav.trailDistanceLabel}
              </span>
            )}
          </div>
          {nav.gpsConfidence.unstable && (
            <div
              style={{
                fontSize: fontSm,
                color: '#fbbf24',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {nav.gpsConfidenceLabel}
            </div>
          )}
        </div>
      )}

      {nav.arrivalCandidate && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 220,
            pointerEvents: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            borderRadius: 12,
            background: 'rgba(8, 18, 24, 0.94)',
            border: '1px solid rgba(34, 211, 238, 0.55)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
            maxWidth: 'min(92vw, 360px)',
          }}
        >
          <div
            style={{
              fontSize: fontSm,
              color: '#a5f3fc',
              letterSpacing: '0.06em',
              textAlign: 'center',
            }}
          >
            Arrival candidate — {Math.round(nav.arrivalCandidate.distanceFeet)} ft from{' '}
            <strong>{nav.arrivalCandidate.waypoint.label}</strong>
          </div>
          <button
            type="button"
            onClick={confirmWaypointArrival}
            style={{
              minHeight: tapMin,
              padding: '10px 20px',
              borderRadius: 10,
              border: '2px solid #22d3ee',
              background: 'linear-gradient(180deg, #0e7490, #155e75)',
              color: '#fff',
              fontWeight: 800,
              fontSize: fontSm,
              letterSpacing: '0.1em',
              cursor: 'pointer',
              width: '100%',
            }}
          >
            CONFIRM ARRIVAL
          </button>
        </div>
      )}

      {trailInspect.selection && (
        <TrailInspectCard result={trailInspect.selection} onDismiss={trailInspect.dismiss} />
      )}

      {!trailInspect.maptilerConfigured && activeLayer === 'outdoor' && (
        <div
          style={{
            position: 'absolute',
            top: mapBannerTopCss(),
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 216,
            pointerEvents: 'none',
            padding: '8px 14px',
            borderRadius: 8,
            background: 'rgba(40, 24, 8, 0.92)',
            border: '1px solid rgba(251, 191, 36, 0.5)',
            color: '#fde68a',
            fontSize: fontSm,
            maxWidth: 'min(92vw, 420px)',
            textAlign: 'center',
          }}
        >
          MapTiler key missing — trails unavailable. Add VITE_MAPTILER_KEY to .env.local and restart dev.
        </div>
      )}

      {trailInspect.missHint && !trailInspect.selection && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 217,
            pointerEvents: 'none',
            padding: '8px 14px',
            borderRadius: 8,
            background: 'rgba(24, 20, 12, 0.92)',
            border: '1px solid rgba(251, 191, 36, 0.45)',
            color: '#fde68a',
            fontSize: fontSm,
            letterSpacing: '0.04em',
            maxWidth: 'min(92vw, 400px)',
            textAlign: 'center',
          }}
        >
          {trailInspect.missHint}
        </div>
      )}

    </>
  )
}
