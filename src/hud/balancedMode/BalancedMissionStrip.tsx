/**
 * Balanced Mission Strip
 * ======================
 *
 * Compact mission information display for the Balanced Layer.
 *
 * NO CockpitContext dependency
 * NO HudPanel inheritance
 *
 * RESPONSIBILITIES:
 * - Mission name display
 * - Check-in interval control
 * - Team member count
 * - Last check-in status
 */

import React from 'react'
import type { MissionPanelState } from './hooks/useBalancedPanels'

interface BalancedMissionStripProps {
  state: MissionPanelState
  waypointCount?: number
  routeDistanceMeters?: number
  routeName?: string
  setMissionName: (name: string) => void
  setCheckInInterval: (minutes: number) => void
  onClose: () => void
}

const BALANCED_TOKENS = {
  bg: 'rgba(28, 28, 30, 0.85)',
  border: 'rgba(120, 120, 128, 0.25)',
  text: {
    primary: 'rgba(255, 255, 255, 0.95)',
    secondary: 'rgba(255, 255, 255, 0.6)',
    tertiary: 'rgba(255, 255, 255, 0.4)',
  },
  accent: {
    primary: '#0a84ff',
    success: '#30d158',
    warning: '#ff9f0a',
    danger: '#ff453a',
  },
  radius: 12,
  blur: 'blur(20px)',
} as const

const CHECK_IN_INTERVALS = [15, 30, 60, 120]

export default function BalancedMissionStrip({
  state,
  waypointCount = 0,
  routeDistanceMeters = 0,
  routeName,
  setMissionName,
  setCheckInInterval,
  onClose,
}: BalancedMissionStripProps) {
  // Format last check-in time
  const lastCheckInText = React.useMemo(() => {
    if (!state.lastCheckIn) return 'Not yet'
    const last = new Date(state.lastCheckIn)
    const now = new Date()
    const diff = Math.floor((now.getTime() - last.getTime()) / 60000)
    if (diff < 1) return 'Just now'
    if (diff < 60) return `${diff} min ago`
    const hours = Math.floor(diff / 60)
    return `${hours}h ago`
  }, [state.lastCheckIn])

  // Next check-in due time
  const nextCheckInDue = React.useMemo(() => {
    if (!state.lastCheckIn) return 'Now'
    const last = new Date(state.lastCheckIn)
    const next = new Date(last.getTime() + state.checkInInterval * 60000)
    const now = new Date()
    const diff = Math.floor((next.getTime() - now.getTime()) / 60000)
    if (diff < 0) return 'Overdue'
    if (diff < 60) return `${diff} min`
    const hours = Math.floor(diff / 60)
    const mins = diff % 60
    return `${hours}h ${mins}m`
  }, [state.lastCheckIn, state.checkInInterval])

  const routeSummary = React.useMemo(() => {
    if (waypointCount < 2) {
      return waypointCount === 1 ? '1 waypoint — add another for route' : 'No route — drop waypoints on map'
    }
    const miles = routeDistanceMeters / 1609.344
    const dist = miles >= 0.1 ? `${miles.toFixed(1)} mi` : `${Math.round(routeDistanceMeters)} m`
    const label = routeName?.trim() ? routeName.trim() : 'Active route'
    return `${label} · ${waypointCount} pts · ${dist}`
  }, [waypointCount, routeDistanceMeters, routeName])

  const statusColor = nextCheckInDue === 'Overdue'
    ? BALANCED_TOKENS.accent.danger
    : nextCheckInDue === 'Now'
    ? BALANCED_TOKENS.accent.warning
    : BALANCED_TOKENS.accent.success

  return (
    <div
      style={{
        background: BALANCED_TOKENS.bg,
        backdropFilter: BALANCED_TOKENS.blur,
        borderRadius: BALANCED_TOKENS.radius,
        border: `1px solid ${BALANCED_TOKENS.border}`,
        padding: '12px 16px',
        minWidth: 280,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        pointerEvents: 'auto',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      }}
      data-balanced-panel="mission"
    >
      {/* Mission Icon */}
      <div style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        background: `${BALANCED_TOKENS.accent.primary}20`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 20,
      }}>
        🎯
      </div>

      {/* Mission Info */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <input
          type="text"
          value={state.missionName}
          onChange={(e) => setMissionName(e.target.value)}
          placeholder="Mission Name..."
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontSize: 15,
            fontWeight: 600,
            color: BALANCED_TOKENS.text.primary,
            fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
            outline: 'none',
            width: '100%',
          }}
        />
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          color: BALANCED_TOKENS.text.secondary,
          fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
        }}>
          <span>👥 {state.teamMembers.length || 1}</span>
          <span>•</span>
          <span>{routeSummary}</span>
          <span>•</span>
          <span>Last: {lastCheckInText}</span>
        </div>
      </div>

      {/* Check-in Status */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 4,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          background: `${statusColor}20`,
          borderRadius: 12,
          border: `1px solid ${statusColor}40`,
        }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: statusColor,
            animation: nextCheckInDue === 'Overdue' ? 'pulse 1s ease-in-out infinite' : 'none',
          }} />
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: statusColor,
            fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
          }}>
            {nextCheckInDue}
          </span>
        </div>
        <select
          value={state.checkInInterval}
          onChange={(e) => setCheckInInterval(parseInt(e.target.value, 10))}
          style={{
            background: 'rgba(0, 0, 0, 0.3)',
            border: `1px solid ${BALANCED_TOKENS.border}`,
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11,
            color: BALANCED_TOKENS.text.secondary,
            fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {CHECK_IN_INTERVALS.map(interval => (
            <option key={interval} value={interval}>
              {interval} min
            </option>
          ))}
        </select>
      </div>

      {/* Close Button */}
      <button
        onClick={onClose}
        style={{
          background: 'transparent',
          border: 'none',
          color: BALANCED_TOKENS.text.tertiary,
          cursor: 'pointer',
          padding: 4,
          fontSize: 14,
          marginLeft: 4,
        }}
        aria-label="Close mission strip"
      >
        ✕
      </button>
    </div>
  )
}
