/**
 * Field-native compositor — localized proximity signals (camp, waypoint calm).
 * Directional atmosphere (Phase 2–5) lives in ModernDirectionalAtmosphere.
 */

import { useSyncExternalStore } from 'react'
import { subscribeERLState, getERLState } from './erl/erlStore'
import { ERL_PHASE_CALIBRATION } from './erl/erlCalibration'
import { useHudPresentation } from '../../context/HudPresentationContext'
import { useOverlayContext } from '../../context/OverlayContext'
import { useWeatherAtmosphere } from '../../hooks/useWeatherAtmosphere'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { getFieldEntryPhase, subscribeFieldEntry } from './modernFieldEntryGate'
import { cssTransition } from '../../perception/motion/motionLanguage'

export function ModernFieldNativeCompositor() {
  const { mode } = useHudPresentation()
  const { toggles } = useOverlayContext()
  const atmosphere = useWeatherAtmosphere()
  const reducedMotion = useReducedMotion()
  const entryPhase = useSyncExternalStore(subscribeFieldEntry, getFieldEntryPhase)
  const erl = useSyncExternalStore(subscribeERLState, getERLState)

  if (mode !== 'immersive') return null

  const cal = ERL_PHASE_CALIBRATION
  const settlingFade = entryPhase === 'settling' ? 0.65 : 1
  const weatherPressure =
    atmosphere.level === 'intense' ? 0.12
    : atmosphere.level === 'active' ? 0.08
    : atmosphere.tone === 'rain' || atmosphere.tone === 'storm' ? 0.07
    : 0.035

  const campWarmth = erl.campApproach * cal.campWarmth
  const waypointCalm = erl.waypointApproach * cal.waypointCalm
  const hazardTension = erl.hazardApproach * cal.hazardTension
  const fireTension = toggles.fire_firms ? 0.04 + hazardTension : hazardTension

  return (
    <div
      data-modern-field-compositor
      aria-hidden
      className="hud-pointer-pass-through"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2,
        opacity: settlingFade,
        transition: cssTransition('opacity', 'atmospheric', { reducedMotion }),
      }}
    >
      {campWarmth > 0 ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: campWarmth,
            background:
              'radial-gradient(ellipse 55% 45% at 58% 52%, rgba(200, 155, 95, 0.08) 0%, transparent 72%)',
            mixBlendMode: 'soft-light',
          }}
        />
      ) : null}
      {waypointCalm > 0 ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: waypointCalm,
            background:
              'radial-gradient(ellipse 45% 40% at 50% 50%, rgba(180, 210, 200, 0.06) 0%, transparent 70%)',
            mixBlendMode: 'soft-light',
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: weatherPressure,
          background: atmosphere.tone === 'storm'
            ? 'radial-gradient(ellipse 100% 70% at 50% 30%, rgba(60, 72, 120, 0.16) 0%, transparent 65%)'
            : atmosphere.tone === 'rain' || atmosphere.tone === 'showers'
              ? 'radial-gradient(ellipse 90% 60% at 50% 40%, rgba(72, 108, 140, 0.1) 0%, transparent 60%)'
              : 'radial-gradient(ellipse 80% 55% at 50% 45%, rgba(88, 120, 150, 0.05) 0%, transparent 55%)',
          mixBlendMode: 'soft-light',
        }}
      />
      {fireTension > 0 ? (
        <div
          data-field-hazard-shimmer
          style={{
            position: 'absolute',
            inset: 0,
            opacity: fireTension,
            background:
              'radial-gradient(ellipse 70% 55% at 52% 48%, rgba(140, 60, 36, 0.08) 0%, transparent 68%)',
            mixBlendMode: 'multiply',
          }}
        />
      ) : null}
    </div>
  )
}

export default ModernFieldNativeCompositor
