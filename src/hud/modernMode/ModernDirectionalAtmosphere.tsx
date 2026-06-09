/**
 * Phase 2 — bearing-relative atmospheric hemisphere.
 * Weather and hazard pressure arrive from the direction you're facing.
 */

import { useSyncExternalStore } from 'react'
import { useHudPresentation } from '../../context/HudPresentationContext'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { cssTransition } from '../../perception/motion/motionLanguage'
import { ERL_PHASE_CALIBRATION } from './erl/erlCalibration'
import { getERLState, getERLPresentationMeta, subscribeERLState } from './erl/erlStore'

export function ModernDirectionalAtmosphere() {
  const { mode } = useHudPresentation()
  const reducedMotion = useReducedMotion()
  const erl = useSyncExternalStore(subscribeERLState, getERLState)
  const meta = useSyncExternalStore(subscribeERLState, getERLPresentationMeta)

  if (mode !== 'immersive') return null

  const cal = ERL_PHASE_CALIBRATION
  const forwardWeather = erl.forwardWeatherPressure * cal.forwardWeather
  const forwardHazard = erl.forwardHazardPressure * cal.forwardHazard
  const rearClarity = erl.rearHazardPressure * cal.rearClarity
  const fieldPressure = erl.fieldPressure * cal.fieldPressure
  const temporalMood = erl.temporalMood * cal.temporalMood
  const navCoherence = (erl.navCoherence - 0.5) * 2 * cal.navCoherence

  const heading = meta.hasHeading ? (meta.headingDeg ?? 0) : 0
  const hasDirectional = meta.hasHeading && (
    forwardWeather + forwardHazard + rearClarity + navCoherence > 0.008
  )

  if (!hasDirectional && fieldPressure + temporalMood < 0.008) {
    return null
  }

  const transition = cssTransition('opacity', 'atmospheric', { reducedMotion })

  return (
    <div
      data-modern-directional-atmosphere
      aria-hidden
      className="hud-pointer-pass-through"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      {hasDirectional ? (
        <>
          {forwardWeather > 0 ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                opacity: forwardWeather,
                background: `conic-gradient(
                  from ${heading - 70}deg at 50% 46%,
                  rgba(58, 78, 118, 0.22) 0deg,
                  rgba(72, 98, 140, 0.14) 42deg,
                  transparent 88deg,
                  transparent 300deg,
                  transparent 360deg
                )`,
                mixBlendMode: 'soft-light',
                transition,
              }}
            />
          ) : null}
          {forwardHazard > 0 ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                opacity: forwardHazard,
                background: `conic-gradient(
                  from ${heading - 55}deg at 50% 48%,
                  rgba(120, 52, 32, 0.16) 0deg,
                  rgba(100, 48, 28, 0.08) 38deg,
                  transparent 82deg,
                  transparent 360deg
                )`,
                mixBlendMode: 'multiply',
                transition,
              }}
            />
          ) : null}
          {rearClarity > 0 ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                opacity: rearClarity,
                background: `conic-gradient(
                  from ${heading + 110}deg at 50% 50%,
                  rgba(190, 210, 230, 0.1) 0deg,
                  rgba(180, 200, 220, 0.05) 48deg,
                  transparent 100deg,
                  transparent 360deg
                )`,
                mixBlendMode: 'soft-light',
                transition,
              }}
            />
          ) : null}
          {navCoherence > 0 ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                opacity: navCoherence,
                background: `conic-gradient(
                  from ${heading - 50}deg at 50% 44%,
                  rgba(220, 228, 238, 0.07) 0deg,
                  transparent 72deg,
                  transparent 360deg
                )`,
                mixBlendMode: 'overlay',
                transition,
              }}
            />
          ) : null}
        </>
      ) : null}
      {fieldPressure > 0 ? (
        <div
          data-erl-field-pressure
          style={{
            position: 'absolute',
            inset: 0,
            opacity: fieldPressure,
            background:
              'radial-gradient(ellipse 110% 85% at 50% 50%, rgba(36, 48, 68, 0.08) 0%, transparent 68%)',
            mixBlendMode: 'multiply',
            transition,
          }}
        />
      ) : null}
      {temporalMood > 0 ? (
        <div
          data-erl-temporal-mood
          style={{
            position: 'absolute',
            inset: 0,
            opacity: temporalMood,
            background: `
              repeating-radial-gradient(circle at 24% 32%, rgba(255,255,255,0.018) 0 1px, transparent 1px 5px),
              repeating-radial-gradient(circle at 68% 58%, rgba(100,140,180,0.02) 0 1px, transparent 1px 6px)
            `,
            mixBlendMode: 'soft-light',
            transition,
          }}
        />
      ) : null}
    </div>
  )
}

export default ModernDirectionalAtmosphere
