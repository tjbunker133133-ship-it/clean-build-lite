import React, { Suspense, lazy } from 'react'
import { AppProvider } from './context/AppContext'
import { CockpitProvider } from './context/CockpitContext'
import { MapProvider } from './context/MapContext'
import TopBar from './hud/TopBar'
import LayerPanel from './hud/LayerPanel'
import WaypointTypePanel from './hud/WaypointTypePanel'
import DeadManPanel from './hud/DeadManPanel'
import CoordDisplay from './hud/CoordDisplay'
import ScanlineOverlay from './hud/ScanlineOverlay'
import CockpitKeyboard from './hud/CockpitKeyboard'
import CockpitEdgeZones from './hud/CockpitEdgeZones'
import CockpitLayoutHotspot from './hud/CockpitLayoutHotspot'
import CockpitHudShell from './hud/CockpitHudShell'
import ElevationReadout from './hud/ElevationReadout'
import PermissionPromptOverlay from './hud/PermissionPromptOverlay'

const MapCanvas = lazy(() => import('./components/MapCanvas'))
const WaypointLayer = lazy(() => import('./layers/WaypointLayer'))
const RouteLayer = lazy(() => import('./layers/RouteLayer'))
const ClockPanel = lazy(() => import('./hud/ClockPanel'))
const DisplayModePanel = lazy(() => import('./hud/DisplayModePanel'))
const LocationPanel = lazy(() => import('./hud/LocationPanel'))
const VoicePanel = lazy(() => import('./hud/VoicePanel'))
const WeatherPanel = lazy(() => import('./hud/WeatherPanel'))
const CommandPalette = lazy(() => import('./hud/CommandPalette'))
const StatusRail = lazy(() => import('./hud/StatusRail'))
const PresetPanel = lazy(() => import('./hud/PresetPanel'))
const SOSPanel = lazy(() => import('./hud/SOSPanel'))
const PreflightPanel = lazy(() => import('./hud/PreflightPanel'))

export default function App() {
  return (
    <AppProvider>
      <CockpitProvider>
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

          <CockpitHudShell>
            <CockpitKeyboard />
            <CockpitEdgeZones />
            <CockpitLayoutHotspot />
            <TopBar />
            <Suspense fallback={null}>
              <ClockPanel />
              <DisplayModePanel />
              <LocationPanel />
              <VoicePanel />
              <SOSPanel />
              <WeatherPanel />
              <PresetPanel />
              <PreflightPanel />
            </Suspense>
            <ElevationReadout />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
              }}
            >
              <LayerPanel />
              <WaypointTypePanel />
              <DeadManPanel />
            </div>
            <CoordDisplay />
            <Suspense fallback={null}>
              <StatusRail />
              <CommandPalette />
            </Suspense>
          </CockpitHudShell>
        </div>
      </MapProvider>
      </CockpitProvider>
    </AppProvider>
  )
}
