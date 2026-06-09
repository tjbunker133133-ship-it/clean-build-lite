/**
 * Tier 3 field intelligence orchestrator — coordinates sensory feedback from situational state.
 * Event-driven, no render loops. Reuses haptics + window events; does not duplicate SVS detectors.
 */

import { useEffect, useRef } from 'react'
import { useHudPresentation } from '../../context/HudPresentationContext'
import { useWeatherAtmosphere } from '../../hooks/useWeatherAtmosphere'
import { emitHaptic } from '../../runtime/haptics'
import { useModernSituational } from './ModernSituationalContext'

export type ModernFieldIntelligenceInput = {
  deadmanState?: 'idle' | 'armed' | 'warning' | 'critical'
}

export function useModernFieldIntelligence(input: ModernFieldIntelligenceInput = {}) {
  const { mode } = useHudPresentation()
  const situational = useModernSituational()
  const atmosphere = useWeatherAtmosphere()
  const prevRef = useRef({
    focus: situational.focus,
    activity: situational.activity,
    weatherLevel: atmosphere.level,
    deadmanState: input.deadmanState ?? 'idle',
  })

  useEffect(() => {
    if (mode !== 'immersive') return

    const prev = prevRef.current
    const nextDeadman = input.deadmanState ?? 'idle'

    if (situational.focus === 'emergency' && prev.focus !== 'emergency') {
      emitHaptic('criticalAlert')
    }

    if (nextDeadman === 'critical' && prev.deadmanState !== 'critical') {
      emitHaptic('criticalAlert')
    } else if (nextDeadman === 'warning' && prev.deadmanState === 'idle') {
      emitHaptic('commandFailure')
    } else if (nextDeadman === 'idle' && prev.deadmanState !== 'idle') {
      emitHaptic('commandSuccess')
    }

    if (
      atmosphere.level === 'intense' &&
      prev.weatherLevel !== 'intense' &&
      situational.focus !== 'emergency'
    ) {
      emitHaptic('wakeWord')
    }

    if (
      situational.sensory.hapticGuidance &&
      situational.activity === 'biking' &&
      prev.activity !== 'biking'
    ) {
      emitHaptic('wakeWord')
    }

    prevRef.current = {
      focus: situational.focus,
      activity: situational.activity,
      weatherLevel: atmosphere.level,
      deadmanState: nextDeadman,
    }
  }, [
    mode,
    situational.focus,
    situational.activity,
    situational.sensory.hapticGuidance,
    atmosphere.level,
    input.deadmanState,
  ])
}

export default useModernFieldIntelligence
