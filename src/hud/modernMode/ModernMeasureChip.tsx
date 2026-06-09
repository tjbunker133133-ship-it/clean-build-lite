/**
 * ModernMeasureChip — subtle active-measure indicator.
 */

import { useSyncExternalStore } from 'react'
import {
  exitMeasure,
  getMapInteractionSnapshot,
  subscribeMapInteraction,
} from '../../lib/mapInteractionController'

export function ModernMeasureChip() {
  const snapshot = useSyncExternalStore(subscribeMapInteraction, getMapInteractionSnapshot, getMapInteractionSnapshot)
  const active = snapshot.mode === 'measure' && snapshot.surface === 'modern'
  if (!active) return null

  const label =
    snapshot.measurePoints.length === 2
      ? 'Measuring · tap to reset'
      : snapshot.measurePoints.length === 1
        ? 'Tap second point'
        : 'Measure mode'

  return (
    <button
      type="button"
      data-testid="modern-measure-chip"
      onClick={() => exitMeasure('chip_cancel')}
      style={{
        position: 'fixed',
        bottom: 'calc(72px + env(safe-area-inset-bottom))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 4500,
        pointerEvents: 'auto',
        padding: '8px 14px',
        borderRadius: 20,
        border: '1px solid rgba(0,255,180,0.35)',
        background: 'rgba(20,28,26,0.92)',
        color: '#00ffb4',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: '-apple-system, system-ui, sans-serif',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        cursor: 'pointer',
      }}
      aria-label="Cancel measure mode"
    >
      📏 {label} · Cancel
    </button>
  )
}

export default ModernMeasureChip
