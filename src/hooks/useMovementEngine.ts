/**
 * useMovementEngine — Modern Layer Environmental Runtime
 *
 * Derives real-time movement state from GPS position deltas.
 * Replaces the static placeholder in EnvironmentalInteractionLayer.
 *
 * Architecture:
 *   - Sources from PanelDataContext (already in provider tree, no new GPS watch)
 *   - Derives speed via haversine displacement / elapsed time
 *   - Derives heading via atan2 bearing between last two meaningful positions
 *   - Smooths speed and heading via EMA to eliminate GPS jitter
 *   - Exports authoritative MovementSnapshot for all Modern systems
 *
 * Performance contract:
 *   - No timers or loops — reactive to GPS coordinate changes only
 *   - Zero cost when GPS is unavailable
 *   - Never imported outside Modern Layer paths
 *
 * Frozen boundary: does NOT import or modify useGPS.ts (Tier 1)
 */

import { useEffect, useRef, useState } from 'react'
import { usePanelData } from '../context/PanelDataContext'
import { setFieldNavigationActive } from '../runtime/fieldPowerProfile'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type MovementState =
  | 'unknown'       // No GPS or insufficient history
  | 'stationary'    // Speed < 0.4 m/s — standing still
  | 'moving_slow'   // 0.4–5.5 m/s — walking / cycling
  | 'moving_fast'   // >5.5 m/s — driving / running

export interface MovementSnapshot {
  state: MovementState
  /** EMA-smoothed speed in m/s */
  speedMs: number
  /** EMA-smoothed speed in mph */
  speedMph: number
  /** 0–360° compass bearing, computed from recent displacement */
  headingDeg: number
  /** True only when speed is high enough for a reliable heading */
  hasHeading: boolean
  /** ms since last GPS update — useful for stale detection */
  lastUpdateMs: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** m/s thresholds — calibrated for field use */
const THRESHOLD_STATIONARY = 0.4   // < 0.4 m/s ≈ standing still
const THRESHOLD_FAST = 5.5         // > 5.5 m/s ≈ driving (~12 mph)

/** Minimum displacement (m) to update heading — prevents compass jitter at low speed */
const MIN_DISPLACEMENT_FOR_HEADING_M = 3.0

/** EMA alphas — lower = smoother, higher = more responsive */
const ALPHA_SPEED = 0.30
const ALPHA_HEADING = 0.18

/** Position history depth */
const HISTORY_SIZE = 5
/** Entries older than this are pruned before speed calculation */
const STALE_ENTRY_MS = 9_000
/** Skip delta if elapsed > this (GPS gap / background resume) */
const MAX_DELTA_MS = 10_000
/** Skip delta if elapsed < this (OS batching artifact) */
const MIN_DELTA_MS = 100

// ─── Geodesy helpers ──────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const x = Math.sin(Δλ) * Math.cos(φ2)
  const y = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
}

/** Circular EMA — handles 359°→1° wrap correctly */
function circularEma(prev: number, next: number, alpha: number): number {
  let delta = next - prev
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  return ((prev + delta * alpha) + 360) % 360
}

function linearEma(prev: number, next: number, alpha: number): number {
  return alpha * next + (1 - alpha) * prev
}

// ─── Position history entry ────────────────────────────────────────────────────

interface PositionEntry {
  lat: number
  lng: number
  ts: number
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const INITIAL_SNAPSHOT: MovementSnapshot = {
  state: 'unknown',
  speedMs: 0,
  speedMph: 0,
  headingDeg: 0,
  hasHeading: false,
  lastUpdateMs: 0,
}

export function useMovementEngine(): MovementSnapshot {
  const { userLocation } = usePanelData()

  const historyRef = useRef<PositionEntry[]>([])
  const speedRef = useRef(0)
  const headingRef = useRef(0)
  const lastKnownMsRef = useRef(0)

  const [snapshot, setSnapshot] = useState<MovementSnapshot>(INITIAL_SNAPSHOT)

  useEffect(() => {
    if (!userLocation) return

    const now = Date.now()
    const { lat, lng } = userLocation
    lastKnownMsRef.current = now

    const history = historyRef.current
    const cutoff = now - STALE_ENTRY_MS

    // Prune stale entries
    const fresh = history.filter((e) => e.ts >= cutoff)

    if (fresh.length > 0) {
      const prev = fresh[fresh.length - 1]

      // Guard: must be same position (skip GPS dedup artifacts)
      if (prev.lat === lat && prev.lng === lng) {
        // Same position — speed decays toward zero
        speedRef.current = linearEma(speedRef.current, 0, 0.08)
      } else {
        const dist = haversineMeters(prev.lat, prev.lng, lat, lng)
        const dt = now - prev.ts

        if (dt >= MIN_DELTA_MS && dt <= MAX_DELTA_MS) {
          const rawSpeed = dist / (dt / 1000)
          speedRef.current = linearEma(speedRef.current, rawSpeed, ALPHA_SPEED)

          if (dist >= MIN_DISPLACEMENT_FOR_HEADING_M) {
            const rawBearing = bearingDeg(prev.lat, prev.lng, lat, lng)
            headingRef.current = circularEma(headingRef.current, rawBearing, ALPHA_HEADING)
          }
        } else if (dt > MAX_DELTA_MS) {
          // Long gap (background resume) — reset speed, keep heading
          speedRef.current = 0
        }
      }
    }

    // Maintain capped history
    fresh.push({ lat, lng, ts: now })
    if (fresh.length > HISTORY_SIZE) fresh.shift()
    historyRef.current = fresh

    // Classify movement state
    const speed = speedRef.current
    let state: MovementState
    if (speed < THRESHOLD_STATIONARY) {
      state = 'stationary'
    } else if (speed < THRESHOLD_FAST) {
      state = 'moving_slow'
    } else {
      state = 'moving_fast'
    }

    const hasHeading = speed >= THRESHOLD_STATIONARY * 1.5

    setSnapshot({
      state,
      speedMs: Math.max(0, speed),
      speedMph: Math.max(0, speed * 2.237),
      headingDeg: Math.round(headingRef.current),
      hasHeading,
      lastUpdateMs: now,
    })
  }, [userLocation?.lat, userLocation?.lng])

  useEffect(() => {
    setFieldNavigationActive(
      snapshot.state === 'moving_slow' || snapshot.state === 'moving_fast',
    )
  }, [snapshot.state])

  return snapshot
}

// ─── Distance utilities (re-exported for proximity consumers) ─────────────────

export { haversineMeters, bearingDeg }
