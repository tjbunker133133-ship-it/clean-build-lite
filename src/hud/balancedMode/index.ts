/**
 * Balanced Layer - Production Environment Exports
 * ================================================
 *
 * The Balanced Layer is the map-first operational workspace for planning,
 * route creation, and waypoint workflows.
 *
 * ARCHITECTURAL GUARANTEES:
 * - NO CockpitContext dependency
 * - NO HudPanel inheritance
 * - NO dock logic
 * - NO cockpit shell logic
 * - NO collision detection
 * - NO resize systems
 */

// Main components
export { default as BalancedLayer } from './BalancedLayer'
export { default as BalancedWorkspaceShell } from './BalancedWorkspaceShell'
export { default as BalancedModeContainer } from './BalancedModeContainer'

// Panel components
export { default as BalancedRoutePanel } from './BalancedRoutePanel'
export { default as BalancedWaypointPanel } from './BalancedWaypointPanel'
export { default as BalancedOverlayTray } from './BalancedOverlayTray'
export { default as BalancedMissionStrip } from './BalancedMissionStrip'
export { default as BalancedMapTools } from './BalancedMapTools'
export { default as BalancedQuickActions } from './BalancedQuickActions'

// Hooks
export { useBalancedWorkspace, BalancedWorkspaceProvider, type ToolMode, type BalancedPanelState, type BalancedWorkspaceState } from './hooks/useBalancedWorkspace'
export {
  useBalancedPanels,
  type BalancedPanelId,
  type BalancedPanelsState,
  type RoutePanelState,
  type WaypointPanelState,
  type OverlayPanelState,
  type MissionPanelState,
} from './hooks/useBalancedPanels'

// Design Tokens
export {
  balancedTokens,
  colors,
  spacing,
  typography,
  effects,
  waypointTypes,
  zIndex,
  panelPosition,
  interaction,
} from './lib/balancedTokens'
export type { WaypointTypeKey } from './lib/balancedTokens'

// Runtime Assertions
export {
  // Core assertions
  assertLayerIdentity,
  assertNoCockpitInit,
  assertBalancedDependencyGraph,
  assertMapOwnsNavigation,
  assertNoLegacySystemsActive,
  assertInteractionHierarchy,
  assertNoHybridMode,
  // Validation suites
  runBalancedValidationSuite,
  runBalancedValidationDev,
  // React integration
  useBalancedValidation,
  // Utilities
  isCockpitDependency,
  scanDependencyGraph,
  checkMapOwnership,
  scanLegacySystems,
  checkModeState,
  // Error class
  BalancedAssertionError,
  // Types
  type HudLayer,
  type StateOwnership,
  type SystemMetrics,
  type InteractionHierarchy,
  type ModeState,
  type ValidationContext,
  type ValidationReport,
  type UseBalancedValidationOptions,
} from './lib/balancedAssertions'
