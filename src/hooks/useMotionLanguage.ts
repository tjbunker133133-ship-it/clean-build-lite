import { useEffect, useMemo, useState } from 'react'
import { useHudPresentation } from '../context/HudPresentationContext'
import { useReducedMotion } from './useReducedMotion'
import {
  getMotionProfile,
  type MotionLayerId,
  type MotionProfile,
} from '../perception/motion/motionLanguage'

function hudModeToMotionLayer(mode: string): MotionLayerId {
  if (mode === 'immersive') return 'modern'
  if (mode === 'hybrid') return 'balanced'
  return 'classic'
}

/** Reactive motion profile for the active HUD layer. */
export function useMotionLanguage(): {
  layer: MotionLayerId
  profile: MotionProfile
  reducedMotion: boolean
  backgrounded: boolean
} {
  const { mode } = useHudPresentation()
  const reducedMotion = useReducedMotion()
  const [backgrounded, setBackgrounded] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  )

  useEffect(() => {
    const onVis = () => setBackgrounded(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const layer = hudModeToMotionLayer(mode)

  const profile = useMemo(
    () => getMotionProfile(layer, reducedMotion, backgrounded),
    [layer, reducedMotion, backgrounded],
  )

  return { layer, profile, reducedMotion, backgrounded }
}
