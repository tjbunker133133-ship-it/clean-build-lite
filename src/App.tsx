import React, { Suspense, lazy } from 'react'
import { AppProvider } from './context/AppContext'
import { CockpitProvider } from './context/CockpitContext'
import { MapProvider } from './context/MapContext'
import { PanelDataProvider } from './context/PanelDataContext'
import TopBar from './hud/TopBar'
import DeadManPanel from './hud/DeadManPanel'
import ScanlineOverlay from './hud/ScanlineOverlay'
import CockpitKeyboard from './hud/CockpitKeyboard'
import CockpitEdgeZones from './hud/CockpitEdgeZones'
import CockpitLayoutHotspot from './hud/CockpitLayoutHotspot'
import CockpitHudShell from './hud/CockpitHudShell'
import DisplayModeOverlay from './hud/DisplayModeOverlay'
import PermissionPromptOverlay from './hud/PermissionPromptOverlay'
import SwUpdateBanner from './hud/SwUpdateBanner'
import WaypointArrivalMonitor from './hud/WaypointArrivalMonitor'
import WaypointUndoStrip from './hud/WaypointUndoStrip'
import GpsPowerModeIndicator from './hud/GpsPowerModeIndicator'
import MovementIntelligenceBridge from './hud/MovementIntelligenceBridge'

const MapCanvas = lazy(() => import('./components/MapCanvas'))
const WaypointLayer = lazy(() => import('./layers/WaypointLayer'))
const BreadcrumbTrailLayer = lazy(() => import('./layers/BreadcrumbTrailLayer'))
const RouteLayer = lazy(() => import('./layers/RouteLayer'))
const ClockPanel = lazy(() => import('./hud/ClockPanel'))
const PositionalAwarenessPanel = lazy(() => import('./hud/PositionalAwarenessPanel'))
const VoicePanel = lazy(() => import('./hud/VoicePanel'))
const WeatherPanel = lazy(() => import('./hud/WeatherPanel'))
const CommandPalette = lazy(() => import('./hud/CommandPalette'))
const StatusRail = lazy(() => import('./hud/StatusRail'))
const PresetPanel = lazy(() => import('./hud/PresetPanel'))
const SOSPanel = lazy(() => import('./hud/SOSPanel'))
const CheckInPanel = lazy(() => import('./hud/CheckInPanel'))
const PreflightPanel = lazy(() => import('./hud/PreflightPanel'))
const InstallHelperBanner = lazy(() => import('./hud/InstallHelperBanner'))

export default function App() {
  return (
    <AppProvider>
      <CockpitProvider>
      <PanelDataProvider>
      <MapProvider>
        <MovementIntelligenceBridge />
        {/* Full-screen container */}
        <div
          style={{
            position: 'fixed',
            inset: 0,
            overflow: 'hidden',
            background: 'radial-gradient(circle at 50% 50%, #0a0a0f, #050508)',
          }}
        >
          {/* ── Map Layer (z-index: 0) ── */}
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
            <MapCanvas />
            {/* ── Map Feature Layers (render-only, no DOM) ── */}
            <WaypointLayer />
            <BreadcrumbTrailLayer />
            <RouteLayer />
          </Suspense>

          {/* ── Atmospheric overlays (z-index: 1-2) ── */}
          <ScanlineOverlay />
          <PermissionPromptOverlay />
          <SwUpdateBanner />
          <Suspense fallback={null}>
            <InstallHelperBanner />
          </Suspense>

          <CockpitHudShell>
            <CockpitKeyboard />
            <CockpitEdgeZones />
            <CockpitLayoutHotspot />
            <TopBar />
            <Suspense fallback={null}>
              <ClockPanel />
              <PositionalAwarenessPanel />
              <VoicePanel />
              <SOSPanel />
              <CheckInPanel />
              <WeatherPanel />
              <PresetPanel />
              <PreflightPanel />
            </Suspense>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
              }}
            >
              <DeadManPanel />
            </div>
            <Suspense fallback={null}>
              <StatusRail />
              <CommandPalette />
            </Suspense>
            <WaypointUndoStrip />
          </CockpitHudShell>
          <DisplayModeOverlay />
          <GpsPowerModeIndicator />
        </div>
      </MapProvider>
      </PanelDataProvider>
      </CockpitProvider>
    </AppProvider>
  )
}
