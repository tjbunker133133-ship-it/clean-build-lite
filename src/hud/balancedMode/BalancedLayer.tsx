/**
 * Balanced Layer - Polished Production Environment
 * =================================================
 *
 * The refined Balanced workspace layer.
 *
 * Design Principles:
 * - Map-first: panels float at edges, never obscure center
 * - Responsive: desktop = side panels, mobile = bottom sheets
 * - Calm: restrained glassmorphism, soft shadows
 * - Touch-friendly: 44px+ targets everywhere
 * - Immediate: no delayed interactions
 *
 * NO CockpitContext | NO dock logic | NO collision
 */

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useBalancedWorkspace, type ToolMode } from './hooks/useBalancedWorkspace'
import { useBalancedPanels } from './hooks/useBalancedPanels'
import { useAppContext } from '../../context/AppContext'
import type { WaypointType } from '../../types'
import {
  getMapInteractionSnapshot,
  subscribeMapInteraction,
} from '../../lib/mapInteractionController'
import { hudConfirm } from '../../lib/hudConfirm'
import { haversineDistance, formatDistance } from '../../lib/haversine'
import { useBalancedValidation } from './lib/balancedAssertions'
import { getDeviceProfile } from '../../runtime/deviceProfile'
import { zIndex, panelPosition, spacing } from './lib/balancedTokens'
import { useBalancedInteractionGuard } from './lib/balancedInteractionGuard'
import { armBalancedWaypointDrop } from '../../lib/balancedToolBridge'
import { BalancedInteractionHost } from '../../balanced/interaction/BalancedInteractionHost'

const MapCanvas = lazy(() => import('../../components/MapCanvas'))
const EnvironmentalOverlaysLayer = lazy(() => import('../../layers/EnvironmentalOverlaysLayer'))
const BalancedMapSubsystems = lazy(() => import('../../layers/BalancedMapSubsystems'))
const WaypointLayer = lazy(() => import('../../layers/WaypointLayer'))
const RouteLayer = lazy(() => import('../../layers/RouteLayer'))
const TeamPresenceLayer = lazy(() => import('../../layers/TeamPresenceLayer'))
const MonitorMapFollow = lazy(() => import('../../layers/MonitorMapFollow'))

// Lazy panels (keep bundle lean)
const BalancedRoutePanel = lazy(() => import('./BalancedRoutePanel'))
const BalancedWaypointPanel = lazy(() => import('./BalancedWaypointPanel'))
const BalancedOverlayTray = lazy(() => import('./BalancedOverlayTray'))
const BalancedMapTools = lazy(() => import('./BalancedMapTools'))
const BalancedQuickActions = lazy(() => import('./BalancedQuickActions'))
const WeatherSheet = lazy(() => import('../modernMode/WeatherSheet'))
const MissionSheet = lazy(() => import('../modernMode/MissionSheet'))

type BalancedSheetId = 'weather' | 'mission' | 'checkin'

// Simple loading state
const PanelLoading = () => (
  <div style={{
    width: 300,
    height: 60,
    background: 'rgba(28, 28, 30, 0.8)',
    borderRadius: 12,
    border: '1px solid rgba(120, 120, 128, 0.2)',
    backdropFilter: 'blur(12px)',
  }} />
)

interface BalancedLayerProps {
  onWaypointSelect?: (id: string) => void
  onToolChange?: (tool: ToolMode) => void
  onRouteAction?: (action: 'create' | 'edit' | 'clear', routeId?: string) => void
}

export default function BalancedLayer({
  onWaypointSelect,
  onToolChange,
  onRouteAction,
}: BalancedLayerProps) {
  // Dev mode validation
  useBalancedValidation({ enabled: import.meta.env.DEV, logOnly: true })
  useBalancedInteractionGuard({ enabled: import.meta.env.DEV })

  // Device profile for responsive layout
  const deviceProfile = useMemo(() => getDeviceProfile(), [])
  const isMobile = deviceProfile.width < 640 || deviceProfile.interactionMode === 'mobile'
  const isTablet = deviceProfile.width >= 640 && deviceProfile.width < 1024

  // Workspace state (single provider instance)
  const workspace = useBalancedWorkspace()
  const panels = useBalancedPanels(onWaypointSelect)
  const { setPendingType, setWaypoints, state: appState } = useAppContext()
  const measureSnapshot = useSyncExternalStore(
    subscribeMapInteraction,
    getMapInteractionSnapshot,
    getMapInteractionSnapshot,
  )
  const measurePoints = measureSnapshot.measurePoints
  const [activeSheet, setActiveSheet] = useState<BalancedSheetId | null>(null)

  const closeActiveSheet = useCallback(() => {
    setActiveSheet(null)
  }, [])

  const disarmWaypointDrop = useCallback(() => {
    setPendingType('default')
  }, [setPendingType])

  const armWaypointDrop = useCallback(
    (type: WaypointType = 'pin') => {
      armBalancedWaypointDrop(type)
    },
    [],
  )

  const clearMapTool = useCallback(() => {
    workspace.clearTool()
    disarmWaypointDrop()
  }, [workspace, disarmWaypointDrop])

  const openMissionSheet = useCallback(() => {
    setActiveSheet('mission')
  }, [])

  const handleOpenOverlay = useCallback(
    (id: string) => {
      switch (id) {
        case 'layers':
          workspace.openOverlaySection('base')
          break
        case 'weather':
          setActiveSheet('weather')
          break
        case 'mission':
          openMissionSheet()
          break
        case 'checkin':
          setActiveSheet('checkin')
          break
        case 'waypoints':
          workspace.openPanel('waypoints')
          armWaypointDrop('pin')
          break
        case 'route':
          workspace.openPanel('route')
          workspace.setTool('route')
          break
        default:
          break
      }
    },
    [workspace, armWaypointDrop, openMissionSheet],
  )

  const handleToolWorkflow = useCallback(
    (tool: ToolMode) => {
      if (tool === 'inspect') {
        workspace.clearTool()
        return
      }
      if (tool === 'waypoint') {
        armWaypointDrop('pin')
        workspace.openPanel('waypoints')
        return
      }
      if (tool === 'route') {
        workspace.setTool('route')
        workspace.openPanel('route')
        return
      }
      if (tool === 'measure') {
        workspace.setTool('measure')
        return
      }
      workspace.setTool(tool)
    },
    [workspace, armWaypointDrop],
  )

  const handlePanelWorkflow = useCallback(
    (panelId: string) => {
      if (panelId === 'overlays') {
        workspace.openOverlaySection('base')
        return
      }
      if (panelId === 'mission') {
        setActiveSheet((prev) => (prev === 'mission' || prev === 'checkin' ? null : 'mission'))
        return
      }
      if (panelId === 'waypoints') {
        const willOpen = !workspace.isPanelVisible('waypoints')
        workspace.togglePanel('waypoints')
        if (willOpen) {
          armWaypointDrop('pin')
        }
        return
      }
      workspace.togglePanel(panelId)
    },
    [workspace, armWaypointDrop, openMissionSheet],
  )

  const handleRouteAction = useCallback(
    (action: 'create' | 'edit' | 'clear', routeId?: string) => {
      if (action === 'clear') {
        void hudConfirm({
          title: 'Clear route?',
          message: `Remove all ${appState.waypoints.length} waypoints from this route?`,
          confirmLabel: 'Clear route',
          destructive: true,
        }).then((ok) => {
          if (ok) setWaypoints([])
        })
        return
      }
      if (action === 'create') {
        void hudConfirm({
          title: 'Start new route?',
          message: appState.waypoints.length > 0
            ? `Clear ${appState.waypoints.length} waypoints and begin a fresh route?`
            : 'Begin planning a new route.',
          confirmLabel: 'New route',
        }).then((ok) => {
          if (ok) {
            setWaypoints([])
            panels.setRouteName('Field route')
          }
        })
        return
      }
      onRouteAction?.(action, routeId)
    },
    [appState.waypoints.length, setWaypoints, onRouteAction, panels.setRouteName],
  )

  const mapComponent = (
    <Suspense fallback={null}>
      <MapCanvas onOpenOverlay={handleOpenOverlay} />
      <EnvironmentalOverlaysLayer />
      <BalancedMapSubsystems />
      <WaypointLayer />
      <RouteLayer />
      <TeamPresenceLayer />
      <MonitorMapFollow />
    </Suspense>
  )

  // Restore armed drop tool from persisted preference
  const armedToolSyncedRef = useRef(false)
  useEffect(() => {
    if (armedToolSyncedRef.current || !appState.keepWaypointToolArmed) return
    armedToolSyncedRef.current = true
    const pending = appState.pendingWaypointType
    armWaypointDrop(pending && pending !== 'default' ? pending : 'pin')
  }, [appState.keepWaypointToolArmed, appState.pendingWaypointType, armWaypointDrop])

  // Notify external systems of tool changes
  React.useEffect(() => {
    onToolChange?.(workspace.activeTool)
  }, [workspace.activeTool, onToolChange])

  // Panel visibility
  const showRoute = workspace.isPanelVisible('route')
  const showWaypoints = workspace.isPanelVisible('waypoints')
  const showOverlays = workspace.isPanelVisible('overlays')
  const missionSheetOpen = activeSheet === 'mission' || activeSheet === 'checkin'

  // Responsive positioning
  const leftPanelStyle = useMemo(() => ({
    position: 'absolute' as const,
    ...(isMobile
      ? { left: 8, right: 8, bottom: 88, maxHeight: 260, zIndex: zIndex.panels }
      : { left: panelPosition.desktop.left.left, top: panelPosition.desktop.left.top, bottom: panelPosition.desktop.left.bottom, zIndex: zIndex.panels }
    ),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    pointerEvents: 'none' as const,
  }), [isMobile])

  const rightPanelStyle = useMemo(() => ({
    position: 'absolute' as const,
    ...(isMobile
      ? { left: 8, right: 8, bottom: 88, maxHeight: 260, zIndex: zIndex.panels }
      : { right: panelPosition.desktop.right.right, top: panelPosition.desktop.right.top, bottom: panelPosition.desktop.right.bottom, zIndex: zIndex.panels }
    ),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    pointerEvents: 'none' as const,
  }), [isMobile])

  const quickActionsStyle = useMemo(() => ({
    position: 'absolute' as const,
    top: isMobile ? 52 : 48,
    left: 16,
    right: 16,
    zIndex: zIndex.quickActions,
    pointerEvents: 'none' as const,
  }), [isMobile])

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: 'transparent',
        isolation: 'isolate',
        contain: 'layout paint',
        pointerEvents: 'auto',
      }}
      data-balanced-layer
      data-balanced-active="true"
      data-balanced-tool={workspace.activeTool}
      data-device-class={isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop'}
    >
      {/* ═════════════════════════════════════════════════════════════════════════
          MAP (the star of the show)
         ═════════════════════════════════════════════════════════════════════════ */}
      <div style={{ position: 'absolute', inset: 0, zIndex: zIndex.map }}>
        {mapComponent}
      </div>

      {/* ═════════════════════════════════════════════════════════════════════════
          QUICK ACTIONS BAR (top, centered)
         ═════════════════════════════════════════════════════════════════════════ */}
      <div style={quickActionsStyle}>
        <Suspense fallback={null}>
            <BalancedQuickActions
              activeTool={workspace.activeTool}
              keepWaypointToolArmed={appState.keepWaypointToolArmed}
              measureSummary={
                measurePoints.length === 2
                  ? formatDistance(
                      haversineDistance(
                        measurePoints[0].lat,
                        measurePoints[0].lng,
                        measurePoints[1].lat,
                        measurePoints[1].lng,
                      ).miles,
                    )
                  : measurePoints.length === 1
                    ? 'Tap second point'
                    : null
              }
              panelsVisible={{
                route: showRoute,
                waypoints: showWaypoints,
                overlays: showOverlays,
                mission: missionSheetOpen,
              }}
              onToolSelect={handleToolWorkflow}
              onTogglePanel={handlePanelWorkflow}
              onClearTool={clearMapTool}
            />
        </Suspense>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════════
          LEFT PANELS (route + waypoints)
          - Desktop: left side
          - Mobile: bottom sheet
         ═════════════════════════════════════════════════════════════════════════ */}
      <div style={leftPanelStyle}>
        {showRoute && (
          <Suspense fallback={<PanelLoading />}>
            <div style={{ pointerEvents: 'auto' }}>
              <BalancedRoutePanel
                state={panels.state.route}
                setRouteName={panels.setRouteName}
                setCorridorEnabled={panels.setCorridorEnabled}
                setCorridorWidth={panels.setCorridorWidth}
                onAction={handleRouteAction}
                isCollapsed={workspace.isPanelCollapsed('route')}
                onCollapse={() => workspace.collapsePanel('route')}
                onExpand={() => workspace.expandPanel('route')}
                onClose={() => workspace.togglePanel('route')}
              />
            </div>
          </Suspense>
        )}

        {showWaypoints && (
          <Suspense fallback={<PanelLoading />}>
            <div style={{ pointerEvents: 'auto' }}>
              <BalancedWaypointPanel
                state={panels.state.waypoints}
                selectWaypoint={panels.selectWaypoint}
                setPendingWaypointType={panels.setPendingWaypointType}
                toggleWaypointLabels={panels.toggleWaypointLabels}
                toggleWaypointDistances={panels.toggleWaypointDistances}
                deleteWaypoint={panels.deleteWaypoint}
                clearAllWaypoints={panels.clearAllWaypoints}
                activeTool={workspace.activeTool}
                isCollapsed={workspace.isPanelCollapsed('waypoints')}
                onCollapse={() => workspace.collapsePanel('waypoints')}
                onExpand={() => workspace.expandPanel('waypoints')}
                onClose={() => workspace.togglePanel('waypoints')}
              />
            </div>
          </Suspense>
        )}
      </div>

      {/* ═════════════════════════════════════════════════════════════════════════
          RIGHT PANELS (overlays/layers)
          - Desktop: right side
          - Mobile: bottom sheet (if no left panels)
         ═════════════════════════════════════════════════════════════════════════ */}
      <div style={rightPanelStyle}>
        {showOverlays && (
          <Suspense fallback={<PanelLoading />}>
            <div style={{ pointerEvents: 'auto' }}>
              <BalancedOverlayTray
                state={panels.state.overlays}
                setBaseLayer={panels.setBaseLayer}
                toggleTerrainOverlay={panels.toggleTerrainOverlay}
                toggleWeatherOverlay={panels.toggleWeatherOverlay}
                setOverlayOpacity={panels.setOverlayOpacity}
                highlightSection={workspace.overlaySection}
                onClose={() => workspace.togglePanel('overlays')}
              />
            </div>
          </Suspense>
        )}
      </div>

      {/* ═════════════════════════════════════════════════════════════════════════
          CONTEXTUAL SHEETS (weather, mission connect)
         ═════════════════════════════════════════════════════════════════════════ */}
      {activeSheet != null && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: zIndex.modals,
            pointerEvents: 'auto',
          }}
          data-balanced-sheet={activeSheet}
        >
          <Suspense fallback={null}>
            {activeSheet === 'weather' && (
              <WeatherSheet onClose={closeActiveSheet} variant="balanced" />
            )}
            {(activeSheet === 'mission' || activeSheet === 'checkin') && (
              <MissionSheet onClose={closeActiveSheet} variant="balanced" />
            )}
          </Suspense>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════════
          FLOATING MAP TOOLS (context-aware)
          - Only when tool is active
          - Centered below quick actions
         ═════════════════════════════════════════════════════════════════════════ */}
      {workspace.mapToolActive && (
        <div style={{
          position: 'absolute',
          top: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: zIndex.floatingTools,
          pointerEvents: 'none',
        }}>
          <Suspense fallback={null}>
            <div style={{ pointerEvents: 'auto' }}>
              <BalancedMapTools
                activeTool={workspace.activeTool}
                onClearTool={clearMapTool}
                pendingWaypointType={panels.state.waypoints.pendingWaypointType}
                onSetWaypointType={panels.setPendingWaypointType}
                measureSummary={
                  measurePoints.length === 2
                    ? formatDistance(
                        haversineDistance(
                          measurePoints[0].lat,
                          measurePoints[0].lng,
                          measurePoints[1].lat,
                          measurePoints[1].lng,
                        ).miles,
                      )
                    : measurePoints.length === 1
                      ? 'Tap second point on map'
                      : 'Tap first point on map'
                }
              />
            </div>
          </Suspense>
        </div>
      )}

      <BalancedInteractionHost onOpenOverlay={handleOpenOverlay} />
    </div>
  )
}

export type { ToolMode }
