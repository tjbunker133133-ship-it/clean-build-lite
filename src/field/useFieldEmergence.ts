/**
 * Layer-aware soft UI emergence — global motion language.
 * Does NOT mutate OSG; read-only recursive field projection.
 */

import { useMemo } from 'react'
import { useHudPresentation } from '../context/HudPresentationContext'
import { useSpatialField } from '../hooks/useSpatialField'
import { useMotionLanguage } from '../hooks/useMotionLanguage'
import { computeFieldEmergence } from '../perception/motion/motionLanguage'
import type { RecursiveFieldSnapshot } from './recursive/types'
import type { SpatialFieldSnapshot } from './types'

export type FieldEmergenceState = {
  radialOpacity: number
  missionPanelOpacity: number
  navigationHintOpacity: number
  overlayFadeMultiplier: number
}

function isRecursiveField(field: SpatialFieldSnapshot): field is RecursiveFieldSnapshot {
  return 'predicted' in field && 'coherence' in field
}

export function useFieldEmergence(): FieldEmergenceState {
  const { mode } = useHudPresentation()
  const field = useSpatialField()
  const { profile } = useMotionLanguage()

  return useMemo(() => {
    if (mode !== 'immersive') {
      return {
        radialOpacity: 1,
        missionPanelOpacity: 1,
        navigationHintOpacity: 0,
        overlayFadeMultiplier: 1,
      }
    }

    if (isRecursiveField(field)) {
      return computeFieldEmergence(field, profile)
    }

    return {
      radialOpacity: field.radialPressure,
      missionPanelOpacity: field.missionFocus,
      navigationHintOpacity: field.navigationPull * 0.6,
      overlayFadeMultiplier: 0.55 + field.cameraStability * 0.45,
    }
  }, [mode, field, profile])
}
