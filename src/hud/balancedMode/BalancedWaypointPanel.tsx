/**
 * Balanced Waypoint Panel (Polished)
 * ===================================
 *
 * Clean, calm waypoint management for the Balanced Layer.
 *
 * UX Principles:
 * - Map-first: waypoints created on map, listed here for reference
 * - One-tap actions: minimal cognitive load
 * - Clear state: active tool indicator, armed type visibility
 * - Gentle affordances: subtle hover states, no aggressive styling
 *
 * NO CockpitContext | NO dock logic | NO resize handles
 */

import React, { useCallback, useMemo, useState } from 'react'
import type { WaypointPanelState } from './hooks/useBalancedPanels'
import type { ToolMode } from './hooks/useBalancedWorkspace'
import { hudConfirm } from '../../lib/hudConfirm'
import { colors, spacing, typography, effects, waypointTypes, zIndex } from './lib/balancedTokens'

type WaypointTypeKey = keyof typeof waypointTypes

function resolveWaypointTypeConfig(type: string | null | undefined) {
  if (!type || type === 'default') return waypointTypes.pin
  return waypointTypes[type as WaypointTypeKey] ?? waypointTypes.pin
}

interface BalancedWaypointPanelProps {
  state: WaypointPanelState
  selectWaypoint: (id: string | null) => void
  setPendingWaypointType: (type: string | null) => void
  toggleWaypointLabels: () => void
  toggleWaypointDistances: () => void
  deleteWaypoint?: (id: string) => void
  clearAllWaypoints?: () => void
  activeTool: ToolMode
  isCollapsed: boolean
  onCollapse: () => void
  onExpand: () => void
  onClose: () => void
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function BalancedWaypointPanel({
  state,
  selectWaypoint,
  setPendingWaypointType,
  toggleWaypointLabels,
  toggleWaypointDistances,
  deleteWaypoint,
  clearAllWaypoints,
  activeTool,
  isCollapsed,
  onCollapse,
  onExpand,
  onClose,
}: BalancedWaypointPanelProps) {
  // Track armed type for visual feedback
  const [hoveredType, setHoveredType] = useState<WaypointTypeKey | null>(null)

  const isToolActive = activeTool === 'waypoint'
  const armedType = state.pendingWaypointType
  const armedTypeConfig = resolveWaypointTypeConfig(armedType)
  const hasWaypoints = state.waypoints.length > 0

  // Active waypoints (not archived)
  const activeWaypoints = useMemo(
    () => state.waypoints.filter(w => w.status !== 'archived'),
    [state.waypoints]
  )

  // Handle type selection - arm tool first so sync effect does not disarm pending type
  const handleTypeClick = useCallback((type: WaypointTypeKey) => {
    if (armedType === type && isToolActive) {
      setPendingWaypointType('pin')
    } else {
      setPendingWaypointType(type)
    }
  }, [armedType, isToolActive, setPendingWaypointType])


  // Handle waypoint deletion with confirmation feel
  const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!id || !deleteWaypoint) {
      console.warn('[BalancedWaypointPanel] Delete attempted without valid ID or handler:', { id, hasHandler: !!deleteWaypoint })
      return
    }
    void hudConfirm({
      title: 'Delete waypoint?',
      message: `Delete waypoint "${activeWaypoints.find(w => w.id === id)?.label ?? id}"?`,
      confirmLabel: 'Delete',
      destructive: true,
    }).then((ok) => {
      if (ok) deleteWaypoint(id)
    })
  }, [deleteWaypoint, activeWaypoints])

  const handleClearAll = useCallback(() => {
    if (!clearAllWaypoints) {
      console.warn('[BalancedWaypointPanel] Clear all attempted without handler')
      return
    }
    void hudConfirm({
      title: 'Clear all waypoints?',
      message: `Remove all ${activeWaypoints.length} waypoints from the map?`,
      confirmLabel: 'Clear all',
      destructive: true,
    }).then((ok) => {
      if (ok) clearAllWaypoints()
    })
  }, [activeWaypoints.length, clearAllWaypoints])

  // ═════════════════════════════════════════════════════════════════════════════
  // COLLAPSED VIEW: Just count and expand affordance
  // ═════════════════════════════════════════════════════════════════════════════

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
          minWidth: 180,
          background: colors.bg.panel,
          backdropFilter: effects.blur.md,
          borderRadius: effects.radius.md,
          border: `1px solid ${colors.border.default}`,
          boxShadow: effects.shadow.md,
          cursor: 'pointer',
          transition: effects.transition.fast,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = colors.border.hover
          e.currentTarget.style.background = colors.bg.card
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = colors.border.default
          e.currentTarget.style.background = colors.bg.panel
        }}
        data-balanced-panel="waypoints"
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
            Waypoints
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          {/* Armed indicator */}
          {isToolActive && armedType && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: waypointTypes[armedType]?.color || colors.accent.warning,
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
          )}

          {/* Count badge */}
          <span style={{
            fontSize: typography.size.sm,
            color: colors.text.secondary,
            fontFamily: typography.fontFamily,
            minWidth: 24,
            textAlign: 'center',
          }}>
            {activeWaypoints.length}
          </span>

          {/* Expand chevron */}
          <span style={{ fontSize: 12, color: colors.text.tertiary }}>▲</span>
        </div>
      </button>
    )
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // EXPANDED VIEW: Full panel
  // ═════════════════════════════════════════════════════════════════════════════

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
        border: `1px solid ${colors.border.default}`,
        boxShadow: effects.shadow.lg,
        overflow: 'hidden',
        zIndex: zIndex.panels,
      }}
      data-balanced-panel="waypoints"
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
            Waypoints
          </span>
          {hasWaypoints && (
            <span style={{
              fontSize: typography.size.sm,
              color: colors.text.secondary,
              background: 'rgba(120, 120, 128, 0.2)',
              padding: `2px ${spacing.sm}px`,
              borderRadius: effects.radius.full,
              fontFamily: typography.fontFamily,
            }}>
              {activeWaypoints.length}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: spacing.xs }}>
          <HeaderButton onClick={onCollapse} label="Collapse" icon="─" />
          <HeaderButton onClick={onClose} label="Close" icon="✕" testId="balanced-waypoint-panel-close" />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          TOOL ACTIVATOR: Select type to drop on map
         ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        <label style={{
          fontSize: typography.size.xs,
          fontWeight: typography.weight.medium,
          color: colors.text.secondary,
          textTransform: 'uppercase',
          letterSpacing: typography.letterSpacing.label,
          fontFamily: typography.fontFamily,
        }}>
          {isToolActive ? 'Tap map to drop' : 'Select type to start'}
        </label>

        {/* Type grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: spacing.sm,
        }}>
          {(Object.keys(waypointTypes) as WaypointTypeKey[]).map((type) => {
            const config = waypointTypes[type]
            const isSelected = armedType === type && isToolActive
            const isHovered = hoveredType === type

            return (
              <button
                key={type}
                onClick={() => handleTypeClick(type)}
                onMouseEnter={() => setHoveredType(type)}
                onMouseLeave={() => setHoveredType(null)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  padding: `${spacing.sm}px ${spacing.xs}px`,
                  minHeight: spacing.touch.min,
                  background: isSelected
                    ? `${config.color}18`
                    : isHovered
                      ? colors.bg.hover
                      : colors.bg.input,
                  border: `2px solid ${isSelected ? config.color : 'transparent'}`,
                  borderRadius: effects.radius.md,
                  cursor: 'pointer',
                  transition: effects.transition.fast,
                }}
                title={config.label}
              >
                <span style={{ fontSize: 20, filter: isSelected ? 'none' : 'grayscale(30%)' }}>
                  {config.icon}
                </span>
                <span style={{
                  fontSize: typography.size.xs,
                  fontWeight: isSelected ? typography.weight.medium : typography.weight.regular,
                  color: isSelected ? config.color : colors.text.secondary,
                  fontFamily: typography.fontFamily,
                  textTransform: 'capitalize',
                }}>
                  {config.label}
                </span>
              </button>
            )
          })}
        </div>

        {/* Armed state hint */}
        {isToolActive && armedType && armedType !== 'default' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
            padding: `${spacing.sm}px ${spacing.md}px`,
            background: `${armedTypeConfig.color}12`,
            borderRadius: effects.radius.sm,
            border: `1px solid ${armedTypeConfig.color}30`,
          }}>
            <span style={{ fontSize: 16 }}>{armedTypeConfig.icon}</span>
            <span style={{
              fontSize: typography.size.sm,
              color: armedTypeConfig.color,
              fontFamily: typography.fontFamily,
            }}>
              Tap anywhere on map to drop {armedTypeConfig.label}
            </span>
            <button
              onClick={() => setPendingWaypointType(null)}
              style={{
                padding: `2px ${spacing.xs}px`,
                background: 'transparent',
                border: 'none',
                color: colors.text.tertiary,
                fontSize: typography.size.sm,
                cursor: 'pointer',
                borderRadius: effects.radius.sm,
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = colors.text.primary}
              onMouseLeave={(e) => e.currentTarget.style.color = colors.text.tertiary}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          DISPLAY OPTIONS
         ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex',
        gap: spacing.sm,
        padding: `${spacing.sm}px 0`,
        borderTop: `1px solid ${colors.border.default}`,
        borderBottom: `1px solid ${colors.border.default}`,
      }}>
        <ToggleButton
          active={state.showLabels}
          onClick={toggleWaypointLabels}
          icon="🏷️"
          label="Labels"
          testId="balanced-toggle-labels"
        />
        <ToggleButton
          active={state.showDistances}
          onClick={toggleWaypointDistances}
          icon="↔️"
          label="Distances"
          testId="balanced-toggle-distances"
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          WAYPOINT LIST
         ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.xs,
        maxHeight: 180,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: `${spacing.xs}px`,
        margin: `-${spacing.xs}px`,
      }}>
        {activeWaypoints.length === 0 ? (
          <EmptyState />
        ) : (
          activeWaypoints.map((waypoint, index) => {
            const typeConfig = waypointTypes[waypoint.type as WaypointTypeKey] || waypointTypes.pin
            const isSelected = state.selectedWaypointId === waypoint.id

            return (
              <div
                key={waypoint.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: spacing.xs,
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  background: isSelected ? `${colors.accent.primary}10` : colors.bg.input,
                  border: `1px solid ${isSelected ? colors.border.active : 'transparent'}`,
                  borderRadius: effects.radius.md,
                  transition: effects.transition.fast,
                }}
              >
                {/* Select button (main area) */}
                <button
                  onClick={() => selectWaypoint(waypoint.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: spacing.sm,
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    padding: 0,
                    minWidth: 0,
                  }}
                >
                  {/* Icon */}
                  <span style={{
                    fontSize: 16,
                    color: typeConfig.color,
                    filter: isSelected ? 'none' : 'grayscale(20%)',
                  }}>
                    {typeConfig.icon}
                  </span>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: typography.size.base,
                      fontWeight: typography.weight.medium,
                      color: colors.text.primary,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontFamily: typography.fontFamily,
                    }}>
                      {waypoint.label || `${typeConfig.label} ${index + 1}`}
                    </div>
                    <div style={{
                      fontSize: typography.size.xs,
                      color: colors.text.tertiary,
                      fontFamily: typography.fontFamily,
                    }}>
                      {waypoint.lat.toFixed(4)}, {waypoint.lng.toFixed(4)}
                    </div>
                  </div>

                  {/* Index */}
                  <span style={{
                    fontSize: typography.size.xs,
                    fontWeight: typography.weight.semibold,
                    color: colors.text.secondary,
                    background: 'rgba(120, 120, 128, 0.2)',
                    padding: `2px ${spacing.sm}px`,
                    borderRadius: effects.radius.sm,
                    fontFamily: typography.fontFamily,
                  }}>
                    {index + 1}
                  </span>
                </button>

                {/* Delete */}
                {deleteWaypoint && (
                  <button
                    onClick={(e) => handleDelete(waypoint.id, e)}
                    title="Delete"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: spacing.touch.min - 4,
                      height: spacing.touch.min - 4,
                      background: 'transparent',
                      border: 'none',
                      borderRadius: effects.radius.sm,
                      cursor: 'pointer',
                      color: colors.text.tertiary,
                      fontSize: 14,
                      transition: effects.transition.fast,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 69, 58, 0.12)'
                      e.currentTarget.style.color = colors.accent.danger
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent'
                      e.currentTarget.style.color = colors.text.tertiary
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          FOOTER ACTIONS
         ═══════════════════════════════════════════════════════════════════════ */}
      {activeWaypoints.length > 0 && clearAllWaypoints && (
        <button
          onClick={handleClearAll}
          data-testid="clear-all"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
            padding: `${spacing.md}px ${spacing.lg}px`,
            marginTop: 'auto',
            background: 'transparent',
            border: `1px solid ${colors.border.danger}`,
            borderRadius: effects.radius.md,
            cursor: 'pointer',
            color: colors.accent.danger,
            fontSize: typography.size.sm,
            fontWeight: typography.weight.medium,
            fontFamily: typography.fontFamily,
            transition: effects.transition.fast,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(255, 69, 58, 0.1)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <span>Clear all {activeWaypoints.length} waypoints</span>
        </button>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUBCOMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function HeaderButton({ onClick, label, icon, testId }: { onClick: () => void; label: string; icon: string; testId?: string }) {
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

function ToggleButton({ active, onClick, icon, label, testId }: {
  active: boolean
  onClick: () => void
  icon: string
  label: string
  testId?: string
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        flex: 1,
        padding: `${spacing.sm}px ${spacing.md}px`,
        minHeight: spacing.touch.min - 4,
        background: active ? `${colors.accent.primary}15` : colors.bg.input,
        border: `1px solid ${active ? colors.border.active : 'transparent'}`,
        borderRadius: effects.radius.md,
        cursor: 'pointer',
        transition: effects.transition.fast,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = colors.bg.hover
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = colors.bg.input
      }}
    >
      <span style={{
        fontSize: 14,
        filter: active ? 'none' : 'grayscale(40%)',
      }}>
        {icon}
      </span>
      <span style={{
        fontSize: typography.size.sm,
        fontWeight: active ? typography.weight.medium : typography.weight.regular,
        color: active ? colors.text.primary : colors.text.secondary,
        fontFamily: typography.fontFamily,
      }}>
        {label}
      </span>
    </button>
  )
}

function EmptyState() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      padding: `${spacing.xxl}px ${spacing.lg}px`,
    }}>
      <span style={{ fontSize: 32, opacity: 0.4 }}>🗺️</span>
      <div style={{
        fontSize: typography.size.sm,
        color: colors.text.secondary,
        textAlign: 'center',
        fontFamily: typography.fontFamily,
        lineHeight: typography.lineHeight.relaxed,
      }}>
        No waypoints yet<br />
        <span style={{ color: colors.text.tertiary }}>
          Select a type above, then tap the map
        </span>
      </div>
    </div>
  )
}
