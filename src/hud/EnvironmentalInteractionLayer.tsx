/**
 * Environmental Interaction Layer - Modern Mode
 * 
 * CONTEXT-AWARE UI ADAPTATION SYSTEM
 * 
 * This layer provides intelligent, adaptive UI behavior based on:
 * - Movement speed (idle vs moving vs fast)
 * - Mission state (planning vs navigating vs emergency)
 * - Environmental conditions (overlays, weather, hazards)
 * - Voice activity (listening/processing/speaking states)
 * - Emergency state
 * 
 * DESIGN PHILOSOPHY:
 * The interface should feel alive and responsive to context.
 * It adapts subtly without being distracting or overwhelming.
 * 
 * EXAMPLES:
 * - User moving fast → navigation prominence increases, non-essential UI fades
 * - User idle → UI calms and simplifies, all tools accessible
 * - Voice active → subtle listening pulse indicator
 * - Fire overlay enabled → environment subtly reflects hazard context
 * - Weather alert → contextual environmental notice appears
 * 
 * NEVER obstruct the map. NEVER add heavy animations. ALWAYS maintain
 * readability and touch accessibility.
 */

import React, { useEffect, useMemo } from 'react'
import { useHudPresentation } from '../context/HudPresentationContext'
import { useGPS } from '../hooks/useGPS'
import { useOverlayContext } from '../context/OverlayContext'
import { useMovementEngine } from '../hooks/useMovementEngine'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useModernSituational } from './modernMode/ModernSituationalContext'
import type { ModernFieldActivity } from './modernMode/modernActivityInference'
import { MODERN_MOBILE_LAYOUT } from './modernMode/modernMobileLayout'
import { MODERN_FLOATING } from './modernMode/modernVisualTokens'

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

type MovementState = 'idle' | 'walking' | 'cycling' | 'driving' | 'unknown'
type ActivityContext = 'planning' | 'navigating' | 'paused' | 'emergency'

function activityToContext(activity: ModernFieldActivity): ActivityContext {
  if (activity === 'emergency') return 'emergency'
  if (
    activity === 'navigation' ||
    activity === 'driving' ||
    activity === 'biking' ||
    activity === 'hiking' ||
    activity === 'rafting'
  ) {
    return 'navigating'
  }
  if (activity === 'stationary' || activity === 'observation' || activity === 'fishing') {
    return 'planning'
  }
  return 'paused'
}
type EnvironmentalHazard = 'fire' | 'weather' | 'air_quality' | 'terrain' | null

interface EnvironmentalState {
  movement: MovementState
  speed: number // m/s
  activity: ActivityContext
  activeOverlays: Set<string>
  currentHazard: EnvironmentalHazard
  voiceActive: boolean
  emergencyActive: boolean
  batteryLevel: number
  isLowPower: boolean
}

// Speed thresholds in m/s
const SPEED_THRESHOLDS = {
  idle: 0.5,      // < 0.5 m/s ≈ stationary
  walking: 2.5,   // 0.5-2.5 m/s ≈ walking
  cycling: 7,     // 2.5-7 m/s ≈ cycling
  // > 7 m/s ≈ driving
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOVEMENT DETECTION — wired to real useMovementEngine
// ═══════════════════════════════════════════════════════════════════════════════

function useMovementState(): { state: MovementState; speed: number } {
  const engine = useMovementEngine()
  // Bridge from engine MovementState to legacy local MovementState type
  const localState: MovementState = (() => {
    switch (engine.state) {
      case 'moving_slow': return 'walking'
      case 'moving_fast': return 'driving'
      case 'stationary':  return 'idle'
      default:            return 'unknown'
    }
  })()
  return { state: localState, speed: engine.speedMs }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXTUAL INDICATOR COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Movement Indicator - Shows current movement state with subtle animation
 */
function MovementIndicator({
  state,
  speed,
  activity,
}: {
  state: MovementState
  speed: number
  activity: ModernFieldActivity
}) {
  const { mode } = useHudPresentation()
  const reducedMotion = useReducedMotion()

  if (mode !== 'immersive') return null
  if (state === 'idle' || state === 'unknown') return null
  if (activity === 'driving' || activity === 'stationary' || activity === 'fishing') return null

  const formatSpeed = (s: number): string => {
    const mph = s * 2.237
    return `${Math.round(mph)} mph`
  }

  const getIcon = () => {
    switch (state) {
      case 'walking': return '🚶'
      case 'cycling': return '🚴'
      case 'driving': return '🚗'
      default: return '•'
    }
  }

  const getColor = () => {
    switch (state) {
      case 'walking': return '#34C759'
      case 'cycling': return '#FF9500'
      case 'driving': return '#007AFF'
      default: return '#8E8E93'
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: MODERN_MOBILE_LAYOUT.centerRailBottom,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 90,
        padding: '5px 12px',
        borderRadius: MODERN_FLOATING.radius,
        background: MODERN_FLOATING.background,
        backdropFilter: MODERN_FLOATING.blur,
        WebkitBackdropFilter: MODERN_FLOATING.blur,
        border: `1px solid ${getColor()}30`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
        fontSize: 12,
        fontWeight: 500,
        color: 'rgba(255, 255, 255, 0.82)',
        animation: reducedMotion ? 'none' : 'movementPulse 2s ease-in-out infinite',
        pointerEvents: 'none',
      }}
    >
      <span style={{ fontSize: 16 }}>{getIcon()}</span>
      <span>{formatSpeed(speed)}</span>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: getColor(),
          animation: reducedMotion ? 'none' : 'dotPulse 1s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes movementPulse {
          0%, 100% { opacity: 0.9; }
          50% { opacity: 1; }
        }
        @keyframes dotPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}

/** Voice UI runs globally via SVS/VoicePanel — no duplicate Modern indicator. */

/**
 * Environmental Hazard Indicator - Shows when environmental overlays indicate risk
 */
function EnvironmentalHazardIndicator({ 
  activeOverlays 
}: { 
  activeOverlays: Set<string> 
}) {
  const { mode } = useHudPresentation()
  
  if (mode !== 'immersive') return null
  
  // Catalog-backed overlay context (no phantom overlay IDs)
  const hasFire = activeOverlays.has('fire_firms')
  const hasTerrain = activeOverlays.has('relief_usgs')
  const hasForest = activeOverlays.has('forest_usfs')
  const hasPublicLands = activeOverlays.has('public_lands')

  if (!hasFire && !hasTerrain && !hasForest && !hasPublicLands) return null

  let primaryHazard: { icon: string; label: string; color: string; level: string } | null = null

  if (hasFire) {
    primaryHazard = {
      icon: '🔥',
      label: 'Fire layer active',
      color: '#FF3B30',
      level: 'WATCH',
    }
  } else if (hasTerrain) {
    primaryHazard = {
      icon: '🏔️',
      label: 'Terrain relief on',
      color: '#5eead4',
      level: 'DEPTH',
    }
  } else if (hasForest) {
    primaryHazard = {
      icon: '🌲',
      label: 'Forest boundaries on',
      color: '#34C759',
      level: 'LAND',
    }
  } else if (hasPublicLands) {
    primaryHazard = {
      icon: '🏞️',
      label: 'Public lands on',
      color: '#007AFF',
      level: 'LAND',
    }
  }

  if (!primaryHazard) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 96,
        left: 16,
        zIndex: 90,
        padding: '8px 12px',
        borderRadius: MODERN_FLOATING.radius,
        background: MODERN_FLOATING.background,
        backdropFilter: MODERN_FLOATING.blur,
        WebkitBackdropFilter: MODERN_FLOATING.blur,
        border: `1px solid ${primaryHazard.color}30`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        maxWidth: 240,
        boxShadow: MODERN_FLOATING.shadow,
        animation: 'hazardEnter 400ms ease',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: `${primaryHazard.color}18`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          flexShrink: 0,
        }}
      >
        {primaryHazard.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 2,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: primaryHazard.color,
              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
              letterSpacing: '0.02em',
            }}
          >
            {primaryHazard.level}
          </span>
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'rgba(255, 255, 255, 0.9)',
            fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {primaryHazard.label}
        </div>
      </div>
      <style>{`
        @keyframes hazardEnter {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}

/**
 * Navigation Prominence Mode - Increases map/navigation visibility when moving
 */
function NavigationProminence({ 
  movement, 
  activity 
}: { 
  movement: MovementState
  activity: ActivityContext 
}) {
  const { mode } = useHudPresentation()
  
  if (mode !== 'immersive') return null
  
  // Only show when actively navigating at speed
  const shouldPromote = activity === 'navigating' && (movement === 'cycling' || movement === 'driving')
  
  if (!shouldPromote) return null

  return (
    <>
      {/* Subtle gradient overlay at top to increase map contrast */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 80,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.22) 0%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      
      {/* Reduced navigation hint — environmental, not operational badge */}
      <div
        style={{
          position: 'fixed',
          bottom: MODERN_MOBILE_LAYOUT.reactionBottom,
          left: 16,
          zIndex: 90,
          padding: '4px 8px',
          borderRadius: MODERN_FLOATING.radius,
          background: MODERN_FLOATING.backgroundActive,
          border: `1px solid ${MODERN_FLOATING.borderActive}`,
          fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
          fontSize: 10,
          fontWeight: 500,
          color: 'rgba(125, 200, 255, 0.85)',
          letterSpacing: '0.06em',
          pointerEvents: 'none',
        }}
      >
        NAV
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function EnvironmentalInteractionLayer() {
  const { mode } = useHudPresentation()
  const situational = useModernSituational()
  const { state: movement, speed } = useMovementState()
  const activity = activityToContext(situational.activity)
  const { toggles } = useOverlayContext()

  const suppressPassive = situational.sensory.suppressPassive

  // Derive active overlay set from real toggle state
  const activeOverlays = useMemo(
    () => new Set(Object.entries(toggles).filter(([, v]) => v).map(([k]) => k)),
    [toggles],
  )

  // Modern-only: perceptual depth cue when terrain relief is active
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (mode === 'immersive' && activeOverlays.has('relief_usgs')) {
      root.setAttribute('data-env-relief', 'active')
    } else {
      root.removeAttribute('data-env-relief')
    }
    return () => root.removeAttribute('data-env-relief')
  }, [mode, activeOverlays])
  
  // Modern-only composition — mounted exclusively inside ModernRoot
  if (mode !== 'immersive') return null

  return (
    <div data-env-interaction-layer="modern" aria-hidden style={{ pointerEvents: 'none' }}>
      {!suppressPassive && (
        <MovementIndicator state={movement} speed={speed} activity={situational.activity} />
      )}
      <EnvironmentalHazardIndicator activeOverlays={activeOverlays} />
      <NavigationProminence movement={movement} activity={activity} />
    </div>
  )
}

export default EnvironmentalInteractionLayer
