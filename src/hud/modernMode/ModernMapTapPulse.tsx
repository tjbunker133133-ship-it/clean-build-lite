/**
 * Modern map-tap spatial pulse — reads OSG mapSurfacePulse only.
 */

import { useSyncExternalStore } from 'react'
import { useHudPresentation } from '../../context/HudPresentationContext'
import { useMapContext } from '../../context/MapContext'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import {
  getOperationalGraphSnapshot,
  subscribeOperationalGraph,
} from '../../lib/operationalStateGraph'

export function ModernMapTapPulse() {
  const { mode } = useHudPresentation()
  const { map } = useMapContext()
  const reducedMotion = useReducedMotion()
  const pulse = useSyncExternalStore(
    subscribeOperationalGraph,
    () => getOperationalGraphSnapshot().interaction.mapSurfacePulse,
    () => null,
  )

  if (mode !== 'immersive' || !pulse || !map) return null

  let point: { x: number; y: number } | null = null
  try {
    point = map.project([pulse.lng, pulse.lat])
  } catch {
    return null
  }

  return (
    <div
      data-modern-map-pulse
      aria-hidden
      style={{
        position: 'fixed',
        left: point.x,
        top: point.y,
        width: 48,
        height: 48,
        marginLeft: -24,
        marginTop: -24,
        borderRadius: '50%',
        border: '1px solid rgba(94, 234, 212, 0.55)',
        background: 'radial-gradient(circle, rgba(94,234,212,0.22) 0%, rgba(94,234,212,0) 70%)',
        pointerEvents: 'none',
        zIndex: 3,
        animation: reducedMotion ? 'none' : 'modernMapPulse 900ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards',
        transform: 'scale(0.6)',
        opacity: 0.9,
      }}
    />
  )
}
