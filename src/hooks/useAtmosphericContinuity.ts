/**
 * Modern atmospheric continuity — slow drift + coherence breathing.
 * Ephemeral render values only; no state authority.
 */

import { useEffect, useRef, useState } from 'react'
import { useSpatialField } from './useSpatialField'
import { useMotionLanguage } from './useMotionLanguage'
import {
  atmosphericBreathFactor,
  atmosphericDriftOffset,
} from '../perception/motion/motionLanguage'
import { startManagedRafLoop } from '../perception/motion/rafLifecycle'
import type { RecursiveFieldSnapshot } from '../field/recursive/types'

function isRecursiveField(field: unknown): field is RecursiveFieldSnapshot {
  return (
    typeof field === 'object' &&
    field != null &&
    'coherence' in field &&
    'predicted' in field
  )
}

export type AtmosphericContinuityState = {
  breathFactor: number
  driftX: number
  driftY: number
}

const IDLE: AtmosphericContinuityState = { breathFactor: 1, driftX: 0, driftY: 0 }

export function useAtmosphericContinuity(): AtmosphericContinuityState {
  const { layer, profile, reducedMotion, backgrounded } = useMotionLanguage()
  const field = useSpatialField()
  const fieldRef = useRef(field)
  fieldRef.current = field

  const [state, setState] = useState<AtmosphericContinuityState>(IDLE)
  const prevRef = useRef(IDLE)

  useEffect(() => {
    if (layer !== 'modern' || reducedMotion || backgrounded) {
      setState(IDLE)
      prevRef.current = IDLE
      return
    }

    const cancel = startManagedRafLoop(
      (now) => {
        const f = fieldRef.current
        const coherence = isRecursiveField(f) ? f.coherence : 0.85
        const breath = atmosphericBreathFactor(coherence, now, profile)
        const drift = atmosphericDriftOffset(coherence, now, profile)
        const next = { breathFactor: breath, driftX: drift.x, driftY: drift.y }
        const prev = prevRef.current
        if (
          Math.abs(next.breathFactor - prev.breathFactor) < 0.0004 &&
          Math.abs(next.driftX - prev.driftX) < 0.01 &&
          Math.abs(next.driftY - prev.driftY) < 0.01
        ) {
          return
        }
        prevRef.current = next
        setState(next)
      },
      { maxFps: 24, pauseWhenHidden: true },
    )

    return cancel
  }, [layer, profile.layer, profile.atmosphericBreathHz, profile.atmosphericDriftAmp, reducedMotion, backgrounded])

  return state
}
