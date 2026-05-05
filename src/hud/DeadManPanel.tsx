/**
 * DeadManPanel.tsx
 * Drop-in replacement for your existing DeadManPanel.
 * Matches your exact HudPanel / CSS-var style.
 * NEW vs old:
 *   - Timer shows HH:MM:SS (was MM:SS)
 *   - ACTIVATE button when timer not yet running
 *   - +1 HR extend button (disabled after first use per cycle)
 *   - Critical state (≤15 min) pulses amber
 *   - Progress bar based on full 4-hour window
 */

import React, { useEffect, useRef } from 'react'
import HudPanel from './HudPanel'
import { useDeadMan } from '../hooks/useDeadMan'

export default function DeadManPanel() {
  const {
    formattedTime, remainingMs, isExpired, isCritical, isWarning,
    hasExtended, isActive, reset, extend, activate,
  } = useDeadMan()

  const FULL_MS = 4 * 60 * 60 * 1000

  const accent = isExpired
    ? '#ff3b3b'
    : isCritical
    ? '#ff8c00'
    : isWarning
    ? '#ffcc00'
    : '#00ffb4'

  const pct = isActive ? Math.max(0, remainingMs / FULL_MS) : 1

  // Pulse animation ref for critical state
  const pulseRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = pulseRef.current
    if (!el) return
    if (isCritical || isExpired) {
      el.style.animation = 'deadman-pulse 1s ease-in-out infinite'
    } else {
      el.style.animation = 'none'
    }
  }, [isCritical, isExpired])

  return (
    <>
      {/* Inject keyframe once */}
      <style>{`
        @keyframes deadman-pulse {
          0%, 100% { box-shadow: 0 0 0px transparent; }
          50%       { box-shadow: 0 0 18px ${accent}99; }
        }
      `}</style>

      <HudPanel
        title="Dead Man Switch"
        initialPos={{ x: 16, y: 590 }}
        initialWidth={220}
        accent={accent}
      >
        <div ref={pulseRef} style={{ fontFamily: 'var(--font-mono)', borderRadius: 4 }}>

          {/* ── Big clock ── */}
          <div
            style={{
              textAlign: 'center',
              fontSize: 28,
              letterSpacing: '0.1em',
              color: accent,
              fontWeight: 'bold',
              padding: '8px 0 4px',
              textShadow: `0 0 20px ${accent}88`,
            }}
          >
            {formattedTime}
          </div>

          {/* ── Progress bar ── */}
          <div
            style={{
              height: 4,
              background: 'rgba(200,230,216,0.08)',
              borderRadius: 2,
              overflow: 'hidden',
              margin: '6px 0',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${pct * 100}%`,
                background: accent,
                borderRadius: 2,
                transition: 'width 1s linear',
                boxShadow: `0 0 8px ${accent}`,
              }}
            />
          </div>

          {/* ── Status label ── */}
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.12em',
              color: isExpired ? '#ff3b3b' : `${accent}99`,
              textAlign: 'center',
              marginBottom: 10,
            }}
          >
            {isExpired   ? '⚠ TIMER EXPIRED ⚠' :
             isCritical  ? '⚠ CRITICAL — CHECK IN NOW' :
             isWarning   ? '◉ WARNING' :
             isActive    ? '● NOMINAL' :
                           '○ STANDBY'}
          </div>

          {/* ── Buttons ── */}
          {!isActive ? (
            <button
              onClick={e => { e.stopPropagation(); activate() }}
              style={btnStyle('#00ffb4')}
            >
              ACTIVATE
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                onClick={e => { e.stopPropagation(); reset() }}
                style={btnStyle(accent)}
              >
                RESET TIMER
              </button>

              <button
                onClick={e => { e.stopPropagation(); extend() }}
                disabled={hasExtended}
                style={{
                  ...btnStyle('#ffcc00'),
                  opacity: hasExtended ? 0.35 : 1,
                  cursor: hasExtended ? 'not-allowed' : 'pointer',
                }}
              >
                {hasExtended ? '+1 HR (USED)' : '+1 HR EXTEND'}
              </button>
            </div>
          )}
        </div>
      </HudPanel>
    </>
  )
}

function btnStyle(color: string): React.CSSProperties {
  return {
    width: '100%',
    padding: '7px 0',
    background: `${color}18`,
    border: `1px solid ${color}55`,
    borderRadius: 2,
    color: color,
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
  }
}
