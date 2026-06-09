/**
 * Modern-layer navigation hint — floating depth tier, motion language.
 */

import { useMotionLanguage } from '../hooks/useMotionLanguage'
import { useHudPresentation } from '../context/HudPresentationContext'
import { cssTransition } from '../perception/motion/motionLanguage'
import { useFieldEmergence } from './useFieldEmergence'

export function FieldNavigationHint() {
  const { mode } = useHudPresentation()
  const emergence = useFieldEmergence()
  const { reducedMotion } = useMotionLanguage()

  if (mode !== 'immersive') return null

  const opacity = emergence.navigationHintOpacity
  if (opacity < 0.006) return null

  // Production immersion: no controller readout text — ambient glow only
  return (
    <div
      data-testid="field-navigation-hint"
      className="hud-pointer-pass-through"
      aria-hidden="true"
      style={{
        position: 'fixed',
        bottom: 'calc(18px + env(safe-area-inset-bottom, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 48,
        height: 4,
        borderRadius: 999,
        opacity: opacity * 0.42,
        transition: cssTransition('opacity', 'floating', { reducedMotion }),
        background: 'radial-gradient(ellipse at center, rgba(125, 200, 255, 0.45) 0%, transparent 70%)',
        pointerEvents: 'none',
        zIndex: 4,
      }}
    />
  )
}
