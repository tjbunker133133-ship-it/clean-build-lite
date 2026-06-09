import React, { Suspense, lazy } from 'react'
import { publishPhase7Diagnostics } from './runtime/phase7Diagnostics'
import { publishProductionDiagnostics } from './runtime/productionDiagnostics'
import { AppProvider, useAppContext } from './context/AppContext'
import { OperationalSessionProvider } from './context/OperationalSessionContext'
import { CockpitProvider } from './context/CockpitContext'
import { MapProvider } from './context/MapContext'
import { OverlayProvider } from './context/OverlayContext'
import { PanelDataProvider } from './context/PanelDataContext'
import { TrailRouteProvider } from './context/TrailRouteContext'
import { MissionSyncProvider } from './context/MissionSyncContext'
// Phase 3C: Presentation mode system for safe UI migration
import { HudPresentationProvider, LayoutStyleSelector, useHudPresentation } from './context/HudPresentationContext'
import { activateUserCameraOverride } from './lib/cameraAuthority'
import { setBalancedActiveTool } from './lib/balancedToolBridge'
import { requestCameraIntent } from './lib/operationalPerception/perceptionEngine'
import type { CameraIntent } from './lib/operationalPerception/types'
import { pushForensicTrace } from './runtime/runtimeForensics'
import HudSystemHealthBridge from './runtime/HudSystemHealthBridge'
import { MissionControllerBridge } from './runtime/MissionControllerBridge'
import PanelAutoMinimize from './hud/PanelAutoMinimize'
import DockVisualSuppression from './hud/DockVisualSuppression'
import PresentationDebugOverlay from './hud/PresentationDebugOverlay'
// Phase 3: Final visual authority layer
import VisualOverrideLayer from './hud/VisualOverrideLayer'
// Phase 4: Map-First Architecture for Modern Mode
import MapFirstContainer from './hud/MapFirstContainer'
import TopBar from './hud/TopBar'
// Modern immersive runtime — isolated shell boundary
import { ModernShell } from './hud/modernMode/ModernShell'
import { useModernModeUI } from './hud/ModernModeOverlays'
// BALANCED LAYER: Production workspace environment (Phase 1-4)
import { BalancedModeContainer } from './hud/balancedMode'
import CockpitKeyboard from './hud/CockpitKeyboard'
import CockpitEdgeZones from './hud/CockpitEdgeZones'
import CockpitLayoutHotspot from './hud/CockpitLayoutHotspot'
import CockpitHudShell from './hud/CockpitHudShell'
import DisplayModeOverlay from './hud/DisplayModeOverlay'
import PermissionPromptOverlay from './hud/PermissionPromptOverlay'
import SwUpdateBanner from './hud/SwUpdateBanner'
import TacticalSetupBanner from './hud/TacticalSetupBanner'
import AlertWatchBootstrap from './hud/AlertWatchBootstrap'
import HudConfirmHost from './components/HudConfirmHost'
import {
  ClassicRoot,
  BalancedRoot,
  GlobalOverlayRoot,
  ModeRootIsolationGuard,
  publishIsolationApi,
  publishCompositionApi,
} from './lib/presentationIsolation'
import { publishMapInteractionRegistryApi } from './lib/mapInteractionRegistry'

const MapCanvas = lazy(() => import('./components/MapCanvas'))
const EnvironmentalOverlaysLayer = lazy(() => import('./layers/EnvironmentalOverlaysLayer'))
const ModernMapSubsystems = lazy(() => import('./layers/ModernMapSubsystems'))
const MapMeasureLayer = lazy(() => import('./layers/MapMeasureLayer'))
const WaypointLayer = lazy(() => import('./layers/WaypointLayer'))
const RouteLayer = lazy(() => import('./layers/RouteLayer'))
const TeamPresenceLayer = lazy(() => import('./layers/TeamPresenceLayer'))
const MonitorMapFollow = lazy(() => import('./layers/MonitorMapFollow'))
const LayerPanel = lazy(() => import('./hud/LayerPanel'))
const WaypointTypePanel = lazy(() => import('./hud/WaypointTypePanel'))
const DeadManPanel = lazy(() => import('./hud/DeadManPanel'))
const SituationPanel = lazy(() => import('./hud/SituationPanel'))
const VoicePanel = lazy(() => import('./hud/VoicePanel'))
const WeatherPanel = lazy(() => import('./hud/WeatherPanel'))
const CommandPalette = lazy(() => import('./hud/CommandPalette'))
const PresetPanel = lazy(() => import('./hud/PresetPanel'))
const CheckInPanel = lazy(() => import('./hud/CheckInPanel'))
const SOSPanel = lazy(() => import('./hud/SOSPanel'))
const PreflightPanel = lazy(() => import('./hud/PreflightPanel'))
const InstallHelperBanner = lazy(() => import('./hud/InstallHelperBanner'))
const NavigationHud = lazy(() => import('./hud/NavigationHud'))
const MissionLinkPanel = lazy(() => import('./hud/MissionLinkPanel'))
const WearablesPanel = lazy(() => import('./hud/WearablesPanel'))

// DEBUG: HUD Runtime verification logger
function ModeDebugLogger() {
  React.useEffect(() => {
    if (!import.meta.env.DEV) return
    if (typeof window === 'undefined') return

    // Runtime has already resolved mode at import time
    setTimeout(() => {
      const runtime = window.__HUD_RUNTIME__
      if (!runtime) {
        console.error('[MODE DEBUG] ERROR: HUD RUNTIME not found!')
        return
      }

      const modeName = runtime.mode === 'immersive' ? 'RECOMMENDED (immersive)' : runtime.mode.toUpperCase()
      
      console.log('[MODE DEBUG] ═══════════════════════════════════════')
      console.log(`[MODE DEBUG] MODE: ${modeName}`)
      console.log('[MODE DEBUG] HUD RUNTIME verified:', {
        mode: runtime.mode,
        userPreferredMode: runtime.userPreferredMode,
        autoModeEnabled: runtime.autoModeEnabled,
        runtimeContext: runtime.runtimeModeSource,
        resolvedFrom: runtime.resolvedFrom,
        isImmersive: runtime.isImmersive,
        isHybrid: runtime.isHybrid,
        isLegacy: runtime.isLegacy,
        layout: runtime.layout,
        domAttr: document.documentElement.getAttribute('data-hud-mode'),
      })
      console.log('[MODE DEBUG] ═══════════════════════════════════════')

      if (runtime.isImmersive) {
        console.log('%c[RECOMMENDED MODE] Map-First Safety OS — TRUE edge-to-edge, ZERO layout shift', 'color: #7dffa8; font-weight: bold')
        console.log('%c[RECOMMENDED MODE] Dock DISABLED, Panels TRANSIENT only, Radial PRIMARY', 'color: #7dffa8')
      } else if (runtime.isHybrid) {
        console.log('%c[HYBRID MODE] Balanced — collapsible panels, micro status', 'color: #ffd93d; font-weight: bold')
      }
    }, 100)
  }, [])
  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECOMMENDED MODE LAYOUT: Map-First Architecture
// Wraps children when in immersive/recommended mode for true edge-to-edge map
// ═══════════════════════════════════════════════════════════════════════════════
function MapFirstLayout({ children, onOpenOverlay }: { children: React.ReactNode; onOpenOverlay?: (id: string) => void }) {
  const { mode, layoutRules } = useHudPresentation()
  const isMapFullscreen = layoutRules?.mapFullscreen ?? false
  const isCockpitShellDisabled = layoutRules?.cockpitShellDisabled ?? false
  const isModernMode = mode === 'immersive'

  const sharedMapLayers = (
    <>
      <EnvironmentalOverlaysLayer />
      <WaypointLayer />
      <RouteLayer />
      <TeamPresenceLayer />
      <MonitorMapFollow />
    </>
  )

  const mapComponent = (
    <Suspense
      fallback={
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at 50% 45%, #0d1113, #060708)',
          }}
        />
      }
    >
      <MapCanvas onOpenOverlay={onOpenOverlay} />
      {isModernMode ? (
        <>
          {sharedMapLayers}
          <ModernMapSubsystems />
        </>
      ) : (
        <>
          {sharedMapLayers}
          <MapMeasureLayer />
        </>
      )}
    </Suspense>
  )

  // Immersive/Modern: single map via MapFirstContainer
  if (mode === 'immersive' && isMapFullscreen) {
    return (
      <MapFirstContainer mapComponent={mapComponent}>
        {children}
      </MapFirstContainer>
    )
  }

  // Balanced/Hybrid: BalancedModeContainer owns the sole map stack — no background duplicate
  if (isCockpitShellDisabled && mode === 'hybrid') {
    return <>{children}</>
  }

  // Legacy: MapFirstLayout provides the map; cockpit shell panels float above
  return (
    <>
      {/* ── Map Layer (z-index: 0) ── */}
      {mapComponent}
      {children}
    </>
  )
}

function AppContent() {
  const { mode, layoutRules } = useHudPresentation()
  const isCockpitShellDisabled = layoutRules?.cockpitShellDisabled ?? false
  const isDockDisabled = layoutRules?.dockDisabled ?? false
  const isModernMode = mode === 'immersive'
  
  // Modern Mode overlay system for radial menu sheets/cards
  const { 
    activeOverlay, 
    preflightOpen,
    openOverlay, 
    closeOverlay,
    openPreflight,
    closePreflight,
  } = useModernModeUI()

  React.useEffect(() => {
    publishPhase7Diagnostics()
    publishProductionDiagnostics()
    publishIsolationApi()
    publishCompositionApi()
    publishMapInteractionRegistryApi()
  }, [])

  // Playwright / automation: deterministic overlay open (radial long-press is flaky in headless)
  const { setLayer: setBasemapLayer } = useAppContext()
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const isAutomation =
      (navigator as Navigator & { webdriver?: boolean }).webdriver === true ||
      new URLSearchParams(window.location.search).has('e2e')
    if (!isAutomation) return
    const w = window as Window & {
      __gpsListeners?: Array<(fix: GeolocationPosition) => void>
      __e2eGpsDeliveryCount?: number
      __lastGps?: GeolocationPosition
    }
    w.__gpsListeners = w.__gpsListeners ?? []
    w.__e2eGpsDeliveryCount = w.__e2eGpsDeliveryCount ?? 0
    const onE2eGpsInject = (fix: GeolocationPosition) => {
      w.__lastGps = fix
      w.__e2eGpsDeliveryCount = (w.__e2eGpsDeliveryCount ?? 0) + 1
      pushForensicTrace('gps', 'e2e_inject', {
        lat: fix.coords.latitude,
        lng: fix.coords.longitude,
      })
    }
    w.__gpsListeners.push(onE2eGpsInject)
    const api = {
      openOverlay,
      closeOverlay,
      setLayer: setBasemapLayer,
      setBalancedTool: setBalancedActiveTool,
      activateUserCameraOverride,
      requestCameraIntent: (intent: CameraIntent) => requestCameraIntent(intent),
    }
    ;(window as unknown as { __hudE2E?: typeof api }).__hudE2E = api
    return () => {
      w.__gpsListeners = w.__gpsListeners?.filter((cb) => cb !== onE2eGpsInject)
      delete (window as unknown as { __hudE2E?: typeof api }).__hudE2E
    }
  }, [openOverlay, closeOverlay, setBasemapLayer])

  React.useEffect(() => {
    if (typeof window === 'undefined' || !isModernMode) return
    const onOpenPreflight = () => openPreflight()
    window.addEventListener('hud:open-preflight', onOpenPreflight)
    return () => window.removeEventListener('hud:open-preflight', onOpenPreflight)
  }, [isModernMode, openPreflight])
  
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: '#1a1a1a', // Modern mode background
      }}
    >
      <MapFirstLayout onOpenOverlay={openOverlay}>
        {/* ── Atmospheric overlays (z-index: 1-2) ── */}
        <PermissionPromptOverlay />
        <TacticalSetupBanner />
        <AlertWatchBootstrap />
        <SwUpdateBanner />
        <Suspense fallback={null}>
          <InstallHelperBanner />
        </Suspense>

        {isModernMode ? (
          <ModernShell
            activeOverlay={activeOverlay}
            onCloseOverlay={closeOverlay}
            onOpenOverlay={openOverlay}
            preflightOpen={preflightOpen}
            onClosePreflight={closePreflight}
          />
        ) : isCockpitShellDisabled ? (
          <BalancedRoot>
            <TopBar />
            <BalancedModeContainer />
            <Suspense fallback={null}>
              <CommandPalette />
            </Suspense>
          </BalancedRoot>
        ) : (
          <ClassicRoot>
            <CockpitProvider>
              <CockpitHudShell>
              {!isDockDisabled && <PanelAutoMinimize />}
              {!isDockDisabled && <DockVisualSuppression />}
              <PresentationDebugOverlay />
              <CockpitKeyboard />
              <CockpitEdgeZones />
              <CockpitLayoutHotspot />
              <TopBar />
              <Suspense fallback={null}>
                <SituationPanel />
                <CheckInPanel />
                <VoicePanel />
                <SOSPanel />
                <WeatherPanel />
                <PresetPanel />
                <PreflightPanel />
                <MissionLinkPanel />
                <WearablesPanel />
              </Suspense>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                }}
              >
                <Suspense fallback={null}>
                  <LayerPanel />
                  <WaypointTypePanel />
                  <DeadManPanel />
                </Suspense>
              </div>
              <Suspense fallback={null}>
                <CommandPalette />
              </Suspense>
            </CockpitHudShell>
            <DisplayModeOverlay />
            <Suspense fallback={null}>
              <div data-classic-navigation-hud>
                <NavigationHud />
              </div>
            </Suspense>
            </CockpitProvider>
          </ClassicRoot>
        )}
      </MapFirstLayout>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <HudPresentationProvider>
        <GlobalOverlayRoot />
        <ModeRootIsolationGuard />
        {/* Phase 3: Final visual authority layer — applies CSS overrides for presentation modes */}
        <VisualOverrideLayer />
        <ModeDebugLogger />
        <LayoutStyleSelector />
        <MissionSyncProvider>
            <PanelDataProvider>
              <MapProvider>
                <OverlayProvider>
                  <OperationalSessionProvider>
                    <TrailRouteProvider>
                      <HudSystemHealthBridge />
                      <MissionControllerBridge />
                      <HudConfirmHost />
                      <AppContent />
                    </TrailRouteProvider>
                  </OperationalSessionProvider>
                </OverlayProvider>
              </MapProvider>
            </PanelDataProvider>
        </MissionSyncProvider>
      </HudPresentationProvider>
    </AppProvider>
  )
}
