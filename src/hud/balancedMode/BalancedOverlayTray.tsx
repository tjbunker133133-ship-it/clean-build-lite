/**
 * Balanced Overlay Tray
 * =====================
 *
 * Overlay and layer management for the Balanced Layer.
 *
 * NO CockpitContext dependency
 * NO HudPanel inheritance
 * NO dock logic
 *
 * RESPONSIBILITIES:
 * - Base layer selection (streets, topo, satellite, etc.)
 * - Overlay toggles (terrain, weather, heatmap)
 * - Opacity control
 * - Quick layer comparison
 */

import React, { useCallback } from 'react'
import type { OverlayPanelState } from './hooks/useBalancedPanels'

interface BalancedOverlayTrayProps {
  state: OverlayPanelState
  setBaseLayer: (layer: string) => void
  toggleTerrainOverlay: () => void
  toggleWeatherOverlay: () => void
  setOverlayOpacity: (opacity: number) => void
  highlightSection?: 'base' | 'weather' | null
  onClose: () => void
}

type LayerOption = {
  id: string
  label: string
  icon: string
  description: string
}

const BASE_LAYERS: LayerOption[] = [
  { id: 'streets', label: 'Streets', icon: '🛣️', description: 'Default navigation view' },
  { id: 'topo', label: 'Topo', icon: '⛰️', description: 'Topographic terrain' },
  { id: 'outdoor', label: 'Outdoor', icon: '🥾', description: 'Outdoor recreation' },
  { id: 'satellite', label: 'Satellite', icon: '🛰️', description: 'Aerial imagery' },
]

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

export default function BalancedOverlayTray({
  state,
  setBaseLayer,
  toggleTerrainOverlay,
  toggleWeatherOverlay,
  setOverlayOpacity,
  highlightSection,
  onClose,
}: BalancedOverlayTrayProps) {
  const handleLayerClick = useCallback((layerId: string) => {
    setBaseLayer(layerId)
  }, [setBaseLayer])

  return (
    <div
      style={{
        background: BALANCED_TOKENS.bg,
        backdropFilter: BALANCED_TOKENS.blur,
        borderRadius: BALANCED_TOKENS.radius,
        border: `1px solid ${BALANCED_TOKENS.border}`,
        padding: 16,
        width: 280,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        pointerEvents: 'auto',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      }}
      data-balanced-panel="overlays"
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🗺️</span>
          <span style={{
            fontSize: 16,
            fontWeight: 600,
            color: BALANCED_TOKENS.text.primary,
            fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
          }}>
            Layers
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: BALANCED_TOKENS.text.tertiary,
            cursor: 'pointer',
            padding: '4px 8px',
            fontSize: 12,
            borderRadius: 4,
          }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Base Layer Selection */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        outline: highlightSection === 'base' ? '2px solid rgba(10,132,255,0.5)' : 'none',
        borderRadius: 10,
        padding: highlightSection === 'base' ? 4 : 0,
      }}>
        <span style={{
          fontSize: 12,
          fontWeight: 500,
          color: BALANCED_TOKENS.text.secondary,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
        }}>
          Base Layer
        </span>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 8,
        }}>
          {BASE_LAYERS.map((layer) => {
            const isActive = state.activeBaseLayer === layer.id
            return (
              <button
                key={layer.id}
                onClick={() => handleLayerClick(layer.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 4,
                  padding: '10px 12px',
                  background: isActive ? `${BALANCED_TOKENS.accent.primary}20` : 'rgba(0, 0, 0, 0.2)',
                  border: `2px solid ${isActive ? BALANCED_TOKENS.accent.primary : 'transparent'}`,
                  borderRadius: 10,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 150ms ease',
                }}
                title={layer.description}
              >
                <span style={{ fontSize: 18 }}>{layer.icon}</span>
                <span style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: isActive ? BALANCED_TOKENS.text.primary : BALANCED_TOKENS.text.secondary,
                  fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
                }}>
                  {layer.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Overlay Toggles */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        outline: highlightSection === 'weather' ? '2px solid rgba(255,159,10,0.5)' : 'none',
        borderRadius: 10,
        padding: highlightSection === 'weather' ? 4 : 0,
      }}>
        <span style={{
          fontSize: 12,
          fontWeight: 500,
          color: BALANCED_TOKENS.text.secondary,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
        }}>
          Overlays
        </span>

        {/* Terrain Toggle */}
        <button
          onClick={toggleTerrainOverlay}
          data-testid="balanced-toggle-terrain"
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            background: state.terrainOverlay ? `${BALANCED_TOKENS.accent.success}20` : 'rgba(0, 0, 0, 0.2)',
            border: `1px solid ${state.terrainOverlay ? BALANCED_TOKENS.accent.success : 'transparent'}`,
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>⛰️</span>
            <span style={{
              fontSize: 14,
              color: BALANCED_TOKENS.text.primary,
              fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
            }}>
              Terrain
            </span>
          </div>
          <div style={{
            width: 36,
            height: 20,
            borderRadius: 10,
            background: state.terrainOverlay ? BALANCED_TOKENS.accent.success : 'rgba(120, 120, 128, 0.4)',
            position: 'relative',
            transition: 'background 150ms ease',
          }}>
            <div style={{
              position: 'absolute',
              top: 2,
              left: state.terrainOverlay ? 18 : 2,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: 'white',
              transition: 'left 150ms ease',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </div>
        </button>

        {/* Weather Toggle */}
        <button
          onClick={toggleWeatherOverlay}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            background: state.weatherOverlay ? `${BALANCED_TOKENS.accent.warning}20` : 'rgba(0, 0, 0, 0.2)',
            border: `1px solid ${state.weatherOverlay ? BALANCED_TOKENS.accent.warning : 'transparent'}`,
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>🌦️</span>
            <span style={{
              fontSize: 14,
              color: BALANCED_TOKENS.text.primary,
              fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
            }}>
              Weather
            </span>
          </div>
          <div style={{
            width: 36,
            height: 20,
            borderRadius: 10,
            background: state.weatherOverlay ? BALANCED_TOKENS.accent.warning : 'rgba(120, 120, 128, 0.4)',
            position: 'relative',
            transition: 'background 150ms ease',
          }}>
            <div style={{
              position: 'absolute',
              top: 2,
              left: state.weatherOverlay ? 18 : 2,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: 'white',
              transition: 'left 150ms ease',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </div>
        </button>
      </div>

      {/* Opacity Control */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          fontSize: 12,
          color: BALANCED_TOKENS.text.secondary,
          fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
        }}>
          <span>Overlay Opacity</span>
          <span>{Math.round(state.overlayOpacity * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={state.overlayOpacity}
          onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
          style={{
            width: '100%',
            accentColor: BALANCED_TOKENS.accent.primary,
          }}
        />
      </div>
    </div>
  )
}
