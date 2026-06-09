import React, { useCallback } from 'react'
import { useCockpitOptional } from '../context/CockpitContext'
import { useMapContext } from '../context/MapContext'
import { useHudPresentation } from '../context/HudPresentationContext'
import { useDeviceHeading, type DeviceHeadingState } from '../hooks/useDeviceHeading'
import { deriveGpsUiStatus, useGPS } from '../hooks/useGPS'
import { useTacticalProfile } from '../hooks/useTacticalProfile'
import { useTravelSpeed } from '../hooks/useTravelSpeed'
import { requestDeviceOrientationPermission } from '../lib/deviceHeading'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { requestCameraIntent } from '../lib/operationalPerception/perceptionEngine'
import ClassicCompass from './compass/ClassicCompass'
import BalancedCompass from './compass/BalancedCompass'
import ModernEnvironmentalCompass from './compass/ModernEnvironmentalCompass'
import { MODERN_MICRO_BAR, BALANCED_MICRO_BAR } from './modernMode/modernVisualTokens'
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

interface TopBarProps {
  /** Callback to open modern preflight wizard (Modern Mode only) */
  onOpenPreflight?: () => void
}

export default function TopBar({ onOpenPreflight }: TopBarProps = {}) {
  const { map } = useMapContext()
  const { raisePanel, updatePanel } = useCockpitOptional() ?? {
    raisePanel: () => {},
    updatePanel: () => {},
  }
  const { microStatusBar, mode } = useHudPresentation()
  const { operationalReady } = useTacticalProfile()
  const gps = useGPS()
  const gpsUi = deriveGpsUiStatus(gps)
  const { display: speed } = useTravelSpeed(
    gps.lat,
    gps.lng,
    gpsUi === 'locked',
    gps.accuracy,
  )
  const { heading, status, cardinal } = useDeviceHeading()
  const profile = getDeviceProfile()
  const isMobile = profile.interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const fontMd = touchFontMd(isMobile)
  const gapMd = touchGapMd(isMobile)
  const tapMin = touchMinTarget(isMobile)
  const isCompact = profile.width < 720 || profile.isCoarsePointer
  const hasFix = gps.lat != null && gps.lng != null
  const dialSize = isCompact ? 54 : 58
  const barHeight = microStatusBar ? 36 : topBarContentHeightPx()

  const enableCompass = useCallback(async () => {
    const result = await requestDeviceOrientationPermission()
    if (result === 'denied') {
      /* iOS Settings → Safari → Motion; user can retry tap */
    }
  }, [])

  const locateMe = useCallback(() => {
    if (!hasFix || gps.lng == null || gps.lat == null) return
    requestCameraIntent({
      kind: 'ease_to',
      center: [gps.lng, gps.lat],
      zoom: 14,
      durationMs: 750,
    })
  }, [hasFix, gps.lng, gps.lat])

  // Legacy preflight opener (Classic/Legacy modes only - NOT Balanced)
  const openLegacyPreflight = useCallback(() => {
    updatePanel('preflight', { docked: false, minimized: false })
    raisePanel('preflight')
  }, [raisePanel, updatePanel])

  // CRITICAL FIX: Balanced mode should NOT use Classic preflight (cross-layer contamination)
  // - Modern mode: use prop callback
  // - Classic/Legacy mode: use legacy opener
  // - Balanced mode (hybrid with microStatusBar): no-op (Balanced has its own UI)
  const handleOpenPreflight = useCallback(() => {
    if (onOpenPreflight && mode === 'immersive') {
      onOpenPreflight()
    } else if (mode === 'legacy') {
      // Only use Classic preflight in true Legacy mode, NOT in Balanced (hybrid)
      openLegacyPreflight()
    }
    if (mode === 'hybrid' && !operationalReady) {
      window.dispatchEvent(new CustomEvent('hud:show-permissions'))
    }
  }, [onOpenPreflight, mode, openLegacyPreflight, operationalReady])

  // Micro status bar for hybrid/immersive modes — distinct identity per layer
  if (microStatusBar) {
    if (mode === 'immersive') {
      return (
        <ModernMicroBar
          operationalReady={operationalReady}
          gpsUi={gpsUi}
          heading={heading}
          status={status}
          cardinal={cardinal}
          hasFix={hasFix}
          locateMe={locateMe}
          isCompact={isCompact}
          dialSize={isCompact ? 28 : 32}
        />
      )
    }
    return (
      <BalancedMicroBar
        operationalReady={operationalReady}
        gpsUi={gpsUi}
        speed={speed}
        heading={heading}
        status={status}
        cardinal={cardinal}
        hasFix={hasFix}
        locateMe={locateMe}
        fontSm={fontSm}
        tapMin={tapMin}
        isCompact={isCompact}
        dialSize={isCompact ? 32 : 36}
        gps={gps}
        openPreflight={handleOpenPreflight}
      />
    )
  }

  const preflightBorder = operationalReady
    ? 'rgba(125,255,138,0.55)'
    : 'rgba(251, 191, 36, 0.65)'
  const preflightGlow = operationalReady ? 'rgba(125,255,138,0.12)' : 'rgba(251, 191, 36, 0.14)'

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
        overflow: 'visible',
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
        <button
          type="button"
          onClick={handleOpenPreflight}
          aria-label={
            operationalReady
              ? 'Open preflight checklist — profile ready'
              : 'Open preflight checklist — setup incomplete'
          }
          title={operationalReady ? 'Preflight — ready' : 'Preflight — finish setup'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: isCompact ? '5px 9px' : '5px 11px',
            borderRadius: 7,
            border: `1px solid ${preflightBorder}`,
            background: preflightGlow,
            boxShadow: `inset 0 0 0 1px ${preflightGlow}`,
            flexShrink: 0,
            cursor: 'pointer',
            minHeight: tapMin,
            touchAction: 'manipulation',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: operationalReady ? '#7dffa8' : '#fbbf24',
              boxShadow: operationalReady ? '0 0 6px #7dffa866' : '0 0 6px #fbbf2466',
              flexShrink: 0,
            }}
          />
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
        </button>
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

      <div style={{ justifySelf: 'center', paddingBottom: 4, overflow: 'visible' }}>
        <ClassicCompass
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

// Modern micro bar — environment-first, minimal persistent chrome
function ModernMicroBar({
  operationalReady,
  gpsUi,
  heading,
  status,
  cardinal,
  hasFix,
  locateMe,
  isCompact,
  dialSize,
}: {
  operationalReady: boolean
  gpsUi: ReturnType<typeof deriveGpsUiStatus>
  heading: number | null
  status: DeviceHeadingState['status']
  cardinal: string
  hasFix: boolean
  locateMe: () => void
  isCompact: boolean
  dialSize: number
}) {
  const statusColor = operationalReady
    ? 'rgba(52, 199, 89, 0.75)'
    : gpsUi === 'searching'
      ? 'rgba(255, 149, 0, 0.75)'
      : 'rgba(255, 100, 100, 0.65)'

  return (
    <div
      className="micro-status-bar modern-micro-bar"
      data-modern-chrome="environment"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: MODERN_MICRO_BAR.height,
        zIndex: 200,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `calc(env(safe-area-inset-top, 0px) + 2px) ${isCompact ? 12 : 16}px 0`,
        background: MODERN_MICRO_BAR.background,
        borderBottom: MODERN_MICRO_BAR.border,
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: isCompact ? 12 : 16,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: statusColor,
          boxShadow: operationalReady ? `0 0 8px ${statusColor}` : undefined,
          pointerEvents: 'none',
        }}
        title={operationalReady ? 'System ready' : 'Setup incomplete'}
      />

      <div style={{ pointerEvents: 'auto' }}>
        <ModernEnvironmentalCompass
          heading={heading}
          status={status}
          cardinal={cardinal}
          size={dialSize}
        />
      </div>

      {hasFix && (
        <button
          type="button"
          onClick={locateMe}
          aria-label="Center map on GPS"
          style={{
            position: 'absolute',
            right: isCompact ? 12 : 16,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(255, 255, 255, 0.08)',
            color: 'rgba(255, 255, 255, 0.65)',
            cursor: 'pointer',
            pointerEvents: 'auto',
            touchAction: 'manipulation',
          }}
        >
          <LocateIcon />
        </button>
      )}
    </div>
  )
}

// Balanced micro bar — operational workspace strip
function BalancedMicroBar({
  operationalReady,
  gpsUi,
  speed,
  heading,
  status,
  cardinal,
  hasFix,
  locateMe,
  fontSm,
  tapMin,
  isCompact,
  dialSize,
  gps,
  openPreflight,
}: {
  operationalReady: boolean
  gpsUi: ReturnType<typeof deriveGpsUiStatus>
  speed: { primary: string; secondary: string; moving: boolean }
  heading: number | null
  status: DeviceHeadingState['status']
  cardinal: string
  hasFix: boolean
  locateMe: () => void
  fontSm: number
  tapMin: number
  isCompact: boolean
  dialSize: number
  gps: ReturnType<typeof useGPS>
  openPreflight: () => void
}) {
  const statusColor = operationalReady
    ? 'rgba(125,255,138,0.8)'
    : gpsUi === 'searching'
      ? 'rgba(251, 191, 36, 0.8)'
      : 'rgba(255, 100, 100, 0.8)'

  return (
    <div
      className="micro-status-bar balanced-micro-bar"
      data-balanced-chrome="operational"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: BALANCED_MICRO_BAR.height,
        zIndex: 200,
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `calc(env(safe-area-inset-top, 0px) + 4px) ${isCompact ? 10 : 14}px 0`,
        background: BALANCED_MICRO_BAR.background,
        borderBottom: BALANCED_MICRO_BAR.border,
        backdropFilter: 'blur(10px)',
        boxShadow: '0 2px 12px rgba(0, 0, 0, 0.25)',
      }}
    >
      {/* Left: GPS + Mission status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={openPreflight}
          aria-label={operationalReady ? 'System ready' : 'System not ready'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 8px',
            borderRadius: 4,
            border: `1px solid ${statusColor}`,
            background: `${statusColor.replace('0.8', '0.12')}`,
            cursor: 'pointer',
            minHeight: tapMin - 8,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: statusColor,
            }}
          />
          <span
            style={{
              fontSize: fontSm - 1,
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: operationalReady ? '#b8f7c1' : '#e8d5b5',
              fontFamily: 'var(--font-ui, system-ui)',
            }}
          >
            {operationalReady ? 'READY' : gpsUi === 'searching' ? 'GPS…' : 'SETUP'}
          </span>
        </button>

        {/* GPS Accuracy micro-indicator */}
        {gpsUi === 'locked' && gps.accuracy != null && (
          <span
            style={{
              fontSize: fontSm - 2,
              color: 'rgba(185, 212, 221, 0.6)',
              fontFamily: 'var(--font-mono, monospace)',
              letterSpacing: '0.02em',
            }}
          >
            ±{Math.round(gps.accuracy)}m
          </span>
        )}
      </div>

      {/* Center: Minimal compass dial */}
      <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
        <BalancedCompass
          heading={heading}
          status={status}
          cardinal={cardinal}
          size={dialSize}
        />
      </div>

      {/* Right: Speed + Locate */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {/* Speed micro-display */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 3,
            padding: '2px 8px',
            borderRadius: 4,
            background: speed.moving
              ? 'rgba(94, 234, 212, 0.08)'
              : 'transparent',
          }}
        >
          <span
            style={{
              fontSize: fontSm + 1,
              fontWeight: 700,
              color: speed.moving ? '#7dffa8' : 'rgba(158, 167, 160, 0.7)',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            {speed.primary}
          </span>
          <span
            style={{
              fontSize: fontSm - 2,
              color: 'rgba(122, 130, 122, 0.6)',
            }}
          >
            {speed.secondary}
          </span>
        </div>

        {/* Locate button - compact */}
        <button
          type="button"
          onClick={locateMe}
          disabled={!hasFix}
          aria-label={hasFix ? 'Center map' : 'No GPS'}
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            border: hasFix
              ? '1px solid rgba(125,255,138,0.4)'
              : '1px solid rgba(130,138,132,0.25)',
            background: hasFix
              ? 'rgba(125,255,138,0.08)'
              : 'rgba(60,66,62,0.2)',
            color: hasFix ? '#b8f7c1' : '#6a726a',
            cursor: hasFix ? 'pointer' : 'not-allowed',
          }}
        >
          <LocateIcon />
        </button>
      </div>
    </div>
  )
}
