/**
 * Communications Recovery Overlay (CRO) - Data Model
 *
 * Purpose: Assist users in finding probable signal recovery directions
 * during communication outages.
 *
 * Design Principles:
 * - Offline-first (cached tower data, terrain heuristics)
 * - Minimal UI (2-3 directions max, no clutter)
 * - Terrain-aware (elevation, ridgelines)
 * - Battery-conscious (no polling, no heavy computation)
 *
 * NOT a full tower map or RF scanner - just directional guidance.
 */

// ============================================================================
// CRO State
// ============================================================================

export type CroSignalState = 'connected' | 'weak' | 'none' | 'unknown'

export interface CroState {
  signalState: CroSignalState
  lastConnectedAt: number | null
  lastKnownLocation: { lat: number; lng: number } | null
  degradationDurationMs: number
}

// ============================================================================
// Terrain Analysis
// ============================================================================

export interface TerrainCell {
  elevationMeters: number
  slopeDegrees: number  // 0-90, how steep
  aspectDegrees: number // 0-360, which direction the slope faces
  isRidgeline: boolean
  isValley: boolean
}

export interface ElevationProfile {
  center: { lat: number; lng: number; elevationM: number }
  samples: Array<{
    direction: number // degrees
    distanceMeters: number
    elevationMeters: number
    slopeDegrees: number
  }>
}

// ============================================================================
// Tower/Cached Infrastructure
// ============================================================================

/**
 * Cached cell tower or known signal source.
 * Stored locally, no real-time API required.
 */
export interface CachedTower {
  id: string
  lat: number
  lng: number
  elevationMeters?: number
  lastConfirmedAt: number // timestamp when signal was confirmed here
  signalStrength?: number // -dBm (higher negative = weaker)
  carrier?: string
  // Relative position info for offline use
  terrainContext?: {
    visibleFromDirections: number[] // directions (deg) where tower is visible
    behindRidgeline: boolean
  }
}

/**
 * Known signal recovery points from user history.
 * Crowdsourced from user's own successful reconnections.
 */
export interface SignalRecoveryPoint {
  lat: number
  lng: number
  elevationMeters: number
  foundAt: number
  networkType: 'cellular' | 'wifi' | 'satellite' | 'mesh'
  quality: 'good' | 'marginal'
}

// ============================================================================
// Recovery Direction
// ============================================================================

export interface RecoveryDirection {
  id: string
  headingDegrees: number // 0-360
  confidence: 'high' | 'medium' | 'low'
  reason: RecoveryDirectionReason
  distanceEstimateMeters?: number
  terrainHint?: string
  // Visual representation
  arcWidthDegrees: number // 15-60 degrees
  color: string // hex color for the arc/cone
  opacity: number // 0.3-0.6
}

export type RecoveryDirectionReason =
  | 'higher_elevation'      // Upward slope likely to have signal
  | 'toward_known_tower'    // Cached tower in this direction
  | 'away_from_ridgeline'   // May be line-of-sight blocked
  | 'historical_success'    // User found signal here before
  | 'toward_valley_opening' // Less terrain blockage
  | 'downward_for_mesh'     // Toward teammates for mesh relay

// ============================================================================
// CRO Configuration
// ============================================================================

export interface CroConfig {
  enabled: boolean
  maxDirections: number // 2-3 recommended
  minConfidence: 'low' | 'medium' | 'high'
  showDistance: boolean
  showTerrainHints: boolean
  // Display thresholds
  showWhenSignal: CroSignalState[]
  autoDismissOnReconnect: boolean
  dismissDelayMs: number
}

export const CRO_CONFIG_DEFAULT: CroConfig = {
  enabled: true,
  maxDirections: 3,
  minConfidence: 'low',
  showDistance: true,
  showTerrainHints: true,
  showWhenSignal: ['weak', 'none'],
  autoDismissOnReconnect: true,
  dismissDelayMs: 5000,
}

// ============================================================================
// Heuristic Weights (configurable)
// ============================================================================

export interface CroHeuristicWeights {
  elevationGain: number    // 0-1, weight for higher ground
  towerProximity: number   // 0-1, weight for known towers
  historicalSuccess: number // 0-1, weight for user's past reconnects
  ridgelineClearance: number // 0-1, weight for LOS clearance
  meshProximity: number    // 0-1, weight toward teammates
}

export const CRO_WEIGHTS_DEFAULT: CroHeuristicWeights = {
  elevationGain: 0.35,
  towerProximity: 0.30,
  historicalSuccess: 0.20,
  ridgelineClearance: 0.10,
  meshProximity: 0.05,
}

// ============================================================================
// SVS Integration (optional voice prompts)
// ============================================================================

export interface CroSvsPrompt {
  condition: 'signal_degraded' | 'signal_lost' | 'recovery_suggested'
  text: string
  priority: 1 | 2 // 1 = safety (immediate), 2 = operational (helpful)
}

export const CRO_SVS_PROMPTS: CroSvsPrompt[] = [
  { condition: 'signal_lost', text: 'Signal lost. Check overlay for recovery directions.', priority: 2 },
  { condition: 'signal_degraded', text: 'Signal weakening. Consider positioning for better line of sight.', priority: 2 },
  { condition: 'recovery_suggested', text: 'Higher elevation may improve connectivity.', priority: 2 },
]

// ============================================================================
// Persistence
// ============================================================================

export interface CroPersistentData {
  version: number
  cachedTowers: CachedTower[]
  recoveryPoints: SignalRecoveryPoint[]
  lastPrunedAt: number
}

export const CRO_STORAGE_KEY = 'hud_cro_data_v1'
export const CRO_MAX_CACHED_TOWERS = 50
export const CRO_MAX_RECOVERY_POINTS = 100
export const CRO_PRUNE_AGE_DAYS = 30
