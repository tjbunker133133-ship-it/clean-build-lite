/**
 * Communications Recovery Overlay (CRO) - Main Entry Point
 *
 * Export all CRO functionality for use in the HUD.
 */

// Types
export type {
  CachedTower,
  CroConfig,
  CroHeuristicWeights,
  CroPersistentData,
  CroSignalState,
  CroState,
  RecoveryDirection,
  RecoveryDirectionReason,
  SignalRecoveryPoint,
  TerrainCell,
} from './types'

export {
  CRO_CONFIG_DEFAULT,
  CRO_STORAGE_KEY,
  CRO_SVS_PROMPTS,
  CRO_WEIGHTS_DEFAULT,
  CRO_MAX_CACHED_TOWERS,
  CRO_MAX_RECOVERY_POINTS,
  CRO_PRUNE_AGE_DAYS,
} from './types'

// Analysis
export {
  analyzeRecoveryDirections,
  detectSignalState,
} from './analysis'

// Persistence
export {
  cacheTower,
  clearCachedTowers,
  clearRecoveryPoints,
  getCachedTowers,
  getCroStats,
  getRecoveryPoints,
  loadCroData,
  pruneCroData,
  recordRecoveryPoint,
  saveCroData,
  updateCroData,
} from './persistence'
