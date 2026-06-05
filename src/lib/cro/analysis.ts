/**
 * Communications Recovery Overlay (CRO) - Terrain & Signal Analysis
 *
 * Calculates probable signal recovery directions using:
 * - Elevation profiles
 * - Cached tower locations
 * - User's historical recovery points
 * - Terrain heuristics (ridgelines, valleys)
 *
 * NO real-time API calls - all data is cached/local.
 * NO RF scanning - purely geometric/terrain heuristics.
 */

import type {
  CachedTower,
  CroHeuristicWeights,
  CroSignalState,
  CroState,
  ElevationProfile,
  RecoveryDirection,
  RecoveryDirectionReason,
  SignalRecoveryPoint,
  TerrainCell,
} from './types'
import { CRO_WEIGHTS_DEFAULT } from './types'
import { haversineMeters } from '../haversine'
import { logInfo, logWarn } from '../../runtime/logger'

// ============================================================================
// CORE ANALYSIS ENTRY POINT
// ============================================================================

/**
 * Analyze terrain and propose recovery directions.
 *
 * @param currentPosition - Current GPS location
 * @param elevation - Current elevation in meters
 * @param croState - Current signal state
 * @param towers - Cached towers from storage
 * @param recoveryPoints - User's historical recovery points
 * @param weights - Heuristic weighting
 * @param maxDirections - Maximum directions to return (2-3 recommended)
 * @returns Array of recovery directions, sorted by confidence
 */
export function analyzeRecoveryDirections(
  currentPosition: { lat: number; lng: number },
  elevation: number | null,
  croState: CroState,
  towers: CachedTower[],
  recoveryPoints: SignalRecoveryPoint[],
  weights: CroHeuristicWeights = CRO_WEIGHTS_DEFAULT,
  maxDirections: number = 3,
): RecoveryDirection[] {
  if (croState.signalState === 'connected') {
    return [] // No recovery needed
  }

  // Sample terrain in 8 cardinal directions
  const directions = sampleTerrainDirections(currentPosition, elevation)

  // Score each direction
  const scored = directions.map((dir) => {
    const scores = {
      elevation: scoreElevationGain(dir, weights.elevationGain),
      tower: scoreTowerProximity(dir.heading, currentPosition, towers, weights.towerProximity),
      history: scoreHistoricalSuccess(dir.heading, currentPosition, recoveryPoints, weights.historicalSuccess),
      clearance: scoreRidgelineClearance(dir, weights.ridgelineClearance),
    }

    const totalScore = Object.values(scores).reduce((a, b) => a + b, 0)

    return {
      direction: dir,
      scores,
      totalScore,
    }
  })

  // Sort by total score descending
  scored.sort((a, b) => b.totalScore - a.totalScore)

  // Convert top directions to RecoveryDirection format
  const results: RecoveryDirection[] = []
  for (let i = 0; i < Math.min(maxDirections, scored.length); i++) {
    const s = scored[i]
    if (s.totalScore <= 0) continue // Skip directions with no merit

    const dir = createRecoveryDirection(s.direction, s.scores, s.totalScore, i)
    if (dir) results.push(dir)
  }

  logInfo('CRO', `Analysis complete: ${results.length} directions proposed`, {
    signalState: croState.signalState,
    directions: results.map((d) => ({ heading: d.headingDegrees, confidence: d.confidence })),
  })

  return results
}

// ============================================================================
// TERRAIN SAMPLING
// ============================================================================

interface DirectionSample {
  heading: number // degrees
  distanceMeters: number
  elevationChange: number
  slopeDegrees: number
  isUphill: boolean
}

/**
 * Sample terrain in 8 cardinal/intercardinal directions.
 * In a real implementation, this would query elevation API or cached DEM.
 * For now, uses simplified heuristic.
 */
function sampleTerrainDirections(
  position: { lat: number; lng: number },
  currentElevation: number | null,
): DirectionSample[] {
  const directions: number[] = [0, 45, 90, 135, 180, 225, 270, 315] // N, NE, E, SE, S, SW, W, NW
  const sampleDistanceMeters = 500 // Sample 500m out

  return directions.map((heading) => {
    // In a real implementation, this would:
    // 1. Calculate lat/lng at distance in heading
    // 2. Query elevation at that point (cached DEM or API)
    // 3. Calculate slope

    // For now, use placeholder heuristic based on heading
    // (North/East typically higher in many regions - replace with real data)
    const simulatedElevationChange = simulateElevationChange(heading, sampleDistanceMeters)

    return {
      heading,
      distanceMeters: sampleDistanceMeters,
      elevationChange: simulatedElevationChange,
      slopeDegrees: Math.abs(simulatedElevationChange) / sampleDistanceMeters * 100 * 0.6, // Approximate
      isUphill: simulatedElevationChange > 0,
    }
  })
}

/**
 * Placeholder elevation simulation.
 * TODO: Replace with real elevation sampling from cached DEM or API.
 */
function simulateElevationChange(heading: number, distanceMeters: number): number {
  // Simple heuristic: NE (45°) and N (0°) often higher in mountainous regions
  // This is just for demonstration - real implementation should query actual elevation data
  const headingBonus = Math.cos((heading - 45) * Math.PI / 180) * 50 // -50 to +50m
  const randomVariation = (Math.random() - 0.5) * 20 // ±10m noise
  return headingBonus + randomVariation
}

// ============================================================================
// SCORING FUNCTIONS
// ============================================================================

/**
 * Score based on elevation gain (higher ground = potentially better signal).
 */
function scoreElevationGain(sample: DirectionSample, weight: number): number {
  if (!sample.isUphill) return 0

  // More elevation gain = higher score, but diminishing returns
  const rawScore = Math.min(sample.elevationChange / 100, 1.0) // Max out at 100m gain
  return rawScore * weight
}

/**
 * Score based on proximity to known towers.
 */
function scoreTowerProximity(
  heading: number,
  position: { lat: number; lng: number },
  towers: CachedTower[],
  weight: number,
): number {
  if (towers.length === 0) return 0

  let bestScore = 0

  for (const tower of towers) {
    const distanceM = haversineMeters(position.lat, position.lng, tower.lat, tower.lng)
    if (distanceM > 5000) continue // Ignore towers > 5km away

    // Calculate bearing to tower
    const bearingToTower = calculateBearing(position.lat, position.lng, tower.lat, tower.lng)

    // How aligned is this direction with the tower?
    const bearingDiff = Math.abs(normalizeAngle(heading - bearingToTower))
    if (bearingDiff > 45) continue // Must be within 45 degrees

    // Closer towers get higher scores, but we care about alignment too
    const distanceScore = 1 - (distanceM / 5000)
    const alignmentScore = 1 - (bearingDiff / 45)
    const towerScore = distanceScore * alignmentScore * 0.8 // Slightly reduce tower weight

    if (towerScore > bestScore) bestScore = towerScore
  }

  return bestScore * weight
}

/**
 * Score based on user's historical success in this direction.
 */
function scoreHistoricalSuccess(
  heading: number,
  position: { lat: number; lng: number },
  recoveryPoints: SignalRecoveryPoint[],
  weight: number,
): number {
  if (recoveryPoints.length === 0) return 0

  let bestScore = 0

  for (const point of recoveryPoints) {
    const distanceM = haversineMeters(position.lat, position.lng, point.lat, point.lng)
    if (distanceM > 2000) continue // Only consider points within 2km

    const bearingToPoint = calculateBearing(position.lat, position.lng, point.lat, point.lng)
    const bearingDiff = Math.abs(normalizeAngle(heading - bearingToPoint))
    if (bearingDiff > 60) continue

    // Closer and better-aligned recovery points score higher
    const distanceScore = 1 - (distanceM / 2000)
    const alignmentScore = 1 - (bearingDiff / 60)
    const qualityMultiplier = point.quality === 'good' ? 1.0 : 0.6

    const pointScore = distanceScore * alignmentScore * qualityMultiplier
    if (pointScore > bestScore) bestScore = pointScore
  }

  return bestScore * weight
}

/**
 * Score based on ridgeline clearance (line-of-sight likelihood).
 */
function scoreRidgelineClearance(sample: DirectionSample, weight: number): number {
  // Uphill directions generally have better ridgeline clearance
  // (you're climbing toward higher ground, so less chance of being in a shadow)
  if (!sample.isUphill) return 0.2 // Downhill gets minimal score

  // Steeper slopes might indicate ridgeline approach
  if (sample.slopeDegrees > 15) {
    return 0.8 * weight // Likely approaching ridgeline
  }

  return 0.5 * weight // Moderate uphill
}

// ============================================================================
// DIRECTION CREATION
// ============================================================================

interface DirectionScores {
  elevation: number
  tower: number
  history: number
  clearance: number
}

function createRecoveryDirection(
  sample: DirectionSample,
  scores: DirectionScores,
  totalScore: number,
  rank: number,
): RecoveryDirection | null {
  // Determine confidence based on score and contributing factors
  let confidence: RecoveryDirection['confidence']
  if (totalScore > 0.7) confidence = 'high'
  else if (totalScore > 0.4) confidence = 'medium'
  else if (totalScore > 0.15) confidence = 'low'
  else return null // Not confident enough

  // Determine primary reason
  const reason = determinePrimaryReason(scores, sample)

  // Generate terrain hint
  const terrainHint = generateTerrainHint(reason, sample)

  return {
    id: `cro-${rank}-${Date.now()}`,
    headingDegrees: Math.round(sample.heading),
    confidence,
    reason,
    distanceEstimateMeters: sample.distanceMeters * 2, // Estimate 1km exploration
    terrainHint,
    arcWidthDegrees: confidence === 'high' ? 30 : confidence === 'medium' ? 45 : 60,
    color: confidence === 'high' ? '#22c55e' : confidence === 'medium' ? '#eab308' : '#f97316',
    opacity: 0.4,
  }
}

function determinePrimaryReason(scores: DirectionScores, sample: DirectionSample): RecoveryDirectionReason {
  // Find the highest scoring factor
  const maxScore = Math.max(scores.elevation, scores.tower, scores.history, scores.clearance)

  if (maxScore === scores.tower) return 'toward_known_tower'
  if (maxScore === scores.history) return 'historical_success'
  if (maxScore === scores.elevation && sample.isUphill) return 'higher_elevation'
  if (maxScore === scores.clearance) return 'away_from_ridgeline'
  return 'higher_elevation' // Default
}

function generateTerrainHint(reason: RecoveryDirectionReason, sample: DirectionSample): string {
  switch (reason) {
    case 'higher_elevation':
      return sample.isUphill ? 'Uphill - higher ground ahead' : 'Level or downhill terrain'
    case 'toward_known_tower':
      return 'Known signal source in this direction'
    case 'away_from_ridgeline':
      return 'Likely line-of-sight clearance'
    case 'historical_success':
      return 'You found signal here before'
    case 'toward_valley_opening':
      return 'Less terrain blockage expected'
    case 'downward_for_mesh':
      return 'Toward teammates for mesh relay'
  }
}

// ============================================================================
// GEOMETRY UTILITIES
// ============================================================================

/**
 * Calculate bearing from point A to point B.
 * @returns Bearing in degrees (0-360)
 */
function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => deg * Math.PI / 180
  const toDeg = (rad: number) => rad * 180 / Math.PI

  const dLng = toRad(lng2 - lng1)
  const lat1Rad = toRad(lat1)
  const lat2Rad = toRad(lat2)

  const y = Math.sin(dLng) * Math.cos(lat2Rad)
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng)

  const bearing = toDeg(Math.atan2(y, x))
  return normalizeAngle(bearing)
}

/**
 * Normalize angle to 0-360 degrees.
 */
function normalizeAngle(angle: number): number {
  let result = angle % 360
  if (result < 0) result += 360
  return result
}

// ============================================================================
// SIGNAL STATE DETECTION
// ============================================================================

/**
 * Detect signal state from network conditions.
 */
export function detectSignalState(
  online: boolean,
  missionPeers: number,
  lastPeerUpdate: number | null,
): CroSignalState {
  if (!online) return 'none'

  // If we have recent peer connections, we're in good shape
  if (missionPeers > 0 && lastPeerUpdate && Date.now() - lastPeerUpdate < 60000) {
    return 'connected'
  }

  // Online but no peers = weak signal state
  if (missionPeers === 0) {
    return 'weak'
  }

  return 'connected'
}
