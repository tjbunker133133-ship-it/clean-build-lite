import React, { useMemo } from 'react'
import { buildCompassAriaLabel, type CompassBaseProps } from './compassShared'

const ACTIVE = '#7dffa8'
const NORTH = '#f0fff4'
const MUTED = '#8a948c'

/**
 * Balanced layer compass — operational toolbar dial.
 * Structured, minimal, integrated into the 40px operational micro bar.
 */
export default function BalancedCompass({
  heading,
  status,
  cardinal,
  size = 36,
  onRequestPermission,
}: CompassBaseProps) {
  const active = status === 'active' && heading != null
  const rotation = active ? -heading : 0
  const ringColor = active ? ACTIVE : status === 'level' ? '#b8c4b8' : MUTED
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
      data-compass-layer="balanced"
      data-testid="balanced-compass"
      onClick={needsPermission ? onRequestPermission : undefined}
      disabled={!needsPermission}
      aria-label={ariaLabel}
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        border: `1.5px solid ${ringColor}`,
        background: 'rgba(6, 10, 9, 0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: needsPermission ? 'pointer' : 'default',
        position: 'relative',
        padding: 0,
        boxShadow: 'inset 0 0 0 1px rgba(125, 255, 138, 0.08)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 2,
          borderRadius: 4,
          transform: `rotate(${rotation}deg)`,
          transition: active ? 'transform 0.15s linear' : undefined,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 3,
            height: 3,
            borderRadius: '50%',
            background: NORTH,
          }}
        />
      </div>

      <span
        style={{
          fontFamily: 'var(--font-ui, system-ui)',
          fontSize: Math.max(9, size * 0.38),
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: active ? ACTIVE : MUTED,
          lineHeight: 1,
        }}
      >
        {cardinalDisplay}
      </span>

      {showHeading && (
        <span
          style={{
            position: 'absolute',
            bottom: 3,
            fontSize: Math.max(7, size * 0.22),
            fontFamily: 'var(--font-mono, monospace)',
            color: 'rgba(185, 212, 221, 0.6)',
            letterSpacing: '0.02em',
          }}
        >
          {Math.round(heading)}°
        </span>
      )}
    </button>
  )
}
