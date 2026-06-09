/**
 * Presentation Debug Overlay - Phase 3D
 *
 * DEV-ONLY runtime visibility of presentation system state.
 * Helps verify hybrid mode is actually active.
 *
 * SAFETY:
 * - Only renders in DEV mode (import.meta.env.DEV)
 * - No production impact
 * - No polling, no timers
 * - Reads only — no state modifications
 * - Tiny footprint
 */

import { useHudPresentation } from '../context/HudPresentationContext'
import { useCockpit } from '../context/CockpitContext'

export function PresentationDebugOverlay(): JSX.Element | null {
  // Only render in development
  if (!import.meta.env.DEV) return null

  const {
    mode,
    microStatusBar,
    dockCollapsed,
    mapDominant,
    radialEmphasized,
    emergencyFloating,
  } = useHudPresentation()

  const { panels } = useCockpit()

  // Count panel states
  const totalPanels = Object.keys(panels).length
  const minimizedPanels = Object.values(panels).filter(
    (p) => p?.minimized,
  ).length
  const dockedPanels = Object.values(panels).filter((p) => p?.docked).length

  const isHybridActive = mode === 'hybrid'
  const allPanelsMinimized = minimizedPanels >= totalPanels - 2 // Allow SOS/DeadMan

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 8,
        left: 8,
        zIndex: 99999,
        padding: '8px 12px',
        borderRadius: 6,
        background: isHybridActive && allPanelsMinimized
          ? 'rgba(20, 40, 30, 0.95)'
          : 'rgba(40, 20, 20, 0.95)',
        border: `1px solid ${
          isHybridActive && allPanelsMinimized
            ? 'rgba(125, 255, 138, 0.5)'
            : 'rgba(255, 100, 100, 0.5)'
        }`,
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontSize: 11,
        color: isHybridActive && allPanelsMinimized ? '#7dffa8' : '#ff8888',
        lineHeight: 1.4,
        minWidth: 180,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>PRESENTATION DEBUG</div>

      <div style={{ display: 'grid', gap: 2 }}>
        <DebugRow label="MODE" value={mode} active={isHybridActive} />
        <DebugRow label="PANELS" value={`${minimizedPanels}/${totalPanels}`} active={allPanelsMinimized} />
        <DebugRow label="MICRO BAR" value={microStatusBar ? 'YES' : 'NO'} active={microStatusBar} />
        <DebugRow label="DOCK SUPPRESSED" value={dockCollapsed ? 'YES' : 'NO'} active={dockCollapsed} />
        <DebugRow label="MAP DOMINANT" value={mapDominant ? 'YES' : 'NO'} active={mapDominant} />
        <DebugRow label="EMERGENCY FLOAT" value={emergencyFloating ? 'YES' : 'NO'} active={emergencyFloating} />
      </div>

      <div
        style={{
          marginTop: 8,
          paddingTop: 6,
          borderTop: '1px solid rgba(255,255,255,0.1)',
          fontSize: 10,
          color: 'rgba(255,255,255,0.6)',
        }}
      >
        {isHybridActive && allPanelsMinimized
          ? '✓ HYBRID MODE ACTIVE'
          : '⚠ HYBRID MODE NOT FULLY ACTIVE'}
      </div>
    </div>
  )
}

function DebugRow({
  label,
  value,
  active,
}: {
  label: string
  value: string
  active: boolean
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span style={{ color: active ? '#7dffa8' : '#ff8888', fontWeight: 600 }}>
        {value}
      </span>
    </div>
  )
}

export default PresentationDebugOverlay
