/**
 * Balanced Workspace Shell
 * ========================
 *
 * The layout orchestrator for the Balanced Layer.
 *
 * RESPONSIBILITIES:
 * - Map dominance (>70% viewport priority)
 * - Tray positioning and orchestration
 * - Responsive behavior across device classes
 * - Overlay coordination
 * - Workspace layout authority
 *
 * NO CockpitContext dependency
 * NO dock logic
 * NO cockpit shell framing
 * NO collision detection
 * NO resize systems
 */

import React, { useMemo } from 'react'
import { useBalancedWorkspace } from './hooks/useBalancedWorkspace'
import { getDeviceProfile } from '../../runtime/deviceProfile'

interface BalancedWorkspaceShellProps {
  children: React.ReactNode
  /** Optional className for styling overrides */
  className?: string
}

/**
 * Device-specific layout constants
 */
const LAYOUT = {
  // Desktop: wider trays, larger planning surfaces
  desktop: {
    trayWidth: 360,
    maxTrayWidth: 420,
    mapPadding: { left: 16, right: 16, top: 16, bottom: 16 },
    bottomSheetHeight: 400,
  },
  // Tablet: collapsible side sheets, bottom utility trays
  tablet: {
    trayWidth: 320,
    maxTrayWidth: 380,
    mapPadding: { left: 12, right: 12, top: 12, bottom: 12 },
    bottomSheetHeight: 350,
  },
  // Phone: stacked sheets, temporary overlays
  phone: {
    trayWidth: '100%',
    maxTrayWidth: '100%',
    mapPadding: { left: 8, right: 8, top: 8, bottom: 8 },
    bottomSheetHeight: 300,
  },
} as const

export default function BalancedWorkspaceShell({ children, className }: BalancedWorkspaceShellProps) {
  const deviceProfile = useMemo(() => getDeviceProfile(), [])
  const workspace = useBalancedWorkspace()

  // Determine device class
  const isPhone = deviceProfile.width < 640 || deviceProfile.interactionMode === 'mobile'
  const isTablet = deviceProfile.width >= 640 && deviceProfile.width < 1024
  const isDesktop = deviceProfile.width >= 1024

  const layout = isDesktop ? LAYOUT.desktop : isTablet ? LAYOUT.tablet : LAYOUT.phone

  // Compute workspace geometry
  const workspaceStyle = useMemo(() => {
    const base: React.CSSProperties = {
      position: 'fixed',
      inset: 0,
      display: 'grid',
      gridTemplateAreas: isPhone
        ? `'header' 'map' 'tools'`
        : `'header header' 'left map right' 'bottom bottom'`,
      gridTemplateColumns: isPhone
        ? '1fr'
        : `${typeof layout.trayWidth === 'number' ? layout.trayWidth + 'px' : layout.trayWidth} 1fr ${typeof layout.trayWidth === 'number' ? layout.trayWidth + 'px' : layout.trayWidth}`,
      gridTemplateRows: isPhone
        ? 'auto 1fr auto'
        : 'auto 1fr auto',
      overflow: 'hidden',
      pointerEvents: 'none', // Let clicks pass through to map by default
    }
    return base
  }, [isPhone, layout.trayWidth])

  // Map container style - always dominant
  const mapContainerStyle = useMemo((): React.CSSProperties => ({
    gridArea: 'map',
    position: 'relative',
    pointerEvents: 'auto',
    overflow: 'hidden',
  }), [])

  // Left tray style
  const leftTrayStyle = useMemo((): React.CSSProperties => ({
    gridArea: 'left',
    position: 'relative',
    pointerEvents: 'auto',
    display: workspace.isPanelVisible('route') || workspace.isPanelVisible('waypoints') ? 'flex' : 'none',
    flexDirection: 'column',
    gap: 12,
    padding: layout.mapPadding.left,
    maxWidth: isPhone ? '100%' : layout.maxTrayWidth,
    overflow: 'visible',
  }), [workspace, layout.mapPadding.left, layout.maxTrayWidth, isPhone])

  // Right tray style
  const rightTrayStyle = useMemo((): React.CSSProperties => ({
    gridArea: 'right',
    position: 'relative',
    pointerEvents: 'auto',
    display: workspace.isPanelVisible('overlays') ? 'flex' : 'none',
    flexDirection: 'column',
    gap: 12,
    padding: layout.mapPadding.right,
    maxWidth: isPhone ? '100%' : layout.maxTrayWidth,
    overflow: 'visible',
  }), [workspace, layout.mapPadding.right, layout.maxTrayWidth, isPhone])

  // Bottom tray style (mobile primarily)
  const bottomTrayStyle = useMemo((): React.CSSProperties => ({
    gridArea: 'bottom',
    position: 'relative',
    pointerEvents: 'auto',
    display: workspace.isPanelVisible('mission') || workspace.bottomSheetOpen ? 'flex' : 'none',
    flexDirection: 'row',
    gap: 12,
    padding: layout.mapPadding.bottom,
    overflow: 'visible',
    justifyContent: 'center',
  }), [workspace, layout.mapPadding.bottom])

  // Header strip style (for micro status and tools)
  const headerStyle = useMemo((): React.CSSProperties => ({
    gridArea: 'header',
    position: 'relative',
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${layout.mapPadding.top}px ${layout.mapPadding.left}px`,
    gap: 12,
    zIndex: 100,
  }), [layout.mapPadding.top, layout.mapPadding.left])

  return (
    <div
      className={className}
      style={workspaceStyle}
      data-balanced-workspace
      data-device-class={isPhone ? 'phone' : isTablet ? 'tablet' : 'desktop'}
      data-map-dominant="true"
    >
      {/* Map Container - Always takes majority of space */}
      <div style={mapContainerStyle} data-balanced-map>
        {/* Map content injected via children */}
        {children}
      </div>

      {/* Left Tray - Route and Waypoint panels */}
      <div
        style={leftTrayStyle}
        data-balanced-tray="left"
        aria-hidden={!workspace.isPanelVisible('route') && !workspace.isPanelVisible('waypoints')}
      />

      {/* Right Tray - Overlay controls */}
      <div
        style={rightTrayStyle}
        data-balanced-tray="right"
        aria-hidden={!workspace.isPanelVisible('overlays')}
      />

      {/* Bottom Tray - Mission info, sheets (mobile) */}
      <div
        style={bottomTrayStyle}
        data-balanced-tray="bottom"
        aria-hidden={!workspace.isPanelVisible('mission') && !workspace.bottomSheetOpen}
      />

      {/* Header Strip - Micro status, quick actions */}
      <div style={headerStyle} data-balanced-header />
    </div>
  )
}

// Export layout constants for use by other components
export { LAYOUT }
