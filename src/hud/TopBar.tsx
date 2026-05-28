import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useMapContext } from '../context/MapContext'
import { useGPS } from '../hooks/useGPS'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchFontMd, touchGapMd, touchMinTarget } from './tokens'

function normalizeHeading(value: number): number {
  const n = value % 360
  return n < 0 ? n + 360 : n
}

function headingToCardinal(heading: number): string {
  const idx = Math.round(heading / 45) % 8
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][idx]
}

export default function TopBar() {
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
  const [heading, setHeading] = useState<number | null>(null)
  const [compassAvailable, setCompassAvailable] = useState(false)
  const lastHeadingRef = useRef<number | null>(null)
  const lastPublishRef = useRef(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let mounted = true
    let fallbackTimer: number | null = null

    const publishHeading = (rawHeading: number | null) => {
      if (!mounted) return
      if (rawHeading == null || !Number.isFinite(rawHeading)) return
      const normalized = normalizeHeading(rawHeading)
      const last = lastHeadingRef.current
      const now = performance.now()
      // Throttle micro-jitter to avoid noisy rerenders on mobile sensors.
      if (last != null && Math.abs(last - normalized) < 2 && now - lastPublishRef.current < 250) return
      lastHeadingRef.current = normalized
      lastPublishRef.current = now
      setHeading(normalized)
      setCompassAvailable(true)
    }

    const onOrientation = (event: DeviceOrientationEvent) => {
      // iOS Safari uses webkitCompassHeading; other browsers typically provide alpha.
      const webkitHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
        .webkitCompassHeading
      if (typeof webkitHeading === 'number' && Number.isFinite(webkitHeading)) {
        publishHeading(webkitHeading)
        return
      }
      if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
        publishHeading(360 - event.alpha)
      }
    }

    window.addEventListener('deviceorientationabsolute', onOrientation as EventListener, { passive: true })
    window.addEventListener('deviceorientation', onOrientation as EventListener, { passive: true })
    fallbackTimer = window.setTimeout(() => {
      if (!mounted || lastHeadingRef.current != null) return
      setCompassAvailable(false)
      setHeading(null)
    }, 1500)

    return () => {
      mounted = false
      window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener)
      window.removeEventListener('deviceorientation', onOrientation as EventListener)
      if (fallbackTimer != null) window.clearTimeout(fallbackTimer)
    }
  }, [])

  const headingLabel = useMemo(() => {
    if (!compassAvailable || heading == null) return 'HDG --'
    return `HDG ${Math.round(heading)
      .toString()
      .padStart(3, '0')} ${headingToCardinal(heading)}`
  }, [compassAvailable, heading])

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
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        padding: `calc(env(safe-area-inset-top, 0px) + 2px) ${isCompact ? 12 : 16}px 0 ${isCompact ? 12 : 16}px`,
        background: isMobile ? 'rgba(10, 12, 13, 0.96)' : 'rgba(10, 12, 13, 0.9)',
        borderBottom: '1px solid rgba(199, 206, 198, 0.22)',
        backdropFilter: isMobile ? undefined : 'blur(12px)',
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
          textShadow: '0 0 8px rgba(199,206,198,0.18)',
        }}
      >
        SIGNAL ONE HUD
        {!isCompact && profile.interactionMode === 'desktop' && !profile.isIOS && (
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
        aria-live="polite"
        style={{
          justifySelf: 'center',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: isCompact ? fontSm : fontMd,
          color: compassAvailable ? '#b8c1b9' : '#8f9891',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
        title={compassAvailable ? 'Device heading' : 'Compass unavailable on this device/browser'}
      >
        {headingLabel}
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
          justifySelf: 'end',
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
      </div>
    </div>
  )
}
