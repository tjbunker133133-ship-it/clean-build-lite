/**
 * Balanced Quick Actions (Polished)
 * ==================================
 *
 * Clean tool selection and panel access.
 *
 * UX Principles:
 * - Immediate tool activation (no double-taps)
 * - Clear active state
 * - Minimal, calm presentation
 * - Map remains primary focus
 *
 * NO CockpitContext | NO dock logic | NO panel management
 */

import React, { useCallback, useState } from 'react'
import type { ToolMode } from './hooks/useBalancedWorkspace'
import { colors, spacing, typography, effects, zIndex } from './lib/balancedTokens'
import { getDeviceProfile } from '../../runtime/deviceProfile'

interface BalancedQuickActionsProps {
  activeTool: ToolMode
  keepWaypointToolArmed?: boolean
  measureSummary?: string | null
  panelsVisible: {
    route: boolean
    waypoints: boolean
    overlays: boolean
    mission: boolean
  }
  onToolSelect: (tool: ToolMode) => void
  onTogglePanel: (panelId: string) => void
  onClearTool: () => void
}

// Tool definitions
const TOOLS: Array<{
  id: ToolMode
  icon: string
  label: string
  description: string
}> = [
  { id: 'inspect', icon: '🔍', label: 'Inspect', description: 'Tap map to inspect — no drops' },
  { id: 'waypoint', icon: '⭐', label: 'Drop', description: 'Tap map to place waypoints' },
  { id: 'route', icon: '📍', label: 'Route', description: 'Plan route — opens route panel' },
  { id: 'measure', icon: '📏', label: 'Measure', description: 'Tap two points to measure distance' },
]

// Panel toggles
const PANELS: Array<{
  id: string
  icon: string
  label: string
  panelKey: keyof BalancedQuickActionsProps['panelsVisible']
}> = [
  { id: 'overlays', icon: '🗺️', label: 'Layers', panelKey: 'overlays' },
  { id: 'mission', icon: '🎯', label: 'Mission', panelKey: 'mission' },
]

export default function BalancedQuickActions({
  activeTool,
  keepWaypointToolArmed = false,
  measureSummary,
  panelsVisible,
  onToolSelect,
  onTogglePanel,
  onClearTool,
}: BalancedQuickActionsProps) {
  const [hoveredTool, setHoveredTool] = useState<ToolMode | null>(null)
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const isCompact = isMobile || (typeof window !== 'undefined' && window.innerWidth < 480)

  // Tool click handler - immediate activation
  const handleToolClick = useCallback((tool: ToolMode) => {
    if (activeTool === tool) {
      if (tool === 'waypoint' && keepWaypointToolArmed) return
      if (tool !== 'inspect') onClearTool()
      return
    }
    onToolSelect(tool)
  }, [activeTool, keepWaypointToolArmed, onToolSelect, onClearTool])

  // Panel toggle handler
  const handlePanelToggle = useCallback((panelId: string) => {
    onTogglePanel(panelId)
  }, [onTogglePanel])

  // Active tool info for display
  const activeToolInfo = TOOLS.find(t => t.id === activeTool) || TOOLS[0]
  const statusText =
    activeTool === 'measure' && measureSummary
      ? `Measure: ${measureSummary}`
      : activeToolInfo.description

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: spacing.xs,
        width: '100%',
        maxWidth: 720,
        margin: '0 auto',
        zIndex: zIndex.quickActions,
        pointerEvents: 'none',
      }}
      data-balanced-workspace-bar
    >
      <div
        style={{
          fontSize: typography.size.xs,
          fontWeight: typography.weight.semibold,
          letterSpacing: '0.14em',
          color: colors.accent.primary,
          paddingLeft: spacing.sm,
          opacity: 0.85,
        }}
      >
        WORKSPACE
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: isCompact ? 'flex-start' : 'space-between',
          gap: isCompact ? spacing.sm : spacing.lg,
          padding: `${spacing.sm}px ${spacing.md}px`,
          width: '100%',
          overflowX: isCompact ? 'auto' : 'visible',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          background: colors.bg.panel,
          backdropFilter: effects.blur.md,
          borderRadius: effects.radius.lg,
          border: `1px solid ${colors.border.active}`,
          boxShadow: effects.shadow.md,
          pointerEvents: 'auto',
        }}
        data-balanced-quick-actions
      >
      {/* ═══════════════════════════════════════════════════════════════════════
          LEFT: Tools
         ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing.xs,
      }}>
        {TOOLS.map((tool) => {
          const isActive = activeTool === tool.id
          const isHovered = hoveredTool === tool.id

          return (
            <button
              key={tool.id}
              onClick={() => handleToolClick(tool.id)}
              onMouseEnter={() => setHoveredTool(tool.id)}
              onMouseLeave={() => setHoveredTool(null)}
              title={`${tool.label} — ${tool.description}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                padding: `${spacing.xs}px ${spacing.sm}px`,
                minWidth: spacing.touch.min,
                minHeight: spacing.touch.min,
                background: isActive
                  ? `${colors.accent.primary}15`
                  : isHovered
                    ? colors.bg.hover
                    : 'transparent',
                border: `2px solid ${isActive ? colors.border.active : 'transparent'}`,
                borderRadius: effects.radius.md,
                cursor: 'pointer',
                transition: effects.transition.fast,
              }}
            >
              <span style={{
                fontSize: 18,
                filter: isActive ? 'none' : 'grayscale(25%)',
                transition: effects.transition.fast,
              }}>
                {tool.icon}
              </span>
              <span style={{
                fontSize: typography.size.xs,
                fontWeight: isActive ? typography.weight.medium : typography.weight.regular,
                color: isActive ? colors.accent.primary : colors.text.secondary,
                fontFamily: typography.fontFamily,
                transition: effects.transition.fast,
                display: isCompact ? 'none' : 'inline',
              }}>
                {tool.label}
              </span>
            </button>
          )
        })}
      </div>

      {!isCompact && (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing.sm,
        padding: `${spacing.xs}px ${spacing.md}px`,
        background: colors.bg.card,
        borderRadius: effects.radius.md,
        border: `1px solid ${colors.border.default}`,
        flexShrink: 1,
        minWidth: 0,
      }}>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: activeTool === 'inspect'
            ? colors.accent.success
            : activeTool === 'waypoint'
              ? colors.accent.warning
              : activeTool === 'route'
                ? colors.accent.primary
                : colors.accent.purple,
          animation: activeTool !== 'inspect' ? 'pulse 2s ease-in-out infinite' : 'none',
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: typography.size.sm,
          color: colors.text.secondary,
          fontFamily: typography.fontFamily,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {statusText}
        </span>
      </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          RIGHT: Panel toggles
         ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing.xs,
        flexShrink: 0,
        marginLeft: isCompact ? 'auto' : undefined,
      }}>
        {PANELS.map((panel) => {
          const isVisible = panelsVisible[panel.panelKey]

          return (
            <button
              key={panel.id}
              onClick={() => handlePanelToggle(panel.id)}
              title={panel.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.xs,
                padding: `${spacing.xs}px ${spacing.md}px`,
                minHeight: spacing.touch.min - 4,
                background: isVisible ? `${colors.accent.primary}12` : 'transparent',
                border: `1.5px solid ${isVisible ? colors.border.active : 'transparent'}`,
                borderRadius: effects.radius.md,
                cursor: 'pointer',
                transition: effects.transition.fast,
              }}
              onMouseEnter={(e) => {
                if (!isVisible) e.currentTarget.style.background = colors.bg.hover
              }}
              onMouseLeave={(e) => {
                if (!isVisible) e.currentTarget.style.background = 'transparent'
              }}
            >
              <span style={{
                fontSize: 16,
                filter: isVisible ? 'none' : 'grayscale(30%)',
              }}>
                {panel.icon}
              </span>
              <span style={{
                fontSize: typography.size.sm,
                fontWeight: isVisible ? typography.weight.medium : typography.weight.regular,
                color: isVisible ? colors.text.primary : colors.text.secondary,
                fontFamily: typography.fontFamily,
                display: isCompact ? 'none' : 'inline',
              }}>
                {panel.label}
              </span>
            </button>
          )
        })}
      </div>
      </div>
    </div>
  )
}
