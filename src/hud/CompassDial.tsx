import React, { useMemo } from 'react'
import type { CompassStatus } from '../lib/deviceHeading'

type CompassDialProps = {
  heading: number | null
  status: CompassStatus
  cardinal: string
  size?: number
  onRequestPermission?: () => void
}

const ACTIVE = '#7dffa8'
const TICK = '#5eead4'
const MUTED = '#8a948c'
const NORTH = '#f0fff4'
const CARD = 'rgba(6, 10, 9, 0.96)'

export default function CompassDial({
  heading,
  status,
  cardinal,
  size = 56,
  onRequestPermission,
}: CompassDialProps) {
  const active = status === 'active' && heading != null
  const rotation = active ? -heading : 0
  const ringColor = active ? ACTIVE : status === 'level' ? '#b8c4b8' : MUTED
  const needsPermission = status === 'unavailable' && Boolean(onRequestPermission)

  const ariaLabel = useMemo(() => {
    if (status === 'unavailable') {
      return needsPermission ? 'Compass — tap to enable' : 'Compass unavailable'
    }
    if (status === 'level') return 'Compass paused — hold phone upright'
    if (heading == null) return 'Compass calibrating'
    return `Heading ${Math.round(heading)} degrees ${cardinal}`
  }, [cardinal, heading, needsPermission, status])

  const degreeLabel =
    active && heading != null ? `${Math.round(heading)}°` : status === 'level' ? 'LEVEL' : '—'

  const inner = size - 10
  const labelSize = Math.max(13, Math.round(size * 0.28))

  return (
    <button
      type="button"
      onClick={needsPermission ? onRequestPermission : undefined}
      disabled={!needsPermission}
      aria-label={ariaLabel}
      title={ariaLabel}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: needsPermission ? 'pointer' : 'default',
        flexShrink: 0,
        minWidth: size,
        overflow: 'visible',
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: CARD,
          border: `2px solid ${ringColor}`,
          boxShadow: active
            ? '0 0 0 1px rgba(125,255,138,0.35), 0 6px 18px rgba(0,0,0,0.55)'
            : '0 2px 12px rgba(0,0,0,0.45)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 2,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderBottom: `9px solid ${active ? NORTH : MUTED}`,
            zIndex: 4,
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))',
          }}
        />

        <svg
          width={inner}
          height={inner}
          viewBox="0 0 48 48"
          aria-hidden
          style={{
            display: 'block',
            margin: 5,
            transform: `rotate(${rotation}deg)`,
            transition: active ? 'transform 520ms ease-out' : undefined,
          }}
        >
          <circle cx="24" cy="24" r="21" fill="rgba(125,255,138,0.05)" stroke="rgba(125,255,138,0.25)" strokeWidth="0.8" />
          {Array.from({ length: 12 }, (_, i) => i * 30).map((deg) => (
            <line
              key={deg}
              x1="24"
              y1={deg % 90 === 0 ? 5 : 7}
              x2="24"
              y2={deg % 90 === 0 ? 10 : 9}
              stroke={deg === 0 ? NORTH : TICK}
              strokeWidth={deg % 90 === 0 ? 1.6 : 0.8}
              opacity={deg === 0 ? 1 : 0.75}
              transform={`rotate(${deg} 24 24)`}
            />
          ))}
          <text x="24" y="13" textAnchor="middle" fontSize="7" fontWeight="800" fill={NORTH} fontFamily="system-ui">
            N
          </text>
          <text x="24" y="44" textAnchor="middle" fontSize="6" fontWeight="700" fill={TICK} opacity="0.9" fontFamily="system-ui">
            S
          </text>
          <text x="8" y="27" textAnchor="middle" fontSize="6" fontWeight="700" fill={TICK} opacity="0.9" fontFamily="system-ui">
            W
          </text>
          <text x="40" y="27" textAnchor="middle" fontSize="6" fontWeight="700" fill={TICK} opacity="0.9" fontFamily="system-ui">
            E
          </text>
          <circle cx="24" cy="24" r="1.5" fill={active ? TICK : MUTED} />
        </svg>

        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              fontSize: labelSize,
              fontWeight: 800,
              letterSpacing: '0.04em',
              color: active ? NORTH : '#c5cdc6',
              textShadow: '0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.75)',
              lineHeight: 1,
              marginTop: 4,
            }}
          >
            {degreeLabel}
          </span>
        </div>
      </div>
      <span
        aria-hidden
        style={{
          fontFamily: 'var(--font-ui, system-ui)',
          fontSize: Math.max(10, size * 0.22),
          fontWeight: 800,
          letterSpacing: '0.16em',
          color: active ? TICK : MUTED,
          lineHeight: 1.2,
          padding: '2px 8px',
          borderRadius: 4,
          background: 'rgba(6, 10, 9, 0.92)',
          border: `1px solid ${active ? 'rgba(125,255,138,0.35)' : 'rgba(199,206,198,0.15)'}`,
          textShadow: '0 1px 2px rgba(0,0,0,0.9)',
        }}
      >
        {cardinal}
      </span>
    </button>
  )
}
