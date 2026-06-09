/**
 * Decorative field layers — suppressed during movement, navigation, and emergency.
 * Operational feedback layers stay mounted separately.
 */

import { useHudPresentation } from '../../context/HudPresentationContext'
import { useModernSituational } from './ModernSituationalContext'
import { ModernFieldMotionLayer } from './ModernFieldMotionLayer'
import { ModernSubstrateVeil } from './ModernSubstrateVeil'

export function ModernAdaptiveDecor() {
  const { mode } = useHudPresentation()
  const situational = useModernSituational()

  if (mode !== 'immersive') return null

  const suppressDecor = situational.sensory.suppressDecor

  if (suppressDecor) return null

  return (
    <div data-modern-decorative="true" className="hud-pointer-pass-through">
      <ModernSubstrateVeil />
      <ModernFieldMotionLayer />
    </div>
  )
}

export default ModernAdaptiveDecor
