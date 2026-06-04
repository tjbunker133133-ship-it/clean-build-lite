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
const MUTED = '#6b756e'
const NORTH = '#e8fff0'
const CARD = 'rgba(8, 14, 12, 0.92)'

export default function CompassDial({
  heading,
  status,
  cardinal,
  size = 48,
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

  const inner = size - 8

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
        gap: 2,
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: needsPermission ? 'pointer' : 'default',
        flexShrink: 0,
        minWidth: size,
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
            ? '0 0 0 1px rgba(125,255,138,0.25), 0 4px 14px rgba(0,0,0,0.45)'
            : '0 2px 10px rgba(0,0,0,0.35)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Fixed lubber line (heading reference at top of phone) */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 3,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderBottom: `8px solid ${active ? NORTH : MUTED}`,
            zIndex: 3,
          }}
        />

        <svg
          width={inner}
          height={inner}
          viewBox="0 0 48 48"
          aria-hidden
          style={{
            display: 'block',
            margin: 4,
            transform: `rotate(${rotation}deg)`,
            transition: active ? 'transform 280ms ease-out' : undefined,
          }}
        >
          <circle cx="24" cy="24" r="21" fill="rgba(125,255,138,0.04)" stroke="rgba(125,255,138,0.2)" strokeWidth="0.6" />
          {Array.from({ length: 12 }, (_, i) => i * 30).map((deg) => (
            <line
              key={deg}
              x1="24"
              y1={deg % 90 === 0 ? 5 : 7}
              x2="24"
              y2={deg % 90 === 0 ? 10 : 9}
              stroke={deg === 0 ? NORTH : TICK}
              strokeWidth={deg % 90 === 0 ? 1.6 : 0.8}
              opacity={deg === 0 ? 1 : 0.7}
              transform={`rotate(${deg} 24 24)`}
            />
          ))}
          <text x="24" y="14" textAnchor="middle" fontSize="7" fontWeight="800" fill={NORTH} fontFamily="system-ui">
            N
          </text>
          <text x="24" y="44" textAnchor="middle" fontSize="6" fontWeight="700" fill={TICK} opacity="0.85" fontFamily="system-ui">
            S
          </text>
          <text x="8" y="27" textAnchor="middle" fontSize="6" fontWeight="700" fill={TICK} opacity="0.85" fontFamily="system-ui">
            W
          </text>
          <text x="40" y="27" textAnchor="middle" fontSize="6" fontWeight="700" fill={TICK} opacity="0.85" fontFamily="system-ui">
            E
          </text>
          <circle cx="24" cy="24" r="1.5" fill={active ? TICK : MUTED} />
          {status === 'level' && (
            <text x="24" y="28" textAnchor="middle" fontSize="5" fill="#9ca89f" fontFamily="system-ui">
              TILT
            </text>
          )}
        </svg>
      </div>
      <span
        style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: Math.max(11, size * 0.26),
          fontWeight: 800,
          letterSpacing: '0.06em',
          color: active ? NORTH : '#9ea7a0',
          lineHeight: 1,
        }}
      >
        {degreeLabel}
      </span>
      <span
        aria-hidden
        style={{
          fontFamily: 'var(--font-ui, system-ui)',
          fontSize: Math.max(9, size * 0.2),
          fontWeight: 700,
          letterSpacing: '0.14em',
          color: active ? TICK : MUTED,
          lineHeight: 1,
        }}
      >
        {cardinal}
      </span>
    </button>
  )
}
