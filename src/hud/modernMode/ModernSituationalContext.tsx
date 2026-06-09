/**
 * Modern situational focus — adaptive presentation states for the immersive runtime.
 * Drives density, motion, and overlay composition via data attributes on the mode root.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react'
import { useHudPresentation } from '../../context/HudPresentationContext'
import { useGPS } from '../../hooks/useGPS'
import { useMissionSync } from '../../context/MissionSyncContext'
import { useOverlayContext } from '../../context/OverlayContext'
import { useMovementEngine } from '../../hooks/useMovementEngine'
import { useOperationalSession } from '../../context/OperationalSessionContext'
import { logModernGuardrailApplied } from '../../lib/modernLayerGuardrails'

logModernGuardrailApplied('ModernSituationalContext')

export type ModernSituationalFocus =
  | 'ambient'
  | 'exploration'
  | 'navigation'
  | 'travel'
  | 'stationary'
  | 'weather'
  | 'emergency'
  | 'driving'

export type ModernAttentionTier = 'primary' | 'contextual' | 'passive' | 'transient'

export type ModernSituationalState = {
  focus: ModernSituationalFocus
  attentionTier: ModernAttentionTier
  density: 'minimal' | 'balanced' | 'rich'
  motionProfile: 'calm' | 'responsive' | 'urgent'
  isMoving: boolean
  speedMs: number
}

const DEFAULT_STATE: ModernSituationalState = {
  focus: 'ambient',
  attentionTier: 'passive',
  density: 'minimal',
  motionProfile: 'calm',
  isMoving: false,
  speedMs: 0,
}

const ModernSituationalContext = createContext<ModernSituationalState>(DEFAULT_STATE)

function resolveFocus(input: {
  speedMs: number
  missionActive: boolean
  routeNavigating: boolean
  emergency: boolean
  weatherOverlay: boolean
  hazardOverlay: boolean
}): ModernSituationalFocus {
  if (input.emergency) return 'emergency'
  if (input.routeNavigating) return 'navigation'
  if (input.weatherOverlay) return 'weather'
  if (input.speedMs >= 7) return 'driving'
  if (input.missionActive && input.speedMs >= 1.2) return 'navigation'
  if (input.speedMs >= 2.5) return 'travel'
  if (input.speedMs >= 0.5) return 'exploration'
  if (input.hazardOverlay) return 'weather'
  return 'stationary'
}

function resolveDensity(focus: ModernSituationalFocus): ModernSituationalState['density'] {
  switch (focus) {
    case 'emergency':
    case 'navigation':
    case 'driving':
      return 'minimal'
    case 'travel':
    case 'weather':
      return 'balanced'
    default:
      return 'rich'
  }
}

function resolveMotion(focus: ModernSituationalFocus): ModernSituationalState['motionProfile'] {
  switch (focus) {
    case 'emergency':
      return 'urgent'
    case 'navigation':
    case 'driving':
    case 'travel':
      return 'responsive'
    default:
      return 'calm'
  }
}

function resolveAttention(focus: ModernSituationalFocus): ModernAttentionTier {
  switch (focus) {
    case 'emergency':
      return 'primary'
    case 'navigation':
    case 'driving':
      return 'contextual'
    case 'travel':
    case 'weather':
      return 'transient'
    default:
      return 'passive'
  }
}

export function ModernSituationalProvider({ children }: { children: ReactNode }) {
  const { mode } = useHudPresentation()
  const movement = useMovementEngine()
  const mission = useMissionSync()
  const { toggles } = useOverlayContext()
  const gps = useGPS()
  const { session } = useOperationalSession()

  const state = useMemo<ModernSituationalState>(() => {
    if (mode !== 'immersive') return DEFAULT_STATE

    const speedMs = movement.speedMs
    const missionActive = mission.role !== 'idle'
    const routeNavigating = session.phase === 'navigating'
    const weatherOverlay = false
    const hazardOverlay = Boolean(toggles.fire_firms || toggles.relief_usgs)

    const focus = resolveFocus({
      speedMs,
      missionActive,
      routeNavigating,
      emergency: false,
      weatherOverlay,
      hazardOverlay,
    })

    return {
      focus,
      attentionTier: resolveAttention(focus),
      density: resolveDensity(focus),
      motionProfile: resolveMotion(focus),
      isMoving: speedMs >= 0.5,
      speedMs,
    }
  }, [mode, movement.speedMs, mission.role, session.phase, toggles, gps.lat, gps.lng])

  useEffect(() => {
    if (typeof document === 'undefined' || mode !== 'immersive') return
    const root = document.querySelector('[data-mode-root="modern"]')
    if (!root) return

    root.setAttribute('data-modern-focus', state.focus)
    root.setAttribute('data-modern-density', state.density)
    root.setAttribute('data-modern-motion', state.motionProfile)
    root.setAttribute('data-modern-attention', state.attentionTier)

    return () => {
      root.removeAttribute('data-modern-focus')
      root.removeAttribute('data-modern-density')
      root.removeAttribute('data-modern-motion')
      root.removeAttribute('data-modern-attention')
    }
  }, [mode, state])

  if (mode !== 'immersive') {
    return <>{children}</>
  }

  return (
    <ModernSituationalContext.Provider value={state}>
      {children}
    </ModernSituationalContext.Provider>
  )
}

export function useModernSituational(): ModernSituationalState {
  return useContext(ModernSituationalContext)
}
