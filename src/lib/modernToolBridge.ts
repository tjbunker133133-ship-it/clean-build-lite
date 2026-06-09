/**
 * Modern map tool bridge — syncs Modern tools into mapInteractionController.
 */

import {
  clearInteractionMode,
  enterDropMode,
  enterInspectMode,
  enterRouteMode,
  getInteractionMode,
  getMeasurePoints,
  subscribeMapInteraction,
  syncModernMeasure,
} from './mapInteractionController'

export type ModernMapTool = 'inspect' | 'route' | 'waypoint' | 'measure' | 'none'

export function setModernMeasureModeEnabled(enabled: boolean): void {
  syncModernMeasure(enabled)
}

export function isModernMeasureModeEnabled(): boolean {
  return getInteractionMode() === 'measure'
}

/** Mirrors Balanced setBalancedActiveTool → osgSyncBalancedTool for modern surface. */
export function setModernActiveTool(tool: ModernMapTool): void {
  switch (tool) {
    case 'measure':
      syncModernMeasure(true)
      break
    case 'route':
      enterRouteMode('modern')
      break
    case 'waypoint':
      enterDropMode('modern')
      break
    case 'inspect':
      enterInspectMode('modern')
      break
    default:
      if (getInteractionMode() === 'measure') syncModernMeasure(false)
      else clearInteractionMode('modern_tool_clear')
      break
  }
}

export function getModernActiveTool(): ModernMapTool {
  const mode = getInteractionMode()
  if (mode === 'measure') return 'measure'
  if (mode === 'route') return 'route'
  if (mode === 'drop') return 'waypoint'
  return 'none'
}

/** @deprecated */
export function setModernMeasureTapHandler(_handler: ((lat: number, lng: number) => void) | null): void {
  /* no-op */
}

/** @deprecated */
export function dispatchModernMeasureTap(lat: number, lng: number): boolean {
  return false
}

export function subscribeModernToolBridge(listener: () => void): () => void {
  return subscribeMapInteraction(listener)
}

export function getModernToolBridgeSnapshot(): { measureEnabled: boolean; activeTool: ModernMapTool } {
  return {
    measureEnabled: isModernMeasureModeEnabled(),
    activeTool: getModernActiveTool(),
  }
}

export function getModernMeasureSummary(): string | null {
  const pts = getMeasurePoints()
  if (pts.length === 0) return null
  if (pts.length === 1) return 'Tap second point'
  return 'measured'
}
