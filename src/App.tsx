import React, { Suspense, lazy } from 'react'
import { AppProvider } from './context/AppContext'
import { CockpitProvider } from './context/CockpitContext'
import { MapProvider } from './context/MapContext'
import { PanelDataProvider } from './context/PanelDataContext'
import { TrailRouteProvider } from './context/TrailRouteContext'
import { MissionSyncProvider } from './context/MissionSyncContext'
import TopBar from './hud/TopBar'
import ScanlineOverlay from './hud/ScanlineOverlay'
import CockpitKeyboard from './hud/CockpitKeyboard'
import CockpitEdgeZones from './hud/CockpitEdgeZones'
import CockpitLayoutHotspot from './hud/CockpitLayoutHotspot'
import CockpitHudShell from './hud/CockpitHudShell'
import DisplayModeOverlay from './hud/DisplayModeOverlay'
import PermissionPromptOverlay from './hud/PermissionPromptOverlay'
import SwUpdateBanner from './hud/SwUpdateBanner'
import TacticalSetupBanner from './hud/TacticalSetupBanner'

const MapCanvas = lazy(() => import('./components/MapCanvas'))
const WaypointLayer = lazy(() => import('./layers/WaypointLayer'))
const RouteLayer = lazy(() => import('./layers/RouteLayer'))
const TeamPresenceLayer = lazy(() => import('./layers/TeamPresenceLayer'))
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

export default function App() {
  return (
    <AppProvider>
      <MissionSyncProvider>
      <CockpitProvider>
      <PanelDataProvider>
      <MapProvider>
        <TrailRouteProvider>
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
            <TeamPresenceLayer />
          </Suspense>

          {/* ── Atmospheric overlays (z-index: 1-2) ── */}
          <ScanlineOverlay />
          <PermissionPromptOverlay />
          <TacticalSetupBanner />
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
              <CheckInPanel />
              <VoicePanel />
              <SOSPanel />
              <WeatherPanel />
              <PresetPanel />
              <PreflightPanel />
              <MissionLinkPanel />
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
            <NavigationHud />
          </Suspense>
        </div>
      </TrailRouteProvider>
      </MapProvider>
      </PanelDataProvider>
      </CockpitProvider>
      </MissionSyncProvider>
    </AppProvider>
  )
}
