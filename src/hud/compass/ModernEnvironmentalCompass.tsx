import React, { useMemo } from 'react'
import { MODERN_COMPASS } from '../modernMode/modernVisualTokens'
import { buildCompassAriaLabel, type CompassBaseProps } from './compassShared'

/**
 * Modern layer compass — spatial, ambient, map-integrated.
 * No widget chrome; arc ring only. Lives in the 28px environmental strip.
 */
export default function ModernEnvironmentalCompass({
  heading,
  status,
  cardinal,
  size = 32,
  onRequestPermission,
}: CompassBaseProps) {
  const active = status === 'active' && heading != null
  const rotation = active ? -heading : 0
  const needsPermission = status === 'unavailable' && Boolean(onRequestPermission)

  const ariaLabel = useMemo(
    () => buildCompassAriaLabel(status, heading, cardinal, needsPermission),
    [cardinal, heading, needsPermission, status],
  )

  const cardinalDisplay = active ? cardinal : status === 'level' ? '—' : '•'
  const showHeading = active && heading != null

  return (
    <button
      type="button"
      data-compass-layer="modern"
      data-testid="modern-compass"
      onClick={needsPermission ? onRequestPermission : undefined}
      disabled={!needsPermission}
      aria-label={ariaLabel}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: 'none',
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: needsPermission ? 'pointer' : 'default',
        position: 'relative',
        padding: 0,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          transform: `rotate(${rotation}deg)`,
          transition: active ? 'transform 0.2s ease-out' : undefined,
        }}
      >
        <circle
          cx="16"
          cy="16"
          r="13"
          fill="none"
          stroke={active ? MODERN_COMPASS.ringActive : MODERN_COMPASS.ring}
          strokeWidth="1"
          strokeDasharray={active ? undefined : '2 4'}
        />
        <line
          x1="16"
          y1="4"
          x2="16"
          y2="8"
          stroke={MODERN_COMPASS.north}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span
        style={{
          fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
          fontSize: Math.max(8, size * 0.32),
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: active ? MODERN_COMPASS.text : MODERN_COMPASS.textMuted,
          lineHeight: 1,
          zIndex: 1,
        }}
      >
        {showHeading ? `${Math.round(heading!)}°` : cardinalDisplay}
      </span>
    </button>
  )
}
