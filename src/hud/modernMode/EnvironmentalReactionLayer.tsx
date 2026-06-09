/**
 * EnvironmentalReactionLayer — Modern Layer Only
 *
 * Renders contextual ambient indicators that respond to:
 *   - Waypoint proximity (approaching / arriving)
 *   - Route deviation (off-path awareness)
 *   - Atmosphere (storm edge indicator)
 *   - GPS health
 *
 * Design law:
 *   - All indicators fade in over 600–1200ms
 *   - None require dismissal
 *   - None obscure the map center
 *   - NONE are HIGH PRESENCE — all are MEDIUM or LOW
 *   - Invisible during calm conditions
 *
 * Placement:
 *   - Bottom-left edge (above SOS zone)
 *   - pointer-events: none — never interrupts touch
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useHudPresentation } from '../../context/HudPresentationContext'
import { usePanelData } from '../../context/PanelDataContext'
import { useAppContext } from '../../context/AppContext'
import { useMovementEngine } from '../../hooks/useMovementEngine'
import { useWeatherAtmosphere } from '../../hooks/useWeatherAtmosphere'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { MODERN_FLOATING, modernFloatingTransition } from './modernVisualTokens'
import { haversineMeters } from '../../hooks/useMovementEngine'
import {
  logModernGuardrailApplied,
  ROUTE_METRICS_DEBOUNCE_MS,
} from '../../lib/modernLayerGuardrails'

logModernGuardrailApplied('EnvironmentalReactionLayer')

const FONT = '-apple-system, SF Pro Text, system-ui, sans-serif'

// ─── Distance thresholds ──────────────────────────────────────────────────────

const APPROACH_DIST = 120   // m — show approach indicator
const ARRIVAL_DIST = 22     // m — show arrival
const STORM_APPROACH_DIST_KM = 0  // Storm always shown when atmosphere === storm

// ─── Approach indicator ───────────────────────────────────────────────────────

interface ApproachIndicatorProps {
  distance: number
  label: string
  reducedMotion: boolean
}

function ApproachIndicator({ distance, label, reducedMotion }: ApproachIndicatorProps) {
  const isArriving = distance < ARRIVAL_DIST

  const accentColor = isArriving ? '#34C759' : '#00ffb4'
  const message = isArriving
    ? `Arriving — ${label || 'waypoint'}`
    : `${Math.round(distance)}m — ${label || 'waypoint'}`

  return (
    <div
      aria-live="polite"
      aria-label={message}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 12px',
        borderRadius: MODERN_FLOATING.radius,
        background: MODERN_FLOATING.background,
        border: `1px solid ${MODERN_FLOATING.border}`,
        backdropFilter: MODERN_FLOATING.blur,
        WebkitBackdropFilter: MODERN_FLOATING.blur,
        transition: modernFloatingTransition(reducedMotion),
        opacity: 0.92,
      }}
    >
      <div
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: accentColor,
          flexShrink: 0,
          boxShadow: `0 0 4px ${accentColor}55`,
          animation: reducedMotion
            ? 'none'
            : isArriving
            ? 'arrivalPulse 1.2s ease-in-out infinite'
            : 'none',
        }}
      />
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: `${accentColor}`,
          fontFamily: FONT,
          letterSpacing: '0.01em',
        }}
      >
        {message}
      </span>
    </div>
  )
}

// ─── Storm edge indicator ─────────────────────────────────────────────────────

function StormEdgeIndicator({ tone, reducedMotion }: { tone: string; reducedMotion: boolean }) {
  if (tone !== 'storm') return null

  return (
    <div
      aria-label="Storm conditions active"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '7px 12px',
        borderRadius: 10,
        background: 'rgba(60,50,140,0.20)',
        border: '1px solid rgba(100,90,200,0.30)',
        animation: reducedMotion ? 'none' : 'reactionEnter 800ms ease forwards',
      }}
    >
      <span style={{ fontSize: 14 }}>⛈</span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'rgba(180,180,255,0.85)',
          fontFamily: FONT,
          letterSpacing: '0.01em',
        }}
      >
        Storm
      </span>
    </div>
  )
}

// ─── GPS degraded indicator ───────────────────────────────────────────────────

function GpsDegradedIndicator({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div
      aria-label="GPS signal degraded"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '7px 12px',
        borderRadius: 10,
        background: 'rgba(255,140,0,0.12)',
        border: '1px solid rgba(255,150,0,0.28)',
        animation: reducedMotion ? 'none' : 'reactionEnter 600ms ease forwards',
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: '#FF9500',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'rgba(255,165,60,0.90)',
          fontFamily: FONT,
        }}
      >
        GPS degraded
      </span>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EnvironmentalReactionLayer() {
  const { mode } = useHudPresentation()
  const { userLocation, panelsLocationBlocked } = usePanelData()
  const { state } = useAppContext()
  const movement = useMovementEngine()
  const atmosphere = useWeatherAtmosphere()
  const reducedMotion = useReducedMotion()

  const isImmersive = mode === 'immersive'

  // ── Nearest active waypoint (debounced to prevent distance jitter) ───────
  const [debouncedLocation, setDebouncedLocation] = useState(userLocation)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedLocation(userLocation)
    }, ROUTE_METRICS_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [userLocation?.lat, userLocation?.lng, userLocation])

  const nearestTarget = useMemo(() => {
    if (!debouncedLocation || state.waypoints.length === 0) return null
    let best: { wp: (typeof state.waypoints)[0]; dist: number } | null = null
    for (const wp of state.waypoints) {
      if (wp.status === 'completed' || wp.status === 'archived') continue
      const dist = haversineMeters(debouncedLocation.lat, debouncedLocation.lng, wp.lat, wp.lng)
      if (!best || dist < best.dist) best = { wp, dist }
    }
    return best
  }, [debouncedLocation, state.waypoints])

  // ── GPS health ────────────────────────────────────────────────────────────
  const isGpsDegraded = panelsLocationBlocked

  // ── Visibility gates ──────────────────────────────────────────────────────

  if (!isImmersive) return null

  // Nothing to show in calm conditions with no relevant context
  const showApproach = nearestTarget !== null && nearestTarget.dist < APPROACH_DIST
  const showStorm = atmosphere.tone === 'storm'
  const showGpsDegraded = isGpsDegraded && movement.state !== 'unknown'

  if (!showApproach && !showStorm && !showGpsDegraded) return null

  return (
    <>
      <div
        aria-hidden="false"
        data-testid="environmental-reaction-layer"
        style={{
          position: 'fixed',
          bottom: 'calc(84px + env(safe-area-inset-bottom))',
          left: 16,
          zIndex: 150,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
          maxWidth: 260,
        }}
      >
        {showApproach && nearestTarget && (
          <ApproachIndicator
            distance={nearestTarget.dist}
            label={nearestTarget.wp.label}
            reducedMotion={reducedMotion}
          />
        )}
        {showStorm && (
          <StormEdgeIndicator tone={atmosphere.tone} reducedMotion={reducedMotion} />
        )}
        {showGpsDegraded && (
          <GpsDegradedIndicator reducedMotion={reducedMotion} />
        )}
      </div>

      <style>{`
        @keyframes reactionEnter {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes arrivalPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%       { transform: scale(1.6); opacity: 0.6; }
        }
      `}</style>
    </>
  )
}

export default EnvironmentalReactionLayer
