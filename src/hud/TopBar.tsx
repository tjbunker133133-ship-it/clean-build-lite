import React, { useEffect, useState } from 'react'

function Clock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <span>
      {time.toUTCString().replace('GMT', 'Z').split(' ').slice(4).join(' ')}
    </span>
  )
}

export default function TopBar() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 36,
        zIndex: 200,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        background: 'linear-gradient(180deg, rgba(8,14,20,0.95) 0%, transparent 100%)',
        borderBottom: '1px solid rgba(0,255,180,0.1)',
      }}
    >
      {/* Left: System label */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'var(--font-ui)',
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: '0.2em',
          color: 'rgba(0,255,180,0.8)',
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#00ffb4',
            boxShadow: '0 0 10px #00ffb4',
            animation: 'pulse 2s infinite',
          }}
        />
        TACTICAL HUD
        <span
          style={{
            fontSize: 9,
            color: 'rgba(0,255,180,0.4)',
            letterSpacing: '0.15em',
            fontWeight: 400,
          }}
        >
          TIER-1
        </span>
      </div>

      {/* Center: decorative brackets */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'rgba(0,255,180,0.25)',
          letterSpacing: '0.4em',
          display: 'flex',
          gap: 4,
        }}
      >
        {'[ ◈ ◈ ◈ ]'}
      </div>

      {/* Right: clock */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'rgba(0,255,180,0.5)',
          letterSpacing: '0.06em',
        }}
      >
        <Clock />
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
