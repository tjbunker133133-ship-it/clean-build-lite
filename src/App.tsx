import React from 'react'
import { AppProvider } from './context/AppContext'
import { MapProvider } from './context/MapContext'
import MapCanvas from './components/MapCanvas'
import WaypointLayer from './layers/WaypointLayer'
import RouteLayer from './layers/RouteLayer'
import TopBar from './hud/TopBar'
import LayerPanel from './hud/LayerPanel'
import WaypointTypePanel from './hud/WaypointTypePanel'
import WaypointInfoPanel from './hud/WaypointInfoPanel'
import DeadManPanel from './hud/DeadManPanel'
import CoordDisplay from './hud/CoordDisplay'
import ScanlineOverlay from './hud/ScanlineOverlay'

export default function App() {
  return (
    <AppProvider>
      <MapProvider>
        {/* Full-screen container */}
        <div
          style={{
            position: 'fixed',
            inset: 0,
            overflow: 'hidden',
            background: '#080e14',
          }}
        >
          {/* ── Map Layer (z-index: 0) ── */}
          <MapCanvas />

          {/* ── Map Feature Layers (render-only, no DOM) ── */}
          <WaypointLayer />
          <RouteLayer />

          {/* ── Atmospheric overlays (z-index: 1-2) ── */}
          <ScanlineOverlay />

          {/* ── HUD Layer (z-index: 100+) ── */}
          {/* Top bar spans full width */}
          <TopBar />

          {/* Floating panels — all draggable */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 100,
              pointerEvents: 'none',
            }}
          >
            <LayerPanel />
            <WaypointTypePanel />
            <WaypointInfoPanel />
            <DeadManPanel />
          </div>

          {/* Bottom coord bar */}
          <CoordDisplay />
        </div>
      </MapProvider>
    </AppProvider>
  )
}
