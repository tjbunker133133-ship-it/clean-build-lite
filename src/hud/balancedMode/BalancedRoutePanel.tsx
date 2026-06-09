/**
 * Balanced Route Panel (Polished)
 * ================================
 *
 * Clean route planning for the Balanced Layer.
 *
 * UX Principles:
 * - Simplified: fewer controls, clearer actions
 * - Metrics-focused: show what matters for planning
 * - One-tap corridor toggle
 * - No overwhelming route management UI
 *
 * NO CockpitContext | NO dock logic | NO resize handles
 */

import React, { useCallback, useMemo, useState } from 'react'
import type { RoutePanelState } from './hooks/useBalancedPanels'
import { formatDistance } from '../../lib/haversine'
import { colors, spacing, typography, effects, zIndex } from './lib/balancedTokens'

interface BalancedRoutePanelProps {
  state: RoutePanelState
  setRouteName: (name: string) => void
  setCorridorEnabled: (enabled: boolean) => void
  setCorridorWidth: (width: number) => void
  onAction?: (action: 'create' | 'edit' | 'clear', routeId?: string) => void
  isCollapsed: boolean
  onCollapse: () => void
  onExpand: () => void
  onClose: () => void
}

export default function BalancedRoutePanel({
  state,
  setRouteName,
  setCorridorEnabled,
  setCorridorWidth,
  onAction,
  isCollapsed,
  onCollapse,
  onExpand,
  onClose,
}: BalancedRoutePanelProps) {
  const [isEditingName, setIsEditingName] = useState(false)

  // Format metrics
  const formattedDistance = useMemo(() => {
    if (!state.totalDistance) return '--'
    return formatDistance(state.totalDistance / 1609.344)
  }, [state.totalDistance])

  const formattedDuration = useMemo(() => {
    if (!state.estimatedDuration) return '--'
    const hours = Math.floor(state.estimatedDuration / 3600)
    const minutes = Math.floor((state.estimatedDuration % 3600) / 60)
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes} min`
  }, [state.estimatedDuration])

  const hasRoute = state.legs.length > 0

  // ═══════════════════════════════════════════════════════════════════════════
  // COLLAPSED VIEW: Metrics at a glance
  // ═══════════════════════════════════════════════════════════════════════════

  if (isCollapsed) {
    return (
      <button
        onClick={onExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.sm,
          padding: `${spacing.md}px ${spacing.lg}px`,
          minWidth: 200,
          background: colors.bg.panel,
          backdropFilter: effects.blur.md,
          borderRadius: effects.radius.md,
          border: `1px solid ${state.corridorEnabled ? `${colors.accent.success}40` : colors.border.default}`,
          boxShadow: effects.shadow.md,
          cursor: 'pointer',
          transition: effects.transition.fast,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = colors.bg.card
          e.currentTarget.style.borderColor = state.corridorEnabled
            ? `${colors.accent.success}60`
            : colors.border.hover
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = colors.bg.panel
          e.currentTarget.style.borderColor = state.corridorEnabled
            ? `${colors.accent.success}40`
            : colors.border.default
        }}
        data-balanced-panel="route"
        data-collapsed
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          <span style={{ fontSize: 16 }}>📍</span>
          <span style={{
            fontSize: typography.size.base,
            fontWeight: typography.weight.medium,
            color: colors.text.primary,
            fontFamily: typography.fontFamily,
          }}>
            {state.routeName || 'Route'}
          </span>
          {state.corridorEnabled && (
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: colors.accent.success,
            }} />
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          <span style={{
            fontSize: typography.size.sm,
            color: colors.text.secondary,
            fontFamily: typography.fontFamily,
          }}>
            {hasRoute ? formattedDistance : 'Plan'}
          </span>
          <span style={{ fontSize: 12, color: colors.text.tertiary }}>▲</span>
        </div>
      </button>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPANDED VIEW
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.md,
        padding: spacing.lg,
        width: spacing.panel.width.md,
        maxHeight: spacing.panel.maxHeight.md,
        background: colors.bg.panel,
        backdropFilter: effects.blur.md,
        borderRadius: effects.radius.md,
        border: `1px solid ${state.corridorEnabled ? `${colors.accent.success}30` : colors.border.default}`,
        boxShadow: effects.shadow.lg,
        overflow: 'hidden',
        zIndex: zIndex.panels,
      }}
      data-balanced-panel="route"
      data-expanded
    >
      {/* ═══════════════════════════════════════════════════════════════════════
          HEADER
         ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: spacing.sm,
        borderBottom: `1px solid ${colors.border.default}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          <span style={{ fontSize: 18 }}>📍</span>
          <span style={{
            fontSize: typography.size.xl,
            fontWeight: typography.weight.semibold,
            color: colors.text.primary,
            fontFamily: typography.fontFamily,
          }}>
            Route
          </span>
        </div>

        <div style={{ display: 'flex', gap: spacing.xs }}>
          <HeaderButton onClick={onCollapse} icon="─" label="Collapse" testId="balanced-route-panel-collapse" />
          <HeaderButton onClick={onClose} icon="✕" label="Close" testId="balanced-route-panel-close" />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          ROUTE NAME (inline editable)
         ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
        <label style={{
          fontSize: typography.size.xs,
          fontWeight: typography.weight.medium,
          color: colors.text.secondary,
          textTransform: 'uppercase',
          letterSpacing: typography.letterSpacing.label,
          fontFamily: typography.fontFamily,
        }}>
          Route Name
        </label>

        {isEditingName ? (
          <input
            type="text"
            value={state.routeName}
            onChange={(e) => setRouteName(e.target.value)}
            onBlur={() => setIsEditingName(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setIsEditingName(false)
            }}
            autoFocus
            placeholder="Enter route name..."
            style={{
              padding: `${spacing.sm}px ${spacing.md}px`,
              background: colors.bg.input,
              border: `1px solid ${colors.border.active}`,
              borderRadius: effects.radius.md,
              fontSize: typography.size.base,
              color: colors.text.primary,
              fontFamily: typography.fontFamily,
              outline: 'none',
            }}
          />
        ) : (
          <button
            onClick={() => setIsEditingName(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: `${spacing.sm}px ${spacing.md}px`,
              background: colors.bg.input,
              border: `1px solid ${colors.border.default}`,
              borderRadius: effects.radius.md,
              cursor: 'pointer',
              transition: effects.transition.fast,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = colors.border.hover
              e.currentTarget.style.background = colors.bg.hover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = colors.border.default
              e.currentTarget.style.background = colors.bg.input
            }}
          >
            <span style={{
              fontSize: typography.size.base,
              color: state.routeName ? colors.text.primary : colors.text.tertiary,
              fontFamily: typography.fontFamily,
            }}>
              {state.routeName || 'Unnamed Route'}
            </span>
            <span style={{ fontSize: 12, color: colors.text.tertiary }}>✎</span>
          </button>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          METRICS (primary info)
         ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: spacing.sm,
        padding: spacing.md,
        background: colors.bg.card,
        borderRadius: effects.radius.md,
      }}>
        <Metric
          label="Distance"
          value={hasRoute ? formattedDistance : '--'}
          highlighted={hasRoute}
        />
        <Metric
          label="Est. Time"
          value={hasRoute ? formattedDuration : '--'}
          highlighted={hasRoute}
        />
        <Metric
          label="Legs"
          value={hasRoute ? String(state.legs.length) : '--'}
          highlighted={hasRoute}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          CORRIDOR (simple toggle + slider)
         ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.sm,
        padding: spacing.md,
        background: state.corridorEnabled ? `${colors.accent.success}08` : colors.bg.card,
        borderRadius: effects.radius.md,
        border: `1px solid ${state.corridorEnabled ? `${colors.accent.success}30` : 'transparent'}`,
        transition: effects.transition.normal,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
            <span style={{ fontSize: 16 }}>🛡️</span>
            <span style={{
              fontSize: typography.size.base,
              fontWeight: typography.weight.medium,
              color: colors.text.primary,
              fontFamily: typography.fontFamily,
            }}>
              Safety Corridor
            </span>
          </div>

          <Switch
            checked={state.corridorEnabled}
            onChange={() => setCorridorEnabled(!state.corridorEnabled)}
          />
        </div>

        {state.corridorEnabled && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: spacing.xs,
            paddingTop: spacing.sm,
            borderTop: `1px solid ${colors.border.default}`,
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: typography.size.xs,
              color: colors.text.secondary,
              fontFamily: typography.fontFamily,
            }}>
              <span>Width: {state.corridorWidth}m</span>
              <span>50m – 200m</span>
            </div>
            <input
              type="range"
              min={50}
              max={200}
              step={10}
              value={state.corridorWidth}
              onChange={(e) => setCorridorWidth(parseInt(e.target.value, 10))}
              style={{
                width: '100%',
                accentColor: colors.accent.success,
              }}
            />
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          PRIMARY ACTIONS
         ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex',
        gap: spacing.sm,
        marginTop: 'auto',
        paddingTop: spacing.sm,
      }}>
        <PrimaryButton
          onClick={() => onAction?.('create')}
          label={hasRoute ? 'New Route' : 'Plan Route'}
          icon="✚"
        />

        {hasRoute && (
          <SecondaryButton
            onClick={() => onAction?.('clear')}
            label="Clear"
            danger
          />
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUBCOMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function HeaderButton({ onClick, icon, label, testId }: { onClick: () => void; icon: string; label: string; testId?: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      data-testid={testId}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        background: 'transparent',
        border: 'none',
        borderRadius: effects.radius.sm,
        cursor: 'pointer',
        color: colors.text.tertiary,
        fontSize: 12,
        transition: effects.transition.fast,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = colors.bg.hover
        e.currentTarget.style.color = colors.text.secondary
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent'
        e.currentTarget.style.color = colors.text.tertiary
      }}
    >
      {icon}
    </button>
  )
}

function Metric({ label, value, highlighted }: { label: string; value: string; highlighted: boolean }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4,
    }}>
      <span style={{
        fontSize: typography.size.xs,
        color: colors.text.tertiary,
        textTransform: 'uppercase',
        letterSpacing: typography.letterSpacing.label,
        fontFamily: typography.fontFamily,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: typography.size.xl,
        fontWeight: typography.weight.semibold,
        color: highlighted ? colors.text.primary : colors.text.tertiary,
        fontFamily: typography.fontFamily,
      }}>
        {value}
      </span>
    </div>
  )
}

function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      style={{
        position: 'relative',
        width: 44,
        height: 24,
        background: checked ? colors.accent.success : 'rgba(120, 120, 128, 0.4)',
        border: 'none',
        borderRadius: effects.radius.full,
        cursor: 'pointer',
        transition: effects.transition.normal,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 2,
        left: checked ? 22 : 2,
        width: 20,
        height: 20,
        background: 'white',
        borderRadius: '50%',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        transition: effects.transition.normal,
      }} />
    </button>
  )
}

function PrimaryButton({ onClick, label, icon }: { onClick: () => void; label: string; icon?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        flex: 1,
        padding: `${spacing.md}px ${spacing.lg}px`,
        minHeight: spacing.touch.comfortable,
        background: colors.accent.primary,
        border: 'none',
        borderRadius: effects.radius.md,
        cursor: 'pointer',
        color: 'white',
        fontSize: typography.size.base,
        fontWeight: typography.weight.medium,
        fontFamily: typography.fontFamily,
        transition: effects.transition.fast,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#0b8fff'
        e.currentTarget.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = colors.accent.primary
        e.currentTarget.style.transform = 'none'
      }}
    >
      {icon && <span>{icon}</span>}
      {label}
    </button>
  )
}

function SecondaryButton({ onClick, label, danger }: { onClick: () => void; label: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: `${spacing.md}px ${spacing.lg}px`,
        minHeight: spacing.touch.comfortable,
        background: 'transparent',
        border: `1px solid ${danger ? colors.accent.danger : colors.border.default}`,
        borderRadius: effects.radius.md,
        cursor: 'pointer',
        color: danger ? colors.accent.danger : colors.text.secondary,
        fontSize: typography.size.base,
        fontWeight: typography.weight.medium,
        fontFamily: typography.fontFamily,
        transition: effects.transition.fast,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'rgba(255, 69, 58, 0.1)' : colors.bg.hover
        e.currentTarget.style.borderColor = danger ? colors.accent.danger : colors.border.hover
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.borderColor = danger ? colors.accent.danger : colors.border.default
      }}
    >
      {label}
    </button>
  )
}
