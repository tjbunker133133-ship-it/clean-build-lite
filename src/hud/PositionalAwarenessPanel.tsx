import { useEffect, useState } from 'react'
import HudPanel from './HudPanel'
import { useCockpit } from '../context/CockpitContext'
import { useMapContext } from '../context/MapContext'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchGapMd, touchMinTarget } from './tokens'
import { CoordReadoutBody } from './CoordDisplay'
import { LocationNavBody } from './LocationPanel'
import { ElevationReadoutBody } from './ElevationReadout'
import { DisplayModePanelBody } from './DisplayModePanel'
import { LayerPanelBody } from './LayerPanel'
import { WaypointMissionBody, WaypointClearRouteHeaderButton } from './WaypointTypePanel'
import { useBreadcrumbSession } from '../hooks/useBreadcrumbSession'

function PasSectionTitle({ children }: { children: string }) {
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  return (
    <div
      style={{
        fontSize: fontSm,
        letterSpacing: '0.16em',
        fontWeight: 800,
        color: 'var(--cockpit-panel-subtle, #94a3b8)',
        marginBottom: 6,
        marginTop: 10,
      }}
    >
      {children}
    </div>
  )
}

function PasMovementSessionReadout() {
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const tapMin = Math.max(touchMinTarget(isMobile), 48)
  const { points, sessionMeters, clearSession } = useBreadcrumbSession()
  const km = (sessionMeters / 1000).toFixed(2)
  const mi = (sessionMeters / 1609.344).toFixed(2)
  return (
    <div>
      <div style={{ fontSize: fontSm, color: '#94a3b8', lineHeight: 1.45 }}>
        Session trail: <strong style={{ color: '#c7d4e0' }}>{points.length}</strong> points · Distance{' '}
        <strong style={{ color: '#c7d4e0' }}>{km}</strong> km ({mi} mi)
      </div>
      <div style={{ fontSize: fontSm * 0.92, color: '#6b7c8c', marginTop: 6, lineHeight: 1.4 }}>
        Trail density follows GPS power mode. Hardware fixes only; survives brief backgrounding.
      </div>
      <button
        type="button"
        data-ui-action="breadcrumb-clear-session"
        onClick={() => clearSession()}
        style={{
          marginTop: 12,
          minHeight: tapMin,
          padding: '0 14px',
          borderRadius: 8,
          border: '1px solid rgba(148, 184, 200, 0.45)',
          background: 'rgba(30, 48, 56, 0.5)',
          color: '#b8d0dc',
          fontSize: fontSm,
          cursor: 'pointer',
        }}
      >
        Clear breadcrumb trail
      </button>
    </div>
  )
}

/** Map rotation readout only — no GPS math. */
function PasMapHeadingReadout() {
  const { map } = useMapContext()
  const [bearing, setBearing] = useState(0)
  useEffect(() => {
    if (!map) return
    const sync = () => setBearing(map.getBearing())
    sync()
    map.on('rotate', sync)
    map.on('moveend', sync)
    map.on('idle', sync)
    return () => {
      map.off('rotate', sync)
      map.off('moveend', sync)
      map.off('idle', sync)
    }
  }, [map])
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        fontSize: fontSm,
        color: '#c7cec6',
        lineHeight: 1.45,
      }}
    >
      Map heading {Number.isFinite(bearing) ? `${Math.round(bearing)}°` : '—'}
    </div>
  )
}

export default function PositionalAwarenessPanel() {
  const { raisePanel, updatePanel } = useCockpit()
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const gapMd = touchGapMd(isMobile)
  const tapMin = Math.max(touchMinTarget(isMobile), 48)

  const openSos = () => {
    raisePanel('sos')
    updatePanel('sos', { minimized: false, docked: false })
  }

  return (
    <HudPanel
      panelId="positional"
      title="Situation"
      initialPos={{ x: 16, y: 56 }}
      initialWidth={Math.min(400, typeof window !== 'undefined' ? Math.floor(window.innerWidth * 0.92) : 360)}
      minHeight={120}
      dockedHeaderTrailing={<WaypointClearRouteHeaderButton />}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: Math.max(gapMd, 14),
          maxHeight: 'min(72vh, 640px)',
          overflowY: 'auto',
          paddingRight: 6,
          paddingBottom: 4,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <div style={{ paddingTop: 2 }}>
          <PasSectionTitle>POSITION</PasSectionTitle>
          <div style={{ fontSize: touchFontSm(isMobile), color: '#94a3b8', marginBottom: 4, lineHeight: 1.35 }}>
            Map center (viewport)
          </div>
          <CoordReadoutBody />
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: touchFontSm(isMobile), color: '#94a3b8', marginBottom: 4, lineHeight: 1.35 }}>
              Terrain / model elevation
            </div>
            <ElevationReadoutBody />
          </div>
        </div>

        <div
          style={{
            borderTop: '1px solid rgba(148, 163, 184, 0.2)',
            paddingTop: 4,
          }}
        >
          <PasSectionTitle>NAVIGATION</PasSectionTitle>
          <PasMapHeadingReadout />
          <div style={{ marginTop: 8 }}>
            <LocationNavBody />
          </div>
        </div>

        <div
          style={{
            borderTop: '1px solid rgba(148, 163, 184, 0.2)',
            paddingTop: 4,
          }}
        >
          <PasSectionTitle>MOVEMENT (SESSION)</PasSectionTitle>
          <PasMovementSessionReadout />
        </div>

        <div
          style={{
            borderTop: '1px solid rgba(148, 163, 184, 0.2)',
            paddingTop: 4,
          }}
        >
          <PasSectionTitle>ENVIRONMENT</PasSectionTitle>
          <DisplayModePanelBody />
        </div>

        <div
          style={{
            borderTop: '1px solid rgba(148, 163, 184, 0.2)',
            paddingTop: 4,
          }}
        >
          <PasSectionTitle>EMERGENCY</PasSectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: gapMd, alignItems: 'center' }}>
            <button
              type="button"
              data-no-drag
              onClick={openSos}
              style={{
                minHeight: Math.max(tapMin, 52),
                minWidth: Math.max(tapMin, 168),
                borderRadius: 10,
                border: '2px solid rgba(248,113,113,0.85)',
                background: 'linear-gradient(180deg,#450a0a,#1f0707)',
                color: '#fecaca',
                fontWeight: 800,
                letterSpacing: '0.12em',
                fontSize: touchFontSm(isMobile),
                cursor: 'pointer',
              }}
            >
              OPEN SOS PANEL
            </button>
            <span style={{ fontSize: touchFontSm(isMobile), color: '#94a3b8', maxWidth: 240, lineHeight: 1.45 }}>
              Opens SOS only — does not arm or send an alert.
            </span>
          </div>
        </div>

        <div
          style={{
            borderTop: '1px solid rgba(148, 163, 184, 0.2)',
            paddingTop: 4,
          }}
        >
          <PasSectionTitle>MISSION / SETUP</PasSectionTitle>
          <LayerPanelBody />
          <div style={{ marginTop: 12 }}>
            <WaypointMissionBody />
          </div>
        </div>
      </div>
    </HudPanel>
  )
}
