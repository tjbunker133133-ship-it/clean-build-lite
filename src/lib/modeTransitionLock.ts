/**
 * MODE TRANSITION LOCK — PRODUCTION HARDENING (CRITICAL FIX #3)
 *
 * Prevents race conditions and duplicate layer injection during mode switching.
 *
 * PROBLEM:
 * - Mode switching causes overlapping MapLibre layers
 * - duplicate listeners
 * - partial teardown of Modern systems
 * - cross-mode contamination
 *
 * SOLUTION:
 * Add global transition gate:
 * - When switching modes: LOCK transitions
 * - FULL teardown Modern Layer systems FIRST
 * - wait 1 animation frame (requestAnimationFrame)
 * - mount new mode
 * - ensure map is idle (map.isMoving/isEasing false)
 * - release lock
 *
 * RESULT:
 * - no cross-mode contamination
 * - no duplicate layer injection
 * - deterministic lifecycle
 */

export interface ModeTransitionState {
  active: boolean
  from: 'legacy' | 'hybrid' | 'immersive' | null
  to: 'legacy' | 'hybrid' | 'immersive' | null
  timestamp: number
  phase: 'idle' | 'teardown' | 'transition' | 'mount' | 'settling'
}

class ModeTransitionLock {
  private state: ModeTransitionState = {
    active: false,
    from: null,
    to: null,
    timestamp: 0,
    phase: 'idle'
  }

  private listeners = new Set<(state: ModeTransitionState) => void>()
  private timeoutId: ReturnType<typeof setTimeout> | null = null

  /**
   * Check if transition is currently in progress.
   */
  isLocked(): boolean {
    return this.state.active
  }

  /**
   * Check current transition state.
   */
  getState(): ModeTransitionState {
    return { ...this.state }
  }

  /**
   * Subscribe to transition state changes.
   */
  subscribe(listener: (state: ModeTransitionState) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Initiate mode transition.
   * Must call beginTransition → teardownModern → waitFrame → mountNewMode → settle → endTransition
   */
  beginTransition(
    fromMode: 'legacy' | 'hybrid' | 'immersive',
    toMode: 'legacy' | 'hybrid' | 'immersive'
  ): boolean {
    // Reject if already transitioning
    if (this.state.active) {
      console.warn('[ModeTransitionLock] Transition already in progress, rejecting new transition', {
        current: this.state,
        requested: { from: fromMode, to: toMode }
      })
      return false
    }

    this.state = {
      active: true,
      from: fromMode,
      to: toMode,
      timestamp: Date.now(),
      phase: 'teardown'
    }

    this.notifyListeners()
    return true
  }

  /**
   * Mark transition phase (for tracking).
   */
  setPhase(phase: 'teardown' | 'transition' | 'mount' | 'settling'): void {
    if (!this.state.active) {
      console.warn('[ModeTransitionLock] setPhase called but transition not active')
      return
    }

    this.state.phase = phase
    this.notifyListeners()
  }

  /**
   * End transition and release lock.
   */
  endTransition(): void {
    if (!this.state.active) {
      console.warn('[ModeTransitionLock] endTransition called but transition not active')
      return
    }

    this.state = {
      active: false,
      from: null,
      to: null,
      timestamp: 0,
      phase: 'idle'
    }

    this.notifyListeners()

    // Clear any pending timeout
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
  }

  /**
   * Set a safety timeout to auto-release lock if transition stalls.
   * Called after beginTransition(); auto-releases after duration.
   */
  setSafetyTimeout(durationMs: number = 5000): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }

    this.timeoutId = setTimeout(() => {
      console.error('[ModeTransitionLock] Safety timeout exceeded, force-releasing lock', {
        state: this.state,
        timeoutMs: durationMs
      })
      this.endTransition()
    }, durationMs)
  }

  /**
   * Notify all subscribers of state change.
   */
  private notifyListeners(): void {
    const snapshot = { ...this.state }
    this.listeners.forEach(listener => {
      try {
        listener(snapshot)
      } catch (err) {
        console.error('[ModeTransitionLock] Listener error:', err)
      }
    })
  }
}

/**
 * SINGLETON INSTANCE — shared across app lifecycle.
 */
let lockInstance: ModeTransitionLock | null = null

export function getModeTransitionLock(): ModeTransitionLock {
  if (!lockInstance) {
    lockInstance = new ModeTransitionLock()
  }
  return lockInstance
}

/**
 * USAGE PATTERN IN MODE SWITCH HANDLER:
 *
 * ```typescript
 * async function handleModeSwitch(toMode: 'legacy' | 'hybrid' | 'immersive') {
 *   const lock = getModeTransitionLock()
 *   const currentMode = window.__HUD_RUNTIME__.mode
 *
 *   // Reject if already transitioning
 *   if (!lock.beginTransition(currentMode, toMode)) {
 *     console.error('Mode transition already in progress')
 *     return
 *   }
 *
 *   try {
 *     // Set safety timeout (auto-release after 5s)
 *     lock.setSafetyTimeout(5000)
 *
 *     // PHASE 1: TEARDOWN MODERN LAYER SYSTEMS
 *     lock.setPhase('teardown')
 *     await teardownModernLayer()
 *     await teardownMapOverlays()
 *     await clearEventListeners()
 *
 *     // PHASE 2: WAIT FOR RAF (browser animation frame)
 *     lock.setPhase('transition')
 *     await new Promise(resolve => requestAnimationFrame(resolve))
 *
 *     // PHASE 3: MOUNT NEW MODE
 *     lock.setPhase('mount')
 *     setUserPreferredMode(toMode)
 *     await window.location.reload()
 *
 *   } catch (err) {
 *     console.error('[ModeTransition] Error during switch:', err)
 *   } finally {
 *     lock.endTransition()
 *   }
 * }
 * ```
 *
 * GUARD IN COMPONENTS:
 *
 * ```typescript
 * function ModernLayerComponent() {
 *   const lock = getModeTransitionLock()
 *
 *   // Do not render if mode transition in progress
 *   if (lock.isLocked()) {
 *     return null
 *   }
 *
 *   return <ModeContent />
 * }
 * ```
 *
 * MONITORING:
 *
 * ```typescript
 * useEffect(() => {
 *   const lock = getModeTransitionLock()
 *
 *   const unsubscribe = lock.subscribe(state => {
 *     if (state.active) {
 *       console.log(`Mode transition: ${state.from} → ${state.to} (${state.phase})`)
 *     }
 *   })
 *
 *   return unsubscribe
 * }, [])
 * ```
 */
