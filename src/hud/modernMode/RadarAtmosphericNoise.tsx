/**
 * Procedural atmospheric field — derived from FieldState only.
 * Never disappears; never reads as a radar grid overlay.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { getERLState, subscribeERLState } from './erl/erlStore'
import { ERL_PHASE_CALIBRATION } from './erl/erlCalibration'
import { useHudPresentation } from '../../context/HudPresentationContext'
import {
  FIELD_PRESENCE_FLOOR,
  type FieldState,
} from '../../lib/fieldIntentModel'

type Props = {
  state: FieldState
  proceduralOnly: boolean
  zoomBand?: 'street' | 'mid' | 'regional'
}

function intentTint(intent: FieldState['intent']): string {
  switch (intent) {
    case 'STORM_INTENSIVE':
      return 'rgba(58, 72, 128, 0.72)'
    case 'EMERGENCY_FOCUS':
      return 'rgba(128, 48, 48, 0.48)'
    case 'STREET_AWARE':
    case 'SYSTEM_FAILURE_PROCEDURAL':
      return 'rgba(52, 88, 138, 0.68)'
    case 'NAVIGATION_ACTIVE':
      return 'rgba(42, 82, 128, 0.58)'
    default:
      return 'rgba(36, 76, 118, 0.52)'
  }
}

function bandMotion(zoomBand: Props['zoomBand']): string {
  switch (zoomBand) {
    case 'street':
      return `
        radial-gradient(ellipse 90% 70% at 42% 58%, rgba(180, 200, 230, 0.14) 0%, transparent 55%),
        radial-gradient(ellipse 60% 45% at 68% 32%, rgba(120, 160, 200, 0.1) 0%, transparent 50%),
        repeating-radial-gradient(circle at 22% 38%, rgba(255,255,255,0.028) 0 1px, transparent 1px 4px)
      `
    case 'regional':
      return `
        radial-gradient(ellipse 140% 100% at 50% 40%, rgba(48, 72, 118, 0.22) 0%, transparent 68%),
        conic-gradient(from 180deg at 50% 50%, rgba(72,108,168,0.06) 0deg, transparent 60deg, rgba(48,88,148,0.08) 120deg, transparent 180deg)
      `
    default:
      return `
        radial-gradient(ellipse 110% 75% at 38% 52%, rgba(64, 108, 158, 0.16) 0%, transparent 60%),
        radial-gradient(ellipse 80% 55% at 72% 38%, rgba(88, 140, 188, 0.12) 0%, transparent 55%),
        repeating-radial-gradient(circle at 58% 72%, rgba(100,160,210,0.04) 0 2px, transparent 2px 6px)
      `
  }
}

export function RadarAtmosphericNoise({ state, proceduralOnly, zoomBand = 'mid' }: Props) {
  const { mode } = useHudPresentation()
  const erl = useSyncExternalStore(subscribeERLState, getERLState)
  if (mode !== 'immersive') return null

  const temporalBoost = 1 + erl.temporalMood * ERL_PHASE_CALIBRATION.temporalMood * 0.45
  const presence = Math.max(
    FIELD_PRESENCE_FLOOR,
    proceduralOnly
      ? state.fieldPresence * 0.85
      : state.fieldPresence * (0.35 + state.noiseExpression * 0.3),
  ) * temporalBoost
  const pulseSec = Math.max(3.2, 8.2 / state.noisePulse)

  const blurPx =
    zoomBand === 'street' ? 1.2
    : state.intent === 'STORM_INTENSIVE' ? 1
    : state.intent === 'NAVIGATION_ACTIVE' ? 0.5
    : 0.8

  const tint = intentTint(state.intent)

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.style.setProperty('--modern-field-presence', String(presence))
    document.documentElement.style.setProperty('--modern-field-pulse-sec', `${pulseSec}s`)
    return () => {
      document.documentElement.style.removeProperty('--modern-field-presence')
      document.documentElement.style.removeProperty('--modern-field-pulse-sec')
    }
  }, [presence, pulseSec])

  return (
    <div
      aria-hidden="true"
      data-testid="radar-atmospheric-noise"
      data-field-intent={state.intent}
      data-field-procedural={proceduralOnly ? 'true' : 'false'}
      data-field-zoom-band={zoomBand}
      className="hud-pointer-pass-through"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2,
        pointerEvents: 'none',
        opacity: presence,
        filter: `blur(${blurPx}px)`,
        background: `
          radial-gradient(ellipse 140% 92% at 50% 44%, ${tint} 0%, transparent 72%),
          ${bandMotion(zoomBand)},
          repeating-radial-gradient(circle at 18% 28%, rgba(255,255,255,0.032) 0 1px, transparent 1px 5px),
          repeating-radial-gradient(circle at 78% 62%, rgba(100,165,215,0.038) 0 1px, transparent 1px 6px)
        `,
        mixBlendMode: 'soft-light',
      }}
    />
  )
}

export default RadarAtmosphericNoise
