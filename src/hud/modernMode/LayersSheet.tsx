/**
 * Layers Sheet - Modern Mode
 *
 * Bottom sheet for environmental overlay controls.
 * Wired to OverlayContext for authoritative toggle state.
 */

import React, { useState, useCallback } from 'react'
import { useAppContext } from '../../context/AppContext'
import { useMapContext } from '../../context/MapContext'
import { useOverlayContext } from '../../context/OverlayContext'
import { useOperationalSession } from '../../context/OperationalSessionContext'
import { ENVIRONMENTAL_OVERLAY_CATALOG, overlayDef } from '../../lib/environmentalOverlays/catalog'
import { firmsMapKeyConfigured } from '../../lib/environmentalOverlays/sources'
import type { LayerType } from '../../types'
import type { EnvironmentalOverlayId } from '../../lib/environmentalOverlays/types'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { MODERN_SHEET, modernSheetEnterTransition } from './modernVisualTokens'
import { ModernSheetCloseButton, ModernSheetDragHandle } from './ModernSheetChrome'

interface LayersSheetProps {
  onClose: () => void
}

const OVERLAY_ICONS: Partial<Record<EnvironmentalOverlayId, string>> = {
  fire_firms: '🔥',
  relief_usgs: '🏔️',
  forest_usfs: '🌲',
  public_lands: '🏞️',
  bike_paths: '🚴',
  abandoned_rail: '🛤️',
  mines: '⛏️',
  hiking_trails: '🥾',
  camping: '⛺',
}

const BASEMAP_OPTIONS = [
  { id: 'streets', label: 'Streets', icon: '🛣️', description: 'Navigation focused' },
  { id: 'topo', label: 'Topo', icon: '⛰️', description: 'Elevation & terrain' },
  { id: 'outdoor', label: 'Outdoor', icon: '🌲', description: 'Trails & recreation' },
  { id: 'satellite', label: 'Satellite', icon: '🛰️', description: 'Aerial imagery' },
] as const

function overlayStatusLine(
  loading?: boolean,
  error?: string | null,
  fromCache?: boolean,
): string | null {
  if (error) return error
  if (loading) return 'Loading…'
  if (fromCache) return 'Cached data'
  return null
}

const IMMERSE_PRESETS: { id: string; label: string; description: string; overlays: EnvironmentalOverlayId[] }[] = [
  {
    id: 'terrain',
    label: 'Terrain depth',
    description: 'Shaded relief for field terrain read',
    overlays: ['relief_usgs'],
  },
  {
    id: 'land',
    label: 'Land context',
    description: 'Forest + public land boundaries',
    overlays: ['forest_usfs', 'public_lands'],
  },
]

export default function LayersSheet({ onClose }: LayersSheetProps) {
  const reducedMotion = useReducedMotion()
  const { state, setLayer } = useAppContext()
  const { map, status: mapStatus } = useMapContext()
  const { toggles, status, setEnabled, setEnabledBulk, online } = useOverlayContext()
  const { session, setShowLabels, setShowDistances, setModernPreferredBasemap } = useOperationalSession()
  const [activeTab, setActiveTab] = useState<'basemap' | 'overlays'>('overlays')
  const [toggleNote, setToggleNote] = useState<string | null>(null)
  const mapZoom = map ? Math.round(map.getZoom() * 10) / 10 : null

  const currentBasemap = state.activeLayer || 'outdoor'
  const mapBusy = mapStatus === 'initial'
  const firmsReady = firmsMapKeyConfigured()

  const handleBasemapChange = useCallback(
    (id: LayerType) => {
      setLayer(id)
      setModernPreferredBasemap(id)
    },
    [setLayer, setModernPreferredBasemap],
  )

  const toggleOverlay = useCallback(
    (overlayId: EnvironmentalOverlayId) => {
      const next = !toggles[overlayId]
      const result = setEnabled(overlayId, next)
      if (!result.applied && result.error) {
        setToggleNote(result.error)
        return
      }
      setToggleNote(next ? `${overlayDef(overlayId).label} enabled` : null)
    },
    [setEnabled, toggles],
  )

  const applyPreset = useCallback(
    (overlayIds: EnvironmentalOverlayId[]) => {
      const patch = Object.fromEntries(
        ENVIRONMENTAL_OVERLAY_CATALOG.map((d) => [d.id, overlayIds.includes(d.id)]),
      ) as Partial<Record<EnvironmentalOverlayId, boolean>>
      setEnabledBulk(patch)
      if (!state.activeLayer || state.activeLayer === 'streets') {
        setLayer('satellite')
        setModernPreferredBasemap('satellite')
      }
      setToggleNote('Immersive preset applied')
      setActiveTab('overlays')
    },
    [setEnabledBulk, setLayer, setModernPreferredBasemap, state.activeLayer],
  )

  const activeOverlayCount = ENVIRONMENTAL_OVERLAY_CATALOG.filter((d) => toggles[d.id]).length

  return (
    <div
      className="layers-sheet-container modern-spatial-sheet"
      data-sheet-layer="modern"
      data-testid="layers-sheet"
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
        padding: '0 16px calc(20px + env(safe-area-inset-bottom))',
      }}
    >
      <div
        className="layers-sheet"
        style={{
          width: '100%',
          maxWidth: 500,
          background: MODERN_SHEET.background,
          borderRadius: `${MODERN_SHEET.radiusTop}px ${MODERN_SHEET.radiusTop}px 24px 24px`,
          border: `1px solid ${MODERN_SHEET.border}`,
          backdropFilter: MODERN_SHEET.blur,
          WebkitBackdropFilter: MODERN_SHEET.blur,
          boxShadow: MODERN_SHEET.shadow,
          pointerEvents: 'auto',
          overflow: 'hidden',
          transition: modernSheetEnterTransition(reducedMotion),
          transform: 'translateY(0)',
          opacity: 1,
        }}
      >
        <ModernSheetDragHandle onDismiss={onClose} />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px 16px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            position: 'sticky',
            top: 0,
            zIndex: 3,
            background: MODERN_SHEET.background,
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                color: 'rgba(255, 255, 255, 0.95)',
                fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
              }}
            >
              Layers
            </h2>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 13,
                color: 'rgba(255, 255, 255, 0.5)',
                fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
              }}
            >
              {activeOverlayCount > 0
                ? `${activeOverlayCount} overlay${activeOverlayCount === 1 ? '' : 's'} active`
                : 'Map style and environmental overlays'}
              {!online ? ' · Offline' : ''}
            </p>
          </div>
          <ModernSheetCloseButton onClose={onClose} label="Close layers" />
        </div>

        <div style={{ display: 'flex', padding: '12px 20px', gap: 8 }}>
          {(['basemap', 'overlays'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '8px 16px',
                borderRadius: 10,
                border: 'none',
                background: activeTab === tab ? 'rgba(0, 122, 255, 0.9)' : 'rgba(255, 255, 255, 0.08)',
                color: activeTab === tab ? 'white' : 'rgba(255, 255, 255, 0.7)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <div style={{ padding: '0 20px 24px', maxHeight: '60vh', overflowY: 'auto' }}>
          {activeTab === 'basemap' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {BASEMAP_OPTIONS.map((basemap) => (
                <button
                  key={basemap.id}
                  disabled={mapBusy}
                  onClick={() => handleBasemapChange(basemap.id as LayerType)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '14px 16px',
                    borderRadius: 14,
                    border: `2px solid ${
                      currentBasemap === basemap.id
                        ? 'rgba(0, 122, 255, 0.5)'
                        : 'rgba(255, 255, 255, 0.08)'
                    }`,
                    background:
                      currentBasemap === basemap.id
                        ? 'rgba(0, 122, 255, 0.1)'
                        : 'rgba(255, 255, 255, 0.03)',
                    cursor: mapBusy ? 'wait' : 'pointer',
                    textAlign: 'left',
                    opacity: mapBusy ? 0.6 : 1,
                  }}
                >
                  <span style={{ fontSize: 28 }}>{basemap.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                      {basemap.label}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                      {basemap.description}
                    </div>
                  </div>
                  {currentBasemap === basemap.id ? (
                    <span style={{ color: '#007AFF', fontWeight: 700 }}>✓</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {toggleNote ? (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'rgba(0, 122, 255, 0.12)',
                    border: '1px solid rgba(0, 122, 255, 0.25)',
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.8)',
                  }}
                >
                  {toggleNote}
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {IMMERSE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.overlays)}
                    style={{
                      flex: '1 1 140px',
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid rgba(0, 255, 180, 0.25)',
                      background: 'rgba(0, 255, 180, 0.08)',
                      color: '#00ffb4',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{preset.label}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                      {preset.description}
                    </div>
                  </button>
                ))}
              </div>

              {mapZoom != null ? (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                  Map zoom {mapZoom} — detail layers need higher zoom to appear
                </div>
              ) : null}

              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.04)',
                }}
              >
                <label style={{ flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                  <input
                    type="checkbox"
                    checked={session.showLabels}
                    onChange={(e) => setShowLabels(e.target.checked)}
                    style={{ marginRight: 8 }}
                  />
                  Waypoint labels
                </label>
                <label style={{ flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                  <input
                    type="checkbox"
                    checked={session.showDistances}
                    onChange={(e) => setShowDistances(e.target.checked)}
                    style={{ marginRight: 8 }}
                  />
                  Segment distances
                </label>
              </div>

              {ENVIRONMENTAL_OVERLAY_CATALOG.map((overlay) => {
                const isEnabled = toggles[overlay.id]
                const st = status[overlay.id]
                const needsKey = overlay.id === 'fire_firms' && !firmsReady
                const statusLine = overlayStatusLine(st?.loading, st?.error, st?.fromCache)

                return (
                  <div
                    key={overlay.id}
                    style={{
                      padding: '14px 16px',
                      borderRadius: 14,
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: `1px solid ${
                        isEnabled ? 'rgba(0, 255, 180, 0.25)' : 'rgba(255, 255, 255, 0.06)'
                      }`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 24 }}>{OVERLAY_ICONS[overlay.id] ?? '🗺️'}</span>
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 600,
                            color: isEnabled ? '#00ffb4' : 'rgba(255,255,255,0.9)',
                          }}
                        >
                          {overlay.label}
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                          {overlay.hint}
                          {overlay.renderMode === 'detail' && overlay.minZoom
                            ? ` · zoom ${overlay.minZoom}+`
                            : ''}
                        </div>
                        {isEnabled &&
                        overlay.renderMode === 'detail' &&
                        overlay.minZoom &&
                        mapZoom != null &&
                        mapZoom < overlay.minZoom ? (
                          <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 4 }}>
                            Zoom in to {overlay.minZoom}+ to see on map
                          </div>
                        ) : null}
                        {statusLine ? (
                          <div style={{ fontSize: 11, color: st?.error ? '#fbbf24' : '#94a3b8', marginTop: 4 }}>
                            {statusLine}
                          </div>
                        ) : null}
                        {needsKey ? (
                          <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 4 }}>
                            FIRMS API key required
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={needsKey}
                        onClick={() => toggleOverlay(overlay.id)}
                        aria-pressed={isEnabled}
                        data-testid={`overlay-toggle-${overlay.id}`}
                        style={{
                          width: 52,
                          height: 32,
                          borderRadius: 16,
                          border: 'none',
                          background: isEnabled ? '#00ffb4' : 'rgba(255, 255, 255, 0.15)',
                          cursor: needsKey ? 'not-allowed' : 'pointer',
                          opacity: needsKey ? 0.5 : 1,
                          position: 'relative',
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            top: 4,
                            left: isEnabled ? 24 : 4,
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            background: 'white',
                            transition: 'left 200ms ease',
                          }}
                        />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes sheetEnter {
          from { opacity: 0; transform: translateY(100%); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
