/**
 * Modern Layer trail info — minimal metadata card with stub fallback.
 */

import React from 'react'
import type { TrailInspectResult } from '../../lib/trailInspect'
import { MODERN_FLOATING } from './modernVisualTokens'

type Props = {
  result: TrailInspectResult
  onDismiss: () => void
}

export function ModernTrailInspectCard({ result, onDismiss }: Props) {
  const title =
    result.name ?? (result.ref ? `Trail ${result.ref}` : 'Trail segment')
  const classLine = result.trailClass ? `Class: ${result.trailClass}` : null

  return (
    <div
      role="dialog"
      aria-label="Trail information"
      data-testid="modern-trail-inspect-card"
      style={{
        position: 'fixed',
        bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 5000,
        pointerEvents: 'auto',
        width: 'min(92vw, 360px)',
        padding: '12px 14px',
        borderRadius: MODERN_FLOATING.radius,
        background: MODERN_FLOATING.background,
        border: `1px solid ${MODERN_FLOATING.border}`,
        backdropFilter: MODERN_FLOATING.blur,
        WebkitBackdropFilter: MODERN_FLOATING.blur,
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#00ffb4' }}>{title}</div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.8)',
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>
      {classLine ? (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 4 }}>
          {classLine}
        </div>
      ) : null}
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.35 }}>
        {result.disclaimer}
      </div>
    </div>
  )
}

export default ModernTrailInspectCard
