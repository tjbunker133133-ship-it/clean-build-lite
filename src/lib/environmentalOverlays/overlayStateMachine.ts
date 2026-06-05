/**
 * Overlay State Machine - Strict Enforcement
 *
 * Guarantees:
 * - LOADING always resolves to terminal state within 30s
 * - No stuck 'syncing' or 'loading' states
 * - Explicit state transitions with logging
 * - All async paths have finally() equivalent
 */

import type { EnvironmentalOverlayId, OverlayStateMachine } from './types'
import { logInfo, logWarn } from '../../runtime/logger'

const OVERLAY_TIMEOUT_MS = 30_000

// Session tracking for race condition prevention
type SessionId = string
export type TerminalState =
  | { state: 'READY'; enabled: true; featureCount: number }
  | { state: 'EMPTY'; enabled: true; message: string }
  | { state: 'ERROR'; enabled: boolean; error: string }
  | { state: 'OFFLINE_FALLBACK'; enabled: true; cachedAt: number; message?: string }
  | { state: 'IDLE'; enabled: boolean }

// Track active loading operations for timeout enforcement
type LoadingEntry = {
  id: EnvironmentalOverlayId
  startedAt: number
  timeoutId: number
  sessionId: SessionId
  onResolve: (state: TerminalState) => void
}

const loadingMap = new Map<EnvironmentalOverlayId, LoadingEntry>()
const activeSessions = new Map<EnvironmentalOverlayId, SessionId>()

/**
 * Generate unique session ID for overlay activation.
 * Prevents stale async results from overwriting current state.
 */
export function createOverlaySession(id: EnvironmentalOverlayId): SessionId {
  const sessionId = `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  activeSessions.set(id, sessionId)
  return sessionId
}

/**
 * Check if session is still active for this overlay.
 * Use before applying any async result to prevent race conditions.
 */
export function isSessionActive(id: EnvironmentalOverlayId, sessionId: SessionId): boolean {
  return activeSessions.get(id) === sessionId
}

/**
 * Clear active session for overlay (called on disable/unmount).
 */
export function clearOverlaySession(id: EnvironmentalOverlayId): void {
  activeSessions.delete(id)
}

/**
 * Resolve overlay to terminal state with session validation.
 * This is the ONLY path for state transitions - all async results MUST use this.
 */
export function resolveOverlay(
  id: EnvironmentalOverlayId,
  sessionId: SessionId,
  state: TerminalState,
): void {
  // Validate session - reject stale results
  if (!isSessionActive(id, sessionId)) {
    logWarn('OVERLAY', `${id}: Stale session ${sessionId.slice(0, 12)}... ignored`)
    return
  }

  const entry = loadingMap.get(id)
  if (entry?.sessionId === sessionId) {
    clearLoadingTimeout(id)
  }

  // Log transition
  switch (state.state) {
    case 'READY':
      logInfo('OVERLAY', `${id} → READY (${state.featureCount} features) [session: ${sessionId.slice(0, 8)}]`)
      break
    case 'EMPTY':
      logInfo('OVERLAY', `${id} → EMPTY: ${state.message} [session: ${sessionId.slice(0, 8)}]`)
      break
    case 'ERROR':
      logWarn('OVERLAY', `${id} → ERROR: ${state.error.slice(0, 100)} [session: ${sessionId.slice(0, 8)}]`)
      break
    case 'OFFLINE_FALLBACK':
      logInfo('OVERLAY', `${id} → OFFLINE_FALLBACK (cached ${new Date(state.cachedAt).toISOString()}) [session: ${sessionId.slice(0, 8)}]`)
      break
    case 'IDLE':
      logInfo('OVERLAY', `${id} → IDLE [session: ${sessionId.slice(0, 8)}]`)
      break
  }

  // Call the stored resolver (this updates React state)
  entry?.onResolve(state)
}

/**
 * Start loading state with automatic timeout enforcement.
 * If not resolved within 30s, forces ERROR state via onResolve callback.
 */
export function startLoading(
  id: EnvironmentalOverlayId,
  sessionId: SessionId,
  onResolve: (state: TerminalState) => void,
): Extract<OverlayStateMachine, { state: 'LOADING' }> {
  // Clear any existing timeout and session
  clearLoadingTimeout(id)

  const entry: LoadingEntry = {
    id,
    startedAt: Date.now(),
    timeoutId: window.setTimeout(() => {
      // Timeout MUST transition to terminal state via onResolve
      logWarn('OVERLAY', `Loading timeout forced for ${id} [session: ${sessionId.slice(0, 8)}]`)
      if (isSessionActive(id, sessionId)) {
        onResolve({ state: 'ERROR', enabled: true, error: 'Loading timeout — try again or check network' })
      }
    }, OVERLAY_TIMEOUT_MS),
    sessionId,
    onResolve,
  }

  loadingMap.set(id, entry)

  return { state: 'LOADING', enabled: true, startedAt: entry.startedAt }
}

/**
 * Resolve loading to READY state.
 */
export function resolveReady(
  id: EnvironmentalOverlayId,
  featureCount: number,
): Extract<OverlayStateMachine, { state: 'READY' }> {
  clearLoadingTimeout(id)
  logInfo('OVERLAY', `${id} → READY (${featureCount} features)`)
  return { state: 'READY', enabled: true, featureCount }
}

/**
 * Resolve loading to EMPTY state (no features).
 */
export function resolveEmpty(
  id: EnvironmentalOverlayId,
  message: string,
): Extract<OverlayStateMachine, { state: 'EMPTY' }> {
  clearLoadingTimeout(id)
  logInfo('OVERLAY', `${id} → EMPTY: ${message}`)
  return { state: 'EMPTY', enabled: true, message }
}

/**
 * Resolve loading to ERROR state.
 */
export function resolveError(
  id: EnvironmentalOverlayId,
  error: string,
  enabled = true,
): Extract<OverlayStateMachine, { state: 'ERROR' }> {
  clearLoadingTimeout(id)
  logWarn('OVERLAY', `${id} → ERROR: ${error.slice(0, 100)}`)
  return { state: 'ERROR', enabled, error }
}

/**
 * Resolve loading to OFFLINE_FALLBACK state (cached data).
 */
export function resolveOfflineFallback(
  id: EnvironmentalOverlayId,
  cachedAt: number,
  message?: string,
): Extract<OverlayStateMachine, { state: 'OFFLINE_FALLBACK' }> {
  clearLoadingTimeout(id)
  logInfo('OVERLAY', `${id} → OFFLINE_FALLBACK (cached ${new Date(cachedAt).toISOString()})`)
  return { state: 'OFFLINE_FALLBACK', enabled: true, cachedAt, message }
}

/**
 * Transition to IDLE state (disabled).
 */
export function toIdle(enabled = false): Extract<OverlayStateMachine, { state: 'IDLE' }> {
  return { state: 'IDLE', enabled }
}

/**
 * Clear any pending timeout for an overlay.
 */
export function clearLoadingTimeout(id: EnvironmentalOverlayId): void {
  const entry = loadingMap.get(id)
  if (entry) {
    window.clearTimeout(entry.timeoutId)
    loadingMap.delete(id)
  }
}

/**
 * Force state resolution for cancel or emergency cases.
 * Always emits a terminal state.
 */
export function forceResolveState(
  id: EnvironmentalOverlayId,
  sessionId: SessionId,
  state: TerminalState,
): void {
  resolveOverlay(id, sessionId, state)
}


/**
 * Check if an overlay is currently in LOADING state.
 */
export function isLoading(id: EnvironmentalOverlayId): boolean {
  return loadingMap.has(id)
}

/**
 * Get loading duration for diagnostics.
 */
export function getLoadingDuration(id: EnvironmentalOverlayId): number | null {
  const entry = loadingMap.get(id)
  if (!entry) return null
  return Date.now() - entry.startedAt
}

/**
 * Convert state machine to legacy runtime status (for backward compatibility).
 */
export function stateMachineToLegacy(status: OverlayStateMachine): {
  enabled: boolean
  loading: boolean
  error: string | null
  stale: boolean
  fromCache: boolean
} {
  switch (status.state) {
    case 'IDLE':
      return { enabled: status.enabled, loading: false, error: null, stale: false, fromCache: false }
    case 'LOADING':
      return { enabled: true, loading: true, error: null, stale: false, fromCache: false }
    case 'READY':
      return { enabled: true, loading: false, error: null, stale: false, fromCache: false }
    case 'EMPTY':
      return { enabled: true, loading: false, error: status.message, stale: false, fromCache: false }
    case 'ERROR':
      return { enabled: status.enabled, loading: false, error: status.error, stale: false, fromCache: false }
    case 'OFFLINE_FALLBACK':
      return {
        enabled: true,
        loading: false,
        error: status.message ?? null,
        stale: true,
        fromCache: true,
      }
  }
}

/**
 * Async wrapper that enforces state machine transitions.
 * Guarantees loading always resolves to terminal state.
 */
export async function withStateMachine<T>(
  id: EnvironmentalOverlayId,
  operation: () => Promise<T>,
  onSuccess: (result: T) => OverlayStateMachine,
  onError: (error: unknown) => OverlayStateMachine,
): Promise<OverlayStateMachine> {
  try {
    const result = await operation()
    return onSuccess(result)
  } catch (err) {
    return onError(err)
  }
}
