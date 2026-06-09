/**
 * Environmental frame — fuses UI into the map environment instead of floating on top.
 * GPU-efficient edge vignette + horizon grounding. Modern mode only.
 */

import { useHudPresentation } from '../../context/HudPresentationContext'
import { useModernSituational } from './ModernSituationalContext'
import { cssTransition } from '../../perception/motion/motionLanguage'
import { useReducedMotion } from '../../hooks/useReducedMotion'

export function ModernEnvironmentalFrame() {
  const { mode } = useHudPresentation()
  const { focus, density } = useModernSituational()
  const reducedMotion = useReducedMotion()

  if (mode !== 'immersive') return null

  const vignetteStrength =
    focus === 'emergency' ? 0.28
    : focus === 'navigation' || focus === 'driving' ? 0.2
    : density === 'minimal' ? 0.16
    : 0.14

  const horizonStrength =
    focus === 'stationary' || focus === 'exploration' ? 0.1
    : 0.06

  return (
    <div
      data-modern-environmental-frame
      aria-hidden
      className="hud-pointer-pass-through"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1,
        transition: cssTransition('opacity', 'atmospheric', { reducedMotion }),
      }}
    >
      {/* Edge vignette — spatial depth, not decoration */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `
            radial-gradient(
              ellipse 120% 90% at 50% 45%,
              transparent 42%,
              rgba(0, 0, 0, ${vignetteStrength * 0.35}) 72%,
              rgba(0, 0, 0, ${vignetteStrength}) 100%
            )
          `,
        }}
      />
      {/* Horizon grounding — subtle lower third weight */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '38%',
          background: `linear-gradient(to top, rgba(0, 0, 0, ${horizonStrength}) 0%, transparent 100%)`,
        }}
      />
      {/* Top atmospheric fade — integrates micro bar into environment */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 120,
          background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.18) 0%, transparent 100%)',
        }}
      />
      {/* Subtle noise texture — depth without decoration */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.18,
          background: `
            repeating-radial-gradient(circle at 20% 30%, rgba(255,255,255,0.015) 0 1px, transparent 1px 4px),
            repeating-radial-gradient(circle at 70% 60%, rgba(100,160,220,0.02) 0 1px, transparent 1px 5px)
          `,
          mixBlendMode: 'overlay',
        }}
      />
    </div>
  )
}

export default ModernEnvironmentalFrame
