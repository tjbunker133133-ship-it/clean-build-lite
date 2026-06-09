/**
 * Balanced Map Tools
 * ==================
 *
 * Floating map tool indicators for the Balanced Layer.
 *
 * NO CockpitContext dependency
 * NO HudPanel inheritance
 *
 * RESPONSIBILITIES:
 * - Active tool mode indicator
 * - Tool-specific action hints
 * - Tool cancellation
 * - Context-aware tool options
 */

import React from 'react'
import type { ToolMode } from './hooks/useBalancedWorkspace'

interface BalancedMapToolsProps {
  activeTool: ToolMode
  onClearTool: () => void
  onClearMeasure?: () => void
  pendingWaypointType: string | null
  onSetWaypointType: (type: string | null) => void
  measureSummary?: string | null
  measurePointCount?: number
}

const BALANCED_TOKENS = {
  bg: 'rgba(28, 28, 30, 0.9)',
  border: 'rgba(120, 120, 128, 0.3)',
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

const WAYPOINT_TYPE_ICONS: Record<string, string> = {
  start: '🚩',
  water: '💧',
  camp: '⛺',
  rest: '☕',
  poi: '🔍',
  pin: '📍',
  finish: '🏁',
}

const WAYPOINT_TYPE_LABELS: Record<string, string> = {
  start: 'Start Point',
  water: 'Water Source',
  camp: 'Campsite',
  rest: 'Rest Stop',
  poi: 'Point of Interest',
  pin: 'Pin',
  finish: 'Finish',
}

export default function BalancedMapTools({
  activeTool,
  onClearTool,
  onClearMeasure,
  pendingWaypointType,
  onSetWaypointType,
  measureSummary,
  measurePointCount = 0,
}: BalancedMapToolsProps) {
  // Don't show if no tool active
  if (activeTool === 'inspect' || activeTool === 'none') {
    return null
  }

  // Tool-specific UI
  const renderToolUI = () => {
    switch (activeTool) {
      case 'route':
        return (
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: `${BALANCED_TOKENS.accent.primary}30`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}>
              📍
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{
                fontSize: 14,
                fontWeight: 600,
                color: BALANCED_TOKENS.text.primary,
                fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
              }}>
                Route Planning Mode
              </span>
              <span style={{
                fontSize: 12,
                color: BALANCED_TOKENS.text.secondary,
                fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
              }}>
                Tap map to add waypoints
              </span>
            </div>
          </div>
        )

      case 'waypoint':
        return (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: `${BALANCED_TOKENS.accent.warning}30`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
              }}>
                {pendingWaypointType ? WAYPOINT_TYPE_ICONS[pendingWaypointType] || '📍' : '📍'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: BALANCED_TOKENS.text.primary,
                  fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
                }}>
                  {pendingWaypointType
                    ? `Drop ${WAYPOINT_TYPE_LABELS[pendingWaypointType] || 'Waypoint'}`
                    : 'Waypoint Mode'}
                </span>
                <span style={{
                  fontSize: 12,
                  color: BALANCED_TOKENS.text.secondary,
                  fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
                }}>
                  {pendingWaypointType
                    ? 'Tap on the map to place'
                    : 'Select a waypoint type first'}
                </span>
              </div>
            </div>

            {/* Quick type selector when no type selected */}
            {!pendingWaypointType && (
              <div style={{
                display: 'flex',
                flexDirection: 'row',
                gap: 6,
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}>
                {Object.entries(WAYPOINT_TYPE_ICONS).map(([type, icon]) => (
                  <button
                    key={type}
                    onClick={() => onSetWaypointType(type)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 2,
                      padding: '8px 10px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid transparent',
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{icon}</span>
                    <span style={{
                      fontSize: 10,
                      color: BALANCED_TOKENS.text.secondary,
                      fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
                    }}>
                      {type}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )

      case 'measure':
        return (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: `${BALANCED_TOKENS.accent.success}30`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
              }}>
                📏
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: BALANCED_TOKENS.text.primary,
                  fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
                }}>
                  Measure Mode
                </span>
                <span style={{
                  fontSize: 12,
                  color: BALANCED_TOKENS.text.secondary,
                  fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
                }}>
                  {measureSummary ?? 'Tap first point on map'}
                  {measurePointCount > 0 ? ' · drag points to adjust' : ''}
                </span>
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div
      style={{
        background: BALANCED_TOKENS.bg,
        backdropFilter: BALANCED_TOKENS.blur,
        borderRadius: BALANCED_TOKENS.radius,
        border: `1px solid ${BALANCED_TOKENS.border}`,
        padding: '12px 16px',
        minWidth: 240,
        maxWidth: 320,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        pointerEvents: 'auto',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      }}
      data-balanced-map-tools
      data-tool={activeTool}
    >
      {/* Active Tool UI */}
      {renderToolUI()}

      {/* Cancel / Clear Button */}
      <button
        onClick={activeTool === 'measure' && measurePointCount > 0 && onClearMeasure ? onClearMeasure : onClearTool}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '8px 12px',
          background: 'rgba(255, 69, 58, 0.15)',
          border: `1px solid ${BALANCED_TOKENS.accent.danger}40`,
          borderRadius: 8,
          cursor: 'pointer',
          marginTop: 4,
        }}
        data-testid={activeTool === 'measure' ? 'balanced-measure-clear-tool' : undefined}
      >
        <span style={{ fontSize: 12, color: BALANCED_TOKENS.accent.danger }}>✕</span>
        <span style={{
          fontSize: 13,
          fontWeight: 500,
          color: BALANCED_TOKENS.accent.danger,
          fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
        }}>
          {activeTool === 'measure' && measurePointCount > 0 ? 'Clear measurement' : 'Cancel Tool'}
        </span>
      </button>
    </div>
  )
}
