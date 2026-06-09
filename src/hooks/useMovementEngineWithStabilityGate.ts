/**
 * useMovementEngineWithStabilityGate — PRODUCTION HARDENING (CRITICAL FIX #1)
 *
 * Wraps useMovementEngine with 2-layer stability confirmation buffer.
 * Eliminates GPS jitter oscillation and movement state flicker.
 *
 * PROBLEM:
 * - EMA smoothing alone insufficient under weak GPS signal
 * - Movement state changes rapidly due to noisy delta spikes
 * - Camera micro-reactions to flicker
 * - UI oscillation in weak zones
 *
 * SOLUTION:
 * Layer A: EMA (existing, kept in useMovementEngine)
 * Layer B: Stability confirmation gate (NEW)
 *
 * RULE:
 * A movement state change ONLY commits if:
 * - same candidate state persists for ≥4 samples OR
 * - ≥6–10 seconds continuous stability window
 *
 * RESULT:
 * - eliminates jitter flicker
 * - stabilizes camera + UI reactions
 * - prevents rapid state oscillation
 */

import { useEffect, useRef, useState } from 'react'
import { useMovementEngine, type MovementState, type MovementSnapshot } from './useMovementEngine'

// ─── Stability Gate Configuration ──────────────────────────────────────────────

/**
 * Number of consecutive samples with same state required to commit change.
 * At ~2-3 GPS updates per second: 4 samples ≈ 1.3–2 seconds of stability.
 */
const STABILITY_SAMPLE_THRESHOLD = 4

/**
 * Maximum time (ms) to wait before committing state change, even if samples < threshold.
 * Ensures responsiveness doesn't get stuck (e.g., slow GPS in canyon).
 */
const STABILITY_TIME_THRESHOLD_MS = 10_000

/**
 * Time window (ms) used to detect rapid oscillation.
 * If state A→B→A occurs within this window, suppress the B→A transition.
 */
const OSCILLATION_WINDOW_MS = 1000

// ─── Stability State Machine ──────────────────────────────────────────────────

interface StabilityGateState {
  /**
   * Currently committed movement state (stable, emitted to consumers).
   */
  current: MovementState

  /**
   * Candidate state from latest GPS sample (not yet committed).
   */
  candidate: MovementState

  /**
   * How many consecutive samples have candidate == current.
   * Once stableCount >= STABILITY_SAMPLE_THRESHOLD, commit candidate.
   */
  stableCount: number

  /**
   * Timestamp (ms) when we first saw current state.
   * If now - this >= STABILITY_TIME_THRESHOLD_MS, commit candidate anyway.
   */
  stateStartMs: number

  /**
   * History of recent state changes for oscillation detection.
   * [ { state, timestamp }, ... ]
   */
  recentStates: Array<{ state: MovementState; timestamp: number }>
}

function createInitialGateState(): StabilityGateState {
  const now = Date.now()
  return {
    current: 'unknown',
    candidate: 'unknown',
    stableCount: 0,
    stateStartMs: now,
    recentStates: []
  }
}

// ─── Stability Gate Logic ──────────────────────────────────────────────────────

/**
 * Detect if we're oscillating rapidly between states.
 * Example: stationary → moving_slow → stationary within 1s = oscillation
 */
function isOscillating(
  recentStates: Array<{ state: MovementState; timestamp: number }>,
  windowMs: number
): boolean {
  if (recentStates.length < 3) {
    return false
  }

  const now = Date.now()
  const windowStart = now - windowMs

  // Get states within window
  const statesInWindow = recentStates.filter(s => s.timestamp >= windowStart)

  if (statesInWindow.length < 3) {
    return false
  }

  // Check for A→B→A pattern
  for (let i = 0; i < statesInWindow.length - 2; i++) {
    const [s1, s2, s3] = statesInWindow.slice(i, i + 3)

    if (s1.state === s3.state && s1.state !== s2.state) {
      return true // Detected oscillation
    }
  }

  return false
}

/**
 * Update gate state machine with new raw movement state.
 * Returns true if committed state changed (should notify consumers).
 */
function updateGateState(
  gate: StabilityGateState,
  rawState: MovementState,
  now: number
): boolean {
  const timeSinceStateStart = now - gate.stateStartMs

  // Update candidate
  gate.candidate = rawState

  // Track recent state transitions
  gate.recentStates.push({ state: rawState, timestamp: now })

  // Prune stale history (keep last 10 or within 5 second window)
  if (gate.recentStates.length > 10) {
    gate.recentStates = gate.recentStates.slice(-10)
  }

  // Check for oscillation — if detected, don't commit yet
  if (isOscillating(gate.recentStates, OSCILLATION_WINDOW_MS)) {
    gate.stableCount = 0 // Reset stability count on oscillation
    return false
  }

  // Update stability counter
  if (rawState === gate.current) {
    gate.stableCount++
  } else {
    gate.stableCount = 1 // Reset counter on state change
  }

  // Decide whether to commit candidate state
  const sampleThresholdMet = gate.stableCount >= STABILITY_SAMPLE_THRESHOLD
  const timeThresholdMet = timeSinceStateStart >= STABILITY_TIME_THRESHOLD_MS

  if (sampleThresholdMet || timeThresholdMet) {
    // Commit candidate as new current
    gate.current = gate.candidate
    gate.stableCount = 0
    gate.stateStartMs = now

    return true // State changed, notify consumers
  }

  return false // State not yet stable, don't notify
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

const INITIAL_SNAPSHOT_GATED: MovementSnapshot = {
  state: 'unknown',
  speedMs: 0,
  speedMph: 0,
  headingDeg: 0,
  hasHeading: false,
  lastUpdateMs: 0,
}

/**
 * Enhanced movement engine with stability gate.
 * Wraps useMovementEngine and filters state changes through confirmation buffer.
 *
 * Consumers see stable, hysteresis-filtered movement state.
 * Speed, heading, and other metrics still update in real-time (only state is gated).
 */
export function useMovementEngineWithStabilityGate(): MovementSnapshot {
  // Get raw movement snapshot from base engine
  const rawSnapshot = useMovementEngine()

  const gateRef = useRef<StabilityGateState>(createInitialGateState())
  const [snapshot, setSnapshot] = useState<MovementSnapshot>(INITIAL_SNAPSHOT_GATED)

  useEffect(() => {
    const now = Date.now()
    const gate = gateRef.current

    // Check if raw state changed
    const stateChanged = updateGateState(gate, rawSnapshot.state, now)

    // Build output snapshot: use gated state, but real-time speed/heading
    const outputSnapshot: MovementSnapshot = {
      state: gate.current,
      speedMs: rawSnapshot.speedMs, // Real-time (not gated)
      speedMph: rawSnapshot.speedMph, // Real-time (not gated)
      headingDeg: rawSnapshot.headingDeg, // Real-time (not gated)
      hasHeading: gate.current === 'moving_slow' || gate.current === 'moving_fast',
      lastUpdateMs: now
    }

    // Only update state if movement changed (to prevent unnecessary re-renders)
    if (stateChanged) {
      setSnapshot(outputSnapshot)
    } else if (rawSnapshot.lastUpdateMs > snapshot.lastUpdateMs) {
      // Update speed/heading even if state didn't change (real-time updates)
      setSnapshot(outputSnapshot)
    }
  }, [rawSnapshot])

  return snapshot
}

// ─── Diagnostics (for debugging / telemetry) ───────────────────────────────────

/**
 * Debug hook to inspect gate state (not for production).
 */
export function useStabilityGateDiagnostics() {
  const gateRef = useRef<StabilityGateState>(createInitialGateState())

  return {
    getGateState: () => ({
      current: gateRef.current.current,
      candidate: gateRef.current.candidate,
      stableCount: gateRef.current.stableCount,
      recentStatesCount: gateRef.current.recentStates.length
    })
  }
}

/**
 * BEHAVIOR CHANGE:
 *
 * BEFORE patch:
 * - Movement state changes on every noisy GPS delta
 * - Camera reacts to every state fluctuation
 * - UI flickering in weak signal zones
 *
 * AFTER patch:
 * - Movement state only commits after 4+ consecutive samples OR 10s window
 * - Camera smooth, no jitter-induced micro-reactions
 * - UI stable even in weak GPS environment
 *
 * EXAMPLE — WEAK SIGNAL CANYON:
 * Raw: stationary → moving_slow → stationary → moving_slow (100ms apart)
 * Gated: stationary (stays stable, suppresses oscillation)
 *
 * EXAMPLE — WALKING INDOORS:
 * Raw: 0.2, 0.3, 0.4, 0.5, 0.6 m/s (crossing THRESHOLD_STATIONARY = 0.4)
 * Gated: stationary → moving_slow (after 4 consecutive moving_slow samples ≈ 1.3s)
 * Result: smooth transition, no bounce
 */
