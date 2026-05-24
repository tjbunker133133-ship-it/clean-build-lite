import React, { Suspense, lazy } from 'react'
import { AppProvider } from './context/AppContext'
import { CockpitProvider } from './context/CockpitContext'
import { MapProvider } from './context/MapContext'
import { PanelDataProvider } from './context/PanelDataContext'
import TopBar from './hud/TopBar'
import ScanlineOverlay from './hud/ScanlineOverlay'
import CockpitKeyboard from './hud/CockpitKeyboard'
import CockpitEdgeZones from './hud/CockpitEdgeZones'
import CockpitLayoutHotspot from './hud/CockpitLayoutHotspot'
import CockpitHudShell from './hud/CockpitHudShell'
import DisplayModeOverlay from './hud/DisplayModeOverlay'
import PermissionPromptOverlay from './hud/PermissionPromptOverlay'
import SwUpdateBanner from './hud/SwUpdateBanner'

const MapCanvas = lazy(() => import('./components/MapCanvas'))
const WaypointLayer = lazy(() => import('./layers/WaypointLayer'))
const RouteLayer = lazy(() => import('./layers/RouteLayer'))
const LayerPanel = lazy(() => import('./hud/LayerPanel'))
const WaypointTypePanel = lazy(() => import('./hud/WaypointTypePanel'))
const DeadManPanel = lazy(() => import('./hud/DeadManPanel'))
const DisplayModePanel = lazy(() => import('./hud/DisplayModePanel'))
const SituationPanel = lazy(() => import('./hud/SituationPanel'))
const VoicePanel = lazy(() => import('./hud/VoicePanel'))
const WeatherPanel = lazy(() => import('./hud/WeatherPanel'))
const CommandPalette = lazy(() => import('./hud/CommandPalette'))
const StatusRail = lazy(() => import('./hud/StatusRail'))
const PresetPanel = lazy(() => import('./hud/PresetPanel'))
const CheckInPanel = lazy(() => import('./hud/CheckInPanel'))
const SOSPanel = lazy(() => import('./hud/SOSPanel'))
const PreflightPanel = lazy(() => import('./hud/PreflightPanel'))
const InstallHelperBanner = lazy(() => import('./hud/InstallHelperBanner'))

export default function App() {
  return (
    <AppProvider>
      <CockpitProvider>
      <PanelDataProvider>
      <MapProvider>
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
              <SituationPanel />
              <DisplayModePanel />
              <CheckInPanel />
              <VoicePanel />
              <SOSPanel />
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
              <Suspense fallback={null}>
                <LayerPanel />
                <WaypointTypePanel />
                <DeadManPanel />
              </Suspense>
            </div>
            <Suspense fallback={null}>
              <StatusRail />
              <CommandPalette />
            </Suspense>
          </CockpitHudShell>
          <DisplayModeOverlay />
        </div>
      </MapProvider>
      </PanelDataProvider>
      </CockpitProvider>
    </AppProvider>
  )
}
