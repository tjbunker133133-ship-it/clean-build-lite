/**
 * Compositor bridge — maps ERL scalars to scoped CSS custom properties.
 * Vars live on [data-mode-root="modern"] only; canvas vars gated by data-erl-active.
 */

import { ERL_INTENSITY_MUL } from './erlCalibration'
import type { ERLPresentationMeta, ERLState } from './types'

export { ERL_INTENSITY_MUL }

const MOD_CAP = 0.15 * ERL_INTENSITY_MUL

const ERL_VAR_KEYS = [
  '--erl-trail-emergence',
  '--erl-waypoint-calm',
  '--erl-camp-warmth',
  '--erl-hazard-tension',
  '--erl-forward-weather',
  '--erl-forward-hazard',
  '--erl-rear-clarity',
  '--erl-field-pressure',
  '--erl-temporal-mood',
  '--erl-nav-coherence',
  '--erl-heading-deg',
  '--erl-has-heading',
  '--erl-waypoint-approach',
  '--erl-camp-approach',
  '--erl-hazard-approach',
  '--erl-forward-weather-pressure',
  '--erl-forward-hazard-pressure',
  '--erl-rear-hazard-pressure',
  '--erl-trail-approach',
] as const

const CANVAS_VAR_KEYS = [
  '--erl-canvas-saturate',
  '--erl-canvas-contrast',
  '--erl-canvas-brightness',
] as const

function mod(base: number, signal: number, weight = 1): number {
  return base + signal * MOD_CAP * weight
}

function getModernRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector('[data-mode-root="modern"]')
}

function getCanvasScope(): HTMLElement {
  return document.documentElement
}

export function receiveERLState(state: ERLState, presentation: ERLPresentationMeta): void {
  if (typeof document === 'undefined') return

  const modernRoot = getModernRoot()
  if (!modernRoot) return

  document.documentElement.setAttribute('data-erl-active', 'true')

  const intensity = ERL_INTENSITY_MUL
  const setOn = (el: HTMLElement, key: string, value: string) => {
    el.style.setProperty(key, value)
  }

  const trail = String(state.trailApproach * intensity)
  const waypoint = String(state.waypointApproach * intensity)
  const camp = String(state.campApproach * intensity)
  const hazard = String(state.hazardApproach * intensity)
  const fwdWeather = String(state.forwardWeatherPressure * intensity)
  const fwdHazard = String(state.forwardHazardPressure * intensity)
  const rearHazard = String(state.rearHazardPressure * intensity)
  const fieldPressure = String(state.fieldPressure * intensity)
  const temporal = String(state.temporalMood * intensity)
  const navCoherence = String(state.navCoherence * intensity)

  const vars: Record<string, string> = {
    '--erl-trail-emergence': trail,
    '--erl-waypoint-calm': waypoint,
    '--erl-camp-warmth': camp,
    '--erl-hazard-tension': hazard,
    '--erl-forward-weather': fwdWeather,
    '--erl-forward-hazard': fwdHazard,
    '--erl-rear-clarity': rearHazard,
    '--erl-field-pressure': fieldPressure,
    '--erl-temporal-mood': temporal,
    '--erl-nav-coherence': navCoherence,
    '--erl-heading-deg': String(presentation.headingDeg ?? 0),
    '--erl-has-heading': presentation.hasHeading ? '1' : '0',
    // Diagnostic contract aliases (console scripts / enforcement checks)
    '--erl-waypoint-approach': waypoint,
    '--erl-camp-approach': camp,
    '--erl-hazard-approach': hazard,
    '--erl-forward-weather-pressure': fwdWeather,
    '--erl-forward-hazard-pressure': fwdHazard,
    '--erl-rear-hazard-pressure': rearHazard,
    '--erl-trail-approach': trail,
  }

  for (const [key, value] of Object.entries(vars)) {
    setOn(modernRoot, key, value)
  }

  const pressureScalar = state.fieldPressure * intensity
  const temporalScalar = state.temporalMood * intensity
  const canvas = getCanvasScope()
  setOn(canvas, '--erl-canvas-saturate', String(mod(0.94, pressureScalar, -0.8)))
  setOn(canvas, '--erl-canvas-contrast', String(mod(0.96, pressureScalar + temporalScalar * 0.3, -0.6)))
  setOn(
    canvas,
    '--erl-canvas-brightness',
    String(mod(0.98, (state.navCoherence - 0.5) * 2 * intensity, 0.35)),
  )
}

export function clearERLCompositorVars(): void {
  if (typeof document === 'undefined') return

  document.documentElement.removeAttribute('data-erl-active')

  const modernRoot = getModernRoot()
  if (modernRoot) {
    for (const key of ERL_VAR_KEYS) {
      modernRoot.style.removeProperty(key)
    }
  }

  const canvas = getCanvasScope()
  for (const key of CANVAS_VAR_KEYS) {
    canvas.style.removeProperty(key)
  }

  // Legacy cleanup if vars were previously on documentElement
  for (const key of [...ERL_VAR_KEYS, ...CANVAS_VAR_KEYS]) {
    document.documentElement.style.removeProperty(key)
  }
}
