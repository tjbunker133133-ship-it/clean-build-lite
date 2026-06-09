/**
 * Modern TopBar — cockpit-free status chrome for immersive runtime.
 */

import React, { useCallback } from 'react'
import { useMapContext } from '../../context/MapContext'
import { useDeviceHeading, type DeviceHeadingState } from '../../hooks/useDeviceHeading'
import { deriveGpsUiStatus, useGPS } from '../../hooks/useGPS'
import { useTacticalProfile } from '../../hooks/useTacticalProfile'
import { requestCameraIntent } from '../../lib/operationalPerception/perceptionEngine'
import ModernEnvironmentalCompass from '../compass/ModernEnvironmentalCompass'
import { MODERN_MICRO_BAR } from './modernVisualTokens'

function LocateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  )
}

export default function ModernTopBar() {
  const gps = useGPS()
  const gpsUi = deriveGpsUiStatus(gps)
  const { operationalReady } = useTacticalProfile()
  const { heading, status, cardinal } = useDeviceHeading()
  const hasFix = gps.lat != null && gps.lng != null
  const isCompact = typeof window !== 'undefined' && window.innerWidth < 720

  const locateMe = useCallback(() => {
    if (!hasFix || gps.lng == null || gps.lat == null) return
    requestCameraIntent({
      kind: 'ease_to',
      center: [gps.lng, gps.lat],
      zoom: 14,
      durationMs: 750,
    })
  }, [hasFix, gps.lng, gps.lat])

  const statusColor = operationalReady
    ? 'rgba(52, 199, 89, 0.75)'
    : gpsUi === 'searching'
      ? 'rgba(255, 149, 0, 0.75)'
      : 'rgba(255, 100, 100, 0.65)'

  const dialSize = isCompact ? 28 : 32

  return (
    <div
      className="micro-status-bar modern-micro-bar"
      data-modern-chrome="environment"
      data-testid="modern-top-bar"
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
          status={status as DeviceHeadingState['status']}
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
