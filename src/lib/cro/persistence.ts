/**
 * Communications Recovery Overlay (CRO) - Persistence Layer
 *
 * Manages:
 * - Cached tower locations (from successful connections)
 * - User's historical recovery points
 * - Data pruning and cleanup
 *
 * All data is local - no cloud sync.
 */

import type { CachedTower, CroPersistentData, SignalRecoveryPoint } from './types'
import {
  CRO_MAX_CACHED_TOWERS,
  CRO_MAX_RECOVERY_POINTS,
  CRO_PRUNE_AGE_DAYS,
  CRO_STORAGE_KEY,
} from './types'
import { logInfo, logWarn } from '../../runtime/logger'

// ============================================================================
// DATA LOADING
// ============================================================================

export function loadCroData(): CroPersistentData {
  if (typeof localStorage === 'undefined') {
    return createEmptyData()
  }

  try {
    const raw = localStorage.getItem(CRO_STORAGE_KEY)
    if (!raw) return createEmptyData()

    const parsed = JSON.parse(raw) as CroPersistentData

    // Version check and migration
    if (parsed.version !== 1) {
      logWarn('CRO', 'Data version mismatch, resetting')
      return createEmptyData()
    }

    return {
      ...parsed,
      cachedTowers: parsed.cachedTowers ?? [],
      recoveryPoints: parsed.recoveryPoints ?? [],
    }
  } catch (err) {
    logWarn('CRO', 'Failed to load data', { error: String(err) })
    return createEmptyData()
  }
}

function createEmptyData(): CroPersistentData {
  return {
    version: 1,
    cachedTowers: [],
    recoveryPoints: [],
    lastPrunedAt: Date.now(),
  }
}

// ============================================================================
// DATA SAVING
// ============================================================================

export function saveCroData(data: CroPersistentData): void {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(CRO_STORAGE_KEY, JSON.stringify(data))
  } catch (err) {
    logWarn('CRO', 'Failed to save data', { error: String(err) })
  }
}

export function updateCroData(partial: Partial<CroPersistentData>): void {
  const current = loadCroData()
  const updated = { ...current, ...partial }
  saveCroData(updated)
}

// ============================================================================
// TOWER MANAGEMENT
// ============================================================================

export function cacheTower(tower: Omit<CachedTower, 'lastConfirmedAt'>): void {
  const data = loadCroData()
  const now = Date.now()

  // Check if tower already exists (update if so)
  const existingIndex = data.cachedTowers.findIndex((t) => t.id === tower.id)

  const towerWithTimestamp: CachedTower = {
    ...tower,
    lastConfirmedAt: now,
  }

  if (existingIndex >= 0) {
    data.cachedTowers[existingIndex] = towerWithTimestamp
  } else {
    data.cachedTowers.push(towerWithTimestamp)
  }

  // Prune if over limit
  if (data.cachedTowers.length > CRO_MAX_CACHED_TOWERS) {
    data.cachedTowers = pruneTowers(data.cachedTowers)
  }

  saveCroData(data)
  logInfo('CRO', `Cached tower ${tower.id}`, { lat: tower.lat, lng: tower.lng })
}

export function getCachedTowers(): CachedTower[] {
  return loadCroData().cachedTowers
}

export function clearCachedTowers(): void {
  updateCroData({ cachedTowers: [] })
}

// ============================================================================
// RECOVERY POINT MANAGEMENT
// ============================================================================

export function recordRecoveryPoint(point: Omit<SignalRecoveryPoint, 'foundAt'>): void {
  const data = loadCroData()
  const now = Date.now()

  // Check for duplicate (within 100m)
  const isDuplicate = data.recoveryPoints.some((p) => {
    const distanceKm = haversineApprox(p.lat, p.lng, point.lat, point.lng)
    return distanceKm < 0.1 // 100 meters
  })

  if (isDuplicate) {
    logInfo('CRO', 'Recovery point too close to existing, skipping')
    return
  }

  const pointWithTimestamp: SignalRecoveryPoint = {
    ...point,
    foundAt: now,
  }

  data.recoveryPoints.push(pointWithTimestamp)

  // Prune if over limit
  if (data.recoveryPoints.length > CRO_MAX_RECOVERY_POINTS) {
    data.recoveryPoints = pruneRecoveryPoints(data.recoveryPoints)
  }

  saveCroData(data)
  logInfo('CRO', 'Recorded recovery point', {
    lat: point.lat,
    lng: point.lng,
    quality: point.quality,
  })
}

export function getRecoveryPoints(): SignalRecoveryPoint[] {
  return loadCroData().recoveryPoints
}

export function clearRecoveryPoints(): void {
  updateCroData({ recoveryPoints: [] })
}

// ============================================================================
// PRUNING
// ============================================================================

/**
 * Prune old data to keep within limits.
 * Call periodically (e.g., once per week).
 */
export function pruneCroData(force = false): void {
  const data = loadCroData()
  const now = Date.now()
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000

  // Only prune once per week unless forced
  if (!force && now - data.lastPrunedAt < oneWeekMs) {
    return
  }

  const oldTowerCount = data.cachedTowers.length
  const oldPointCount = data.recoveryPoints.length

  data.cachedTowers = pruneTowers(data.cachedTowers)
  data.recoveryPoints = pruneRecoveryPoints(data.recoveryPoints)
  data.lastPrunedAt = now

  saveCroData(data)

  logInfo('CRO', 'Pruned old data', {
    towersRemoved: oldTowerCount - data.cachedTowers.length,
    pointsRemoved: oldPointCount - data.recoveryPoints.length,
  })
}

function pruneTowers(towers: CachedTower[]): CachedTower[] {
  const cutoffMs = Date.now() - CRO_PRUNE_AGE_DAYS * 24 * 60 * 60 * 1000

  // Remove old towers
  let pruned = towers.filter((t) => t.lastConfirmedAt > cutoffMs)

  // If still over limit, keep only the most recently confirmed
  if (pruned.length > CRO_MAX_CACHED_TOWERS) {
    pruned.sort((a, b) => b.lastConfirmedAt - a.lastConfirmedAt)
    pruned = pruned.slice(0, CRO_MAX_CACHED_TOWERS)
  }

  return pruned
}

function pruneRecoveryPoints(points: SignalRecoveryPoint[]): SignalRecoveryPoint[] {
  const cutoffMs = Date.now() - CRO_PRUNE_AGE_DAYS * 24 * 60 * 60 * 1000

  // Remove old points
  let pruned = points.filter((p) => p.foundAt > cutoffMs)

  // If still over limit, keep best quality first, then most recent
  if (pruned.length > CRO_MAX_RECOVERY_POINTS) {
    pruned.sort((a, b) => {
      if (a.quality === 'good' && b.quality !== 'good') return -1
      if (b.quality === 'good' && a.quality !== 'good') return 1
      return b.foundAt - a.foundAt
    })
    pruned = pruned.slice(0, CRO_MAX_RECOVERY_POINTS)
  }

  return pruned
}

// ============================================================================
// STATISTICS
// ============================================================================

export function getCroStats(): {
  towerCount: number
  recoveryPointCount: number
  oldestTowerAge: number | null
  oldestPointAge: number | null
} {
  const data = loadCroData()
  const now = Date.now()

  return {
    towerCount: data.cachedTowers.length,
    recoveryPointCount: data.recoveryPoints.length,
    oldestTowerAge: data.cachedTowers.length > 0
      ? Math.min(...data.cachedTowers.map((t) => now - t.lastConfirmedAt))
      : null,
    oldestPointAge: data.recoveryPoints.length > 0
      ? Math.min(...data.recoveryPoints.map((p) => now - p.foundAt))
      : null,
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Quick haversine approximation for pruning (not precise but fast).
 */
function haversineApprox(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371 // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
