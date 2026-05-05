import React from 'react'
import { useCockpit } from '../context/CockpitContext'

export default function TopBar() {
  const { prefs } = useCockpit()
  const isCompact =
    typeof window !== 'undefined' &&
    (window.matchMedia('(max-width: 720px)').matches || window.matchMedia('(pointer: coarse)').matches)

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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `calc(env(safe-area-inset-top, 0px) + 2px) ${isCompact ? 12 : 16}px 0 ${isCompact ? 12 : 16}px`,
        background: 'rgba(10, 12, 13, 0.9)',
        borderBottom: '1px solid rgba(199, 206, 198, 0.22)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 30px rgba(0, 0, 0, 0.35)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontFamily: 'var(--font-ui)',
          fontWeight: 700,
          fontSize: isCompact ? 11 : 12,
          letterSpacing: '0.18em',
          color: '#c7cec6',
          textShadow: '0 0 10px rgba(199,206,198,0.25)',
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#c7cec6',
            boxShadow: '0 0 8px rgba(199,206,198,0.65)',
          }}
        />
        NIGHTFORCE
        {!isCompact && (
          <span
            style={{
              fontSize: 9,
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

      <div />

      <div
        style={{
          fontFamily: 'var(--font-ui, system-ui)',
          fontSize: isCompact ? 9 : 10,
          color: '#9ea7a0',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        {prefs.screen_hue.replace('_', ' ')}
      </div>
    </div>
  )
}
