import React from 'react'

export default function ScanlineOverlay() {
  return (
    <>
      {/* Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.45) 100%)',
        }}
      />
      {/* Corner brackets */}
      <div
        style={{
          position: 'absolute',
          inset: 40,
          zIndex: 2,
          pointerEvents: 'none',
          border: '1px solid rgba(0,255,180,0.06)',
          borderRadius: 4,
        }}
      />
      {/* Crosshair center */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 2,
          pointerEvents: 'none',
          width: 20,
          height: 20,
          opacity: 0.15,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: 0,
            right: 0,
            height: 1,
            background: '#00ffb4',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            bottom: 0,
            width: 1,
            background: '#00ffb4',
          }}
        />
      </div>
    </>
  )
}
