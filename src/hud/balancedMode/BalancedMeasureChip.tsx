/**
 * BalancedMeasureChip — active measure indicator with clear / adjust affordances.
 */

import { useSyncExternalStore } from 'react'
import {
  clearActiveMeasurement,
  clearMeasurePoints,
  enterMeasure,
  exitMeasure,
  getMapInteractionSnapshot,
  subscribeMapInteraction,
} from '../../lib/mapInteractionController'

export function BalancedMeasureChip() {
  const snapshot = useSyncExternalStore(subscribeMapInteraction, getMapInteractionSnapshot, getMapInteractionSnapshot)
  const onBalanced = snapshot.surface === 'balanced' || snapshot.measurePoints.length > 0
  const active =
    onBalanced &&
    (snapshot.mode === 'measure' || snapshot.measurePoints.length > 0)
  if (!active) return null

  const pts = snapshot.measurePoints
  const label =
    pts.length === 2
      ? 'Drag points to adjust · tap Clear'
      : pts.length === 1
        ? 'Tap second point'
        : 'Measure mode'

  const handleClear = () => {
    if (snapshot.mode === 'measure') {
      clearMeasurePoints()
      exitMeasure()
      return
    }
    clearActiveMeasurement()
  }

  const handleReset = () => {
    enterMeasure('balanced', { resetPoints: true })
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(96px + env(safe-area-inset-bottom))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 4500,
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
      data-testid="balanced-measure-chip"
    >
      <button
        type="button"
        onClick={handleReset}
        style={{
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
        aria-label="Measure mode"
      >
        📏 {label}
      </button>
      <button
        type="button"
        onClick={handleClear}
        style={{
          padding: '8px 12px',
          borderRadius: 20,
          border: '1px solid rgba(255,69,58,0.45)',
          background: 'rgba(40,20,20,0.92)',
          color: '#ff6961',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: '-apple-system, system-ui, sans-serif',
          cursor: 'pointer',
        }}
        aria-label="Clear measurement"
        data-testid="balanced-measure-clear"
      >
        Clear
      </button>
    </div>
  )
}

export default BalancedMeasureChip
