import React, { useMemo } from 'react'
import type { CompassStatus } from '../lib/deviceHeading'

type CompassDialProps = {
  heading: number | null
  status: CompassStatus
  cardinal: string
  size?: number
}

const RING = '#7dffa8'
const TICK = '#5eead4'
const MUTED = '#6b756e'
const NORTH = '#b8f7c1'

export default function CompassDial({ heading, status, cardinal, size = 40 }: CompassDialProps) {
  const active = status === 'active' && heading != null
  const rotation = active ? -heading : 0
  const ringColor = active ? RING : status === 'level' ? '#9ca89f' : MUTED
  const ariaLabel = useMemo(() => {
    if (status === 'unavailable') return 'Compass unavailable'
    if (status === 'level') return 'Compass paused — level the device'
    if (heading == null) return 'Compass waiting'
    return `Heading ${Math.round(heading)} degrees ${cardinal}`
  }, [cardinal, heading, status])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: size,
        flexShrink: 0,
      }}
    >
      <div
        role="img"
        aria-label={ariaLabel}
        title={ariaLabel}
        style={{
          width: size,
          height: size,
          position: 'relative',
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 40 40"
          aria-hidden
          style={{ display: 'block' }}
        >
          <circle
            cx="20"
            cy="20"
            r="17.5"
            fill="rgba(125,255,138,0.05)"
            stroke={ringColor}
            strokeWidth="1"
            opacity={active ? 1 : 0.72}
          />
          <circle cx="20" cy="20" r="1.2" fill={active ? TICK : MUTED} />

          <g
            transform={`rotate(${rotation} 20 20)`}
            style={{
              transition: active ? 'transform 320ms ease-out' : undefined,
            }}
          >
            {[0, 90, 180, 270].map((deg) => (
              <line
                key={deg}
                x1="20"
                y1="5.5"
                x2="20"
                y2={deg % 180 === 0 ? 8.5 : 7.5}
                stroke={deg === 0 ? NORTH : TICK}
                strokeWidth={deg === 0 ? 1.4 : 0.9}
                opacity={deg === 0 ? 1 : 0.75}
                transform={`rotate(${deg} 20 20)`}
              />
            ))}
            <text
              x="20"
              y="11.5"
              textAnchor="middle"
              fontSize="5.5"
              fontWeight="700"
              fill={NORTH}
              fontFamily="var(--font-ui, system-ui)"
            >
              N
            </text>
          </g>

          <polygon
            points="20,6 18.2,11 21.8,11"
            fill={active ? NORTH : MUTED}
            opacity={active ? 0.95 : 0.55}
          />

          {status === 'level' && (
            <line
              x1="11"
              y1="29"
              x2="29"
              y2="29"
              stroke="#9ca89f"
              strokeWidth="1"
              strokeDasharray="2 2"
              opacity="0.85"
            />
          )}
        </svg>
      </div>
      <span
        aria-hidden
        style={{
          marginTop: 2,
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 9,
          letterSpacing: '0.14em',
          color: active ? TICK : MUTED,
          lineHeight: 1,
          minWidth: 16,
          textAlign: 'center',
        }}
      >
        {cardinal}
      </span>
    </div>
  )
}
