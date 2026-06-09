export { LAYER_Z, layerZ, type LayerZKey } from './zIndexLayers'
export {
  ClassicRoot,
  BalancedRoot,
  ModernRoot,
  ModePortalHost,
  GlobalOverlayRoot,
  ModeRootIsolationGuard,
  presentationModeToRootId,
  getModePortalTarget,
  getGlobalOverlayTarget,
  type ModeRootId,
} from './modeRoots'
export {
  registerPortal,
  unregisterPortal,
  getActivePortals,
  getOrphanedPortals,
  clearPortalRegistry,
  type PortalOwner,
  type PortalEntry,
} from './portalRegistry'
export {
  runIsolationAudit,
  assertModeRootIsolation,
  publishIsolationApi,
  type IsolationViolation,
} from './isolationAssertions'
export {
  runCompositionAudit,
  assertModeComposition,
  publishCompositionApi,
  type CompositionViolation,
} from './compositionAssertions'
export {
  collectCompositionAudit,
  collectMountTree,
  MODE_COMPOSITION_MARKERS,
  type CompositionAuditResult,
  type CompositionEntry,
  type CompositionFlag,
} from './compositionAudit'
export { ModePortal } from './ModePortal'
