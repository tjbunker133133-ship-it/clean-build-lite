/**
 * Modern Route Sheet — operational route planning for immersive mode.
 */

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useAppContext } from '../../context/AppContext'
import { useOperationalSession } from '../../context/OperationalSessionContext'
import {
  buildRouteMetrics,
  formatRouteDistance,
  formatRouteDuration,
} from '../../lib/routeMetrics'
import {
  enterNavigationMode,
  getInteractionMode,
  getMapInteractionSnapshot,
  subscribeMapInteraction,
  syncModernMeasure,
} from '../../lib/mapInteractionController'
import {
  logModernGuardrailApplied,
  logModernGuardrailTransition,
  ROUTE_METRICS_DEBOUNCE_MS,
  validateRouteForNavigation,
} from '../../lib/modernLayerGuardrails'
import { migrateLegacyWaypointStatuses } from '../../lib/waypointNavigation'
import type { Waypoint } from '../../types'

logModernGuardrailApplied('ModernRouteSheet')

interface ModernRouteSheetProps {
  onClose: () => void
}

function waypointLabel(wp: Waypoint, index: number): string {
  return wp.label || `${wp.type.charAt(0).toUpperCase()}${wp.type.slice(1)} ${index + 1}`
}

export default function ModernRouteSheet({ onClose }: ModernRouteSheetProps) {
  const { state, setWaypoints, removeWaypoint } = useAppContext()
  const {
    session,
    setRouteName,
    setPhase,
    setCorridorEnabled,
    setShowLabels,
    setShowDistances,
  } = useOperationalSession()
  const [editingName, setEditingName] = useState(false)
  const [navFeedback, setNavFeedback] = useState<string | null>(null)
  const [debouncedWaypoints, setDebouncedWaypoints] = useState(state.waypoints)
  const interaction = useSyncExternalStore(
    subscribeMapInteraction,
    getMapInteractionSnapshot,
    getMapInteractionSnapshot,
  )
  const measureActive = getInteractionMode() === 'measure' && interaction.surface === 'modern'

  const activeWaypoints = useMemo(
    () => state.waypoints.filter((w) => w.status !== 'archived'),
    [state.waypoints],
  )
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedWaypoints(state.waypoints)
    }, ROUTE_METRICS_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [state.waypoints])

  const metrics = useMemo(() => buildRouteMetrics(debouncedWaypoints), [debouncedWaypoints])
  const hasRoute = metrics.legs.length > 0

  useEffect(() => {
    if (activeWaypoints.length >= 2) {
      setPhase('planning')
    }
  }, [activeWaypoints.length, setPhase])

  useEffect(() => {
    return () => {
      if (getInteractionMode() === 'measure' && interaction.surface === 'modern') {
        syncModernMeasure(false)
      }
    }
  }, [interaction.surface])

  const handleClose = useCallback(() => {
    syncModernMeasure(false)
    onClose()
  }, [onClose])

  const toggleMeasure = useCallback(() => {
    syncModernMeasure(!measureActive)
  }, [measureActive])

  const moveWaypoint = useCallback(
    (index: number, direction: -1 | 1) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= activeWaypoints.length) return
      const ordered = [...activeWaypoints]
      const [item] = ordered.splice(index, 1)
      ordered.splice(nextIndex, 0, item)
      const archived = state.waypoints.filter((w) => w.status === 'archived')
      setWaypoints([...ordered, ...archived])
    },
    [activeWaypoints, setWaypoints, state.waypoints],
  )

  const clearRoute = useCallback(() => {
    setWaypoints([])
    setPhase('idle')
    setNavFeedback(null)
  }, [setPhase, setWaypoints])

  const handleBeginNavigation = useCallback(() => {
    logModernGuardrailTransition('route-start-attempt', {
      waypointCount: activeWaypoints.length,
    })

    const validation = validateRouteForNavigation(state.waypoints)
    if (!validation.ok) {
      setNavFeedback(validation.reason)
      logModernGuardrailTransition('route-start-failed', { reason: validation.reason })
      return
    }

    const migrated = migrateLegacyWaypointStatuses(validation.waypoints)
    const archived = state.waypoints.filter((w) => w.status === 'archived')
    const needsMigration = migrated.some(
      (wp, i) => wp.status !== validation.waypoints[i]?.status,
    )
    if (needsMigration) {
      setWaypoints([...migrated, ...archived])
    }

    const entered = enterNavigationMode('modern')
    if (!entered) {
      const message = 'Navigation unavailable — check route and try again'
      setNavFeedback(message)
      logModernGuardrailTransition('route-start-failed', { reason: 'osg_rejected' })
      return
    }

    setPhase('navigating')
    syncModernMeasure(false)
    setNavFeedback(null)
    logModernGuardrailTransition('route-start-success', {
      waypointCount: migrated.length,
    })
    onClose()
  }, [activeWaypoints.length, onClose, setPhase, setWaypoints, state.waypoints])

  return (
    <div
      className="route-sheet-container modern-spatial-sheet"
      data-sheet-layer="modern"
      data-testid="modern-route-sheet"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 5000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'none',
        padding: '0 16px calc(24px + env(safe-area-inset-bottom, 0px))',
        maxHeight: '92vh',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 500,
          background: 'rgba(20, 28, 26, 0.98)',
          borderRadius: '24px 24px 32px 32px',
          border: '1px solid rgba(0, 255, 180, 0.12)',
          backdropFilter: 'blur(30px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(30px) saturate(1.4)',
          boxShadow: '0 -8px 40px rgba(0, 0, 0, 0.45)',
          pointerEvents: 'auto',
          overflow: 'hidden',
          maxHeight: 'min(88vh, 720px)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 8px', flexShrink: 0 }}>
          <div style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.2)' }} />
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>
              Route
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
              {hasRoute ? 'Operational field route' : 'Drop waypoints to plan'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.8)',
              fontSize: 18,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '16px 20px 0', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {[
            { label: 'Distance', value: hasRoute ? formatRouteDistance(metrics.totalDistance) : '—' },
            { label: 'Est. walk', value: formatRouteDuration(metrics.estimatedDuration) },
            { label: 'Points', value: String(activeWaypoints.length) },
          ].map((metric) => (
            <div
              key={metric.label}
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                background: 'rgba(0,255,180,0.06)',
                border: '1px solid rgba(0,255,180,0.12)',
              }}
            >
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase' }}>
                {metric.label}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#00ffb4', marginTop: 4 }}>{metric.value}</div>
            </div>
          ))}
        </div>

        <div style={{ padding: '16px 20px 0' }}>
          {editingName ? (
            <input
              value={session.routeName}
              onChange={(e) => setRouteName(e.target.value)}
              onBlur={() => setEditingName(false)}
              autoFocus
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 12,
                border: '1px solid rgba(0,255,180,0.25)',
                background: 'rgba(255,255,255,0.05)',
                color: 'rgba(255,255,255,0.9)',
                fontSize: 16,
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '12px 14px',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.03)',
                color: 'rgba(255,255,255,0.9)',
                fontSize: 16,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {session.routeName || 'Field route'}
            </button>
          )}
        </div>

        <div style={{ padding: '12px 20px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setCorridorEnabled(!session.corridorEnabled)}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: `1px solid ${session.corridorEnabled ? 'rgba(0,255,180,0.4)' : 'rgba(255,255,255,0.15)'}`,
              background: session.corridorEnabled ? 'rgba(0,255,180,0.12)' : 'transparent',
              color: session.corridorEnabled ? '#00ffb4' : 'rgba(255,255,255,0.7)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Corridor {session.corridorEnabled ? 'on' : 'off'}
          </button>
          <button
            type="button"
            onClick={() => setShowLabels(!session.showLabels)}
            style={chipStyle(session.showLabels)}
          >
            Labels
          </button>
          <button
            type="button"
            onClick={() => setShowDistances(!session.showDistances)}
            style={chipStyle(session.showDistances)}
          >
            Distances
          </button>
          <button
            type="button"
            onClick={toggleMeasure}
            data-testid="modern-measure-toggle"
            style={chipStyle(measureActive)}
          >
            {measureActive ? 'Measuring…' : 'Measure'}
          </button>
        </div>

        <div style={{ padding: '0 20px 20px', flex: 1, minHeight: 0, maxHeight: '38vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {activeWaypoints.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px 12px', color: 'rgba(255,255,255,0.45)' }}>
              <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }}>🧭</div>
              Long-press the map to drop waypoints, then reorder here.
            </div>
          ) : (
            activeWaypoints.map((wp, index) => (
              <div
                key={wp.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: index === 0 ? '#22c55e' : index === activeWaypoints.length - 1 ? '#f472b6' : '#3b82f6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'white',
                    flexShrink: 0,
                  }}
                >
                  {index + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                    {waypointLabel(wp, index)}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                    {wp.lat.toFixed(4)}, {wp.lng.toFixed(4)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" onClick={() => moveWaypoint(index, -1)} disabled={index === 0} style={iconBtnStyle}>
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveWaypoint(index, 1)}
                    disabled={index === activeWaypoints.length - 1}
                    style={iconBtnStyle}
                  >
                    ↓
                  </button>
                  <button type="button" onClick={() => removeWaypoint(wp.id)} style={iconBtnStyle}>
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {hasRoute ? (
          <div style={{ padding: '0 20px 24px' }}>
            {navFeedback ? (
              <div
                role="alert"
                style={{
                  marginBottom: 10,
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'rgba(255, 59, 48, 0.12)',
                  border: '1px solid rgba(255, 59, 48, 0.35)',
                  color: '#ff8a80',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {navFeedback}
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleBeginNavigation}
              data-testid="modern-begin-navigation"
              style={{
                width: '100%',
                padding: '14px 20px',
                borderRadius: 14,
                border: 'none',
                background: 'rgba(0, 255, 180, 0.9)',
                color: '#0a1210',
                fontSize: 16,
                fontWeight: 700,
                cursor: 'pointer',
                marginBottom: 10,
              }}
            >
              Begin navigation
            </button>
            <button
              type="button"
              onClick={clearRoute}
              style={{
                width: '100%',
                padding: '12px 20px',
                borderRadius: 14,
                border: '1px solid rgba(255,59,48,0.35)',
                background: 'transparent',
                color: '#ff6b6b',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Clear route
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 12px',
    borderRadius: 10,
    border: `1px solid ${active ? 'rgba(0,255,180,0.4)' : 'rgba(255,255,255,0.15)'}`,
    background: active ? 'rgba(0,255,180,0.12)' : 'transparent',
    color: active ? '#00ffb4' : 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  }
}

const iconBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.05)',
  color: 'rgba(255,255,255,0.75)',
  fontSize: 12,
  cursor: 'pointer',
}
