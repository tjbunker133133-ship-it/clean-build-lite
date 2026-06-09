/**
 * AtmosphericEnvironment — Modern Layer Only
 *
 * A permanently-rendered, full-screen, pointer-events-none CSS overlay
 * that subtly adapts the visual environment to real-time weather conditions.
 *
 * Design contract:
 *   - ALL effects are restrained. The user should FEEL weather before consciously noticing it.
 *   - Max overlay opacity: 0.18 (ambient tint), 0.22 (vignette)
 *   - Lightning pulses are rare (15–40s) and brief (90ms total)
 *   - Paused automatically when tab is backgrounded (battery/CPU)
 *   - Calm conditions still render subtle operational grounding vignette
 *   - GPU only: all animations use opacity / transform, never layout properties
 *
 * Isolation: NEVER render this in Classic or Balanced mode paths.
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getERLState, subscribeERLState } from './erl/erlStore'
import { ERL_PHASE_CALIBRATION } from './erl/erlCalibration'
import { useHudPresentation } from '../../context/HudPresentationContext'
import { useOverlayContext } from '../../context/OverlayContext'
import { useOperationalPerception } from '../../hooks/useOperationalPerception'
import { useWeatherAtmosphere } from '../../hooks/useWeatherAtmosphere'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useAtmosphericContinuity } from '../../hooks/useAtmosphericContinuity'
import { useFieldEmergence } from '../../field/useFieldEmergence'
import { cssTransition } from '../../perception/motion/motionLanguage'

// ─── Lightning pulse ─────────────────────────────────────────────────────────

function useLightningPulse(active: boolean) {
  const [flash, setFlash] = useState(false)
  const timerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!active) {
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
      setFlash(false)
      return
    }

    const scheduleNext = () => {
      // Randomize interval: 18–45 seconds
      const delay = 18_000 + Math.random() * 27_000
      timerRef.current = window.setTimeout(() => {
        if (!mountedRef.current || document.visibilityState === 'hidden') {
          scheduleNext()
          return
        }
        setFlash(true)
        // Flash lasts 90ms then fades — two-stage: bright then dim
        window.setTimeout(() => {
          if (mountedRef.current) setFlash(false)
          scheduleNext()
        }, 90)
      }, delay)
    }

    scheduleNext()
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
  }, [active])

  return flash
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AtmosphericEnvironment() {
  const { mode } = useHudPresentation()
  const { toggles } = useOverlayContext()
  const atm = useWeatherAtmosphere()
  const lightning = useLightningPulse(atm.isThunderstorm)
  const reducedMotion = useReducedMotion()
  const perception = useOperationalPerception()
  const emergence = useFieldEmergence()
  const continuity = useAtmosphericContinuity()
  const erl = useSyncExternalStore(subscribeERLState, getERLState)

  if (mode !== 'immersive') return null

  const isCalm = atm.level === 'calm' && !atm.hasActiveWeather
  const { dimFactor, ambientRgba, level } = atm
  const osgTone = perception.tone
  const hasTerrainLayer = toggles.relief_usgs
  const hasLandLayers = toggles.forest_usfs || toggles.public_lands
  const hasFireLayer = toggles.fire_firms

  const fadeMul = emergence.overlayFadeMultiplier * continuity.breathFactor
  const fieldPressureBoost = erl.fieldPressure * ERL_PHASE_CALIBRATION.fieldPressure
  const vignetteOpacity =
    ((level === 'intense' ? 0.16 : level === 'active' ? 0.11 : 0.07) +
    osgTone.dimBackground * 0.1 +
    osgTone.contrastBoost * 0.04 +
    fieldPressureBoost * 0.35) * fadeMul

  const tintOpacity =
    Math.min(0.16, dimFactor * 0.55 + osgTone.desaturation * 0.08 + (isCalm ? 0.04 : 0) + fieldPressureBoost * 0.25) *
    fadeMul
  const driftTransform = `translate(${continuity.driftX}px, ${continuity.driftY}px)`
  const overlayTintOpacity =
    hasFireLayer ? 0.1 : hasTerrainLayer ? 0.1 : hasLandLayers ? 0.07 : 0
  const overlayTintColor = hasFireLayer
    ? 'rgba(255, 80, 50, 0.35)'
    : hasTerrainLayer
      ? 'rgba(60, 120, 90, 0.28)'
      : 'rgba(40, 90, 60, 0.22)'

  const transitionTint = cssTransition('opacity', 'atmospheric', { reducedMotion })
  const transitionVignette = cssTransition('opacity', 'atmospheric', {
    reducedMotion,
    easing: 'organismEaseInOut',
  })
  const transitionBackground = cssTransition('background', 'atmospheric', { reducedMotion })

  return (
    <div
      data-testid="atmospheric-environment"
      data-osg-perception-mode={perception.mode}
      className="hud-pointer-pass-through"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2,
        pointerEvents: 'none',
        transform: driftTransform,
        willChange: 'transform, opacity',
      }}
    >
      {/* Always-on environmental grounding — field never feels absent */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 130% 95% at 50% 45%, rgba(32, 56, 88, 0.04) 0%, transparent 55%), radial-gradient(ellipse at center, transparent 48%, rgba(8, 12, 18, 0.14) 100%)',
          opacity: (isCalm ? 0.42 : 0.32) * continuity.breathFactor,
          transition: transitionVignette,
          willChange: 'opacity',
        }}
      />

      {/* Ambient color grade — always present, intensity varies with weather */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: isCalm
            ? 'linear-gradient(180deg, rgba(18, 28, 42, 0.12) 0%, rgba(8, 14, 22, 0.18) 100%)'
            : ambientRgba,
          opacity: Math.max(0.06, tintOpacity),
          transition: `${transitionTint}, ${transitionBackground}`,
          willChange: 'opacity',
        }}
      />

      {overlayTintOpacity > 0 ? (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background: overlayTintColor,
            opacity: overlayTintOpacity,
            transition: `opacity ${transitionTint}`,
            willChange: 'opacity',
          }}
        />
      ) : null}

      <>
      {vignetteOpacity > 0 && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3,
            pointerEvents: 'none',
            background:
              'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.28) 100%)',
            opacity: vignetteOpacity,
            transition: `opacity ${transitionVignette}`,
            willChange: 'opacity',
          }}
        />
      )}

      {/* ── Storm: top-edge darkening ───────────────────────────────────── */}
      {level === 'intense' && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: 160,
            zIndex: 3,
            pointerEvents: 'none',
            background:
              'linear-gradient(to bottom, rgba(20,25,60,0.18) 0%, transparent 100%)',
            transition: cssTransition('opacity', 'atmospheric', { reducedMotion }),
          }}
        />
      )}

      {/* ── Rain/storm: bottom-edge atmospheric gradient ─────────────── */}
      {(atm.tone === 'rain' || atm.tone === 'storm' || atm.tone === 'showers') && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: 120,
            zIndex: 3,
            pointerEvents: 'none',
            background:
              'linear-gradient(to top, rgba(40,70,140,0.10) 0%, transparent 100%)',
            transition: cssTransition('opacity', 'atmospheric', { reducedMotion }),
          }}
        />
      )}

      {/* ── Fog: subtle white veil ──────────────────────────────────────── */}
      {atm.tone === 'fog' && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3,
            pointerEvents: 'none',
            background:
              'radial-gradient(ellipse 120% 100% at 50% 50%, rgba(200,210,230,0.07) 0%, transparent 70%)',
            transition: cssTransition('opacity', 'atmospheric', { reducedMotion }),
          }}
        />
      )}

      {/* ── Snow: cool bright ambient ────────────────────────────────────── */}
      {atm.tone === 'snow' && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3,
            pointerEvents: 'none',
            background:
              'radial-gradient(ellipse 130% 80% at 50% 0%, rgba(210,225,255,0.06) 0%, transparent 60%)',
            transition: cssTransition('opacity', 'atmospheric', { reducedMotion }),
          }}
        />
      )}

      {/* ── Lightning flash — skipped when reducedMotion ─────────────── */}
      {atm.isThunderstorm && !reducedMotion && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10,
            pointerEvents: 'none',
            background: 'rgba(210, 220, 255, 0.14)',
            opacity: lightning ? 1 : 0,
            transition: lightning
              ? cssTransition('opacity', 'system', { reducedMotion: true, easing: 'organismLinear' })
              : cssTransition('opacity', 'system', { reducedMotion }),
            willChange: 'opacity',
          }}
        />
      )}
      </>
    </div>
  )
}

export default AtmosphericEnvironment
