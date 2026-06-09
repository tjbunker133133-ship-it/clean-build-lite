/**
 * ModernActiveLayersChip — contextual layer presence; soft floating chrome.
 */

import { useMemo } from 'react'
import { useOverlayContext } from '../../context/OverlayContext'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { ENVIRONMENTAL_OVERLAY_CATALOG } from '../../lib/environmentalOverlays/catalog'
import { MODERN_FLOATING, modernFloatingTransition } from './modernVisualTokens'
import { MODERN_MOBILE_LAYOUT } from './modernMobileLayout'

interface ModernActiveLayersChipProps {
  onOpenLayers: () => void
}

export function ModernActiveLayersChip({ onOpenLayers }: ModernActiveLayersChipProps) {
  const { toggles, status } = useOverlayContext()
  const reducedMotion = useReducedMotion()

  const active = useMemo(
    () => ENVIRONMENTAL_OVERLAY_CATALOG.filter((d) => toggles[d.id]),
    [toggles],
  )

  const loadingCount = active.filter((d) => status[d.id]?.loading && !status[d.id]?.error).length
  const hasActive = active.length > 0
  const label =
    active.length === 0
      ? 'Environment'
      : active.length === 1
        ? active[0].label
        : `${active.length} phenomena`

  return (
    <button
      type="button"
      data-testid="modern-active-layers-chip"
      onClick={onOpenLayers}
      style={{
        position: 'fixed',
        bottom: MODERN_MOBILE_LAYOUT.chipBottom,
        left: 16,
        zIndex: 120,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 12px',
        borderRadius: MODERN_FLOATING.radius,
        border: `1px solid ${hasActive ? MODERN_FLOATING.borderActive : MODERN_FLOATING.border}`,
        background: hasActive ? MODERN_FLOATING.backgroundActive : MODERN_FLOATING.background,
        backdropFilter: MODERN_FLOATING.blur,
        WebkitBackdropFilter: MODERN_FLOATING.blur,
        color: hasActive ? 'rgba(185, 230, 210, 0.92)' : 'rgba(255, 255, 255, 0.62)',
        fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '0.02em',
        cursor: 'pointer',
        pointerEvents: 'auto',
        boxShadow: hasActive ? MODERN_FLOATING.shadowActive : MODERN_FLOATING.shadow,
        transition: modernFloatingTransition(reducedMotion),
      }}
    >
      <span style={{ fontSize: 10, opacity: 0.55, letterSpacing: '0.12em' }}>{hasActive ? '◌' : '·'}</span>
      <span>{loadingCount > 0 ? `Loading ${label}…` : label}</span>
    </button>
  )
}

export default ModernActiveLayersChip
