/**
 * RESUME RECONCILIATION ENGINE — PRODUCTION HARDENING (CRITICAL FIX #2)
 *
 * Handles Android background/resume gracefully without state corruption.
 *
 * PROBLEM:
 * - Android kills GPS updates / timers while app is backgrounded
 * - On resume: stale GPS delta spikes, movement state jumps, camera re-engages incorrectly
 * - Result: glitch bursts, phantom movement detected
 *
 * SOLUTION:
 * Defer all reactions until next fresh GPS tick after resume.
 *
 * RULE (OPTION B — DEFERRED RECONCILIATION):
 * ON visibilitychange === "visible":
 *   - DO NOT trigger camera updates
 *   - DO NOT recompute movement state
 *   - DO NOT update UI reactions
 *   - SET: resume_pending = true
 *
 * ONLY when next valid GPS tick arrives:
 *   - perform full reconciliation once
 *   - clear resume_pending flag
 *
 * RESULT:
 * - eliminates phantom movement bursts
 * - avoids stale GPS fetch issues
 * - ensures deterministic recovery
 */

/**
 * Resume reconciliation state.
 */
export interface ResumeReconciliationState {
  isPending: boolean
  resumedAtMs: number | null
  lastGpsTickMs: number | null
  postResumeGpsTickMs: number | null
}

class ResumeReconciliationEngine {
  private state: ResumeReconciliationState = {
    isPending: false,
    resumedAtMs: null,
    lastGpsTickMs: null,
    postResumeGpsTickMs: null
  }

  private listeners = new Set<(state: ResumeReconciliationState) => void>()

  /**
   * Check if resume reconciliation is pending.
   * Consumers should defer reactions while pending.
   */
  isPending(): boolean {
    return this.state.isPending
  }

  /**
   * Get reconciliation state snapshot.
   */
  getState(): ResumeReconciliationState {
    return { ...this.state }
  }

  /**
   * Subscribe to state changes.
   */
  subscribe(listener: (state: ResumeReconciliationState) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Signal that app has resumed (became visible).
   * Called by visibilitychange listener.
   */
  onResume(now: number = Date.now()): void {
    this.state.isPending = true
    this.state.resumedAtMs = now
    this.state.postResumeGpsTickMs = null

    this.notifyListeners()
  }

  /**
   * Signal that a fresh GPS tick has arrived after resume.
   * Clears pending flag to allow normal operation.
   */
  onPostResumeGpsTick(now: number = Date.now()): void {
    if (!this.state.isPending) {
      return // Not pending, ignore
    }

    // This is the first GPS tick after resume — reconciliation complete
    this.state.postResumeGpsTickMs = now
    this.state.isPending = false

    this.notifyListeners()
  }

  /**
   * Update last GPS tick time (call on every GPS update).
   */
  onGpsTick(now: number = Date.now()): void {
    this.state.lastGpsTickMs = now
  }

  /**
   * Get time elapsed since resume (ms).
   */
  getTimeSinceResume(now: number = Date.now()): number {
    if (!this.state.resumedAtMs) {
      return 0
    }
    return now - this.state.resumedAtMs
  }

  /**
   * Get time elapsed since post-resume GPS tick (ms).
   */
  getTimeSincePostResumeGps(now: number = Date.now()): number {
    if (!this.state.postResumeGpsTickMs) {
      return 0
    }
    return now - this.state.postResumeGpsTickMs
  }

  /**
   * Force cancel pending reconciliation (e.g., if no GPS for 30s).
   */
  cancel(): void {
    if (this.state.isPending) {
      console.warn('[ResumeReconciliationEngine] Reconciliation cancelled (timeout or error)')
      this.state.isPending = false
      this.notifyListeners()
    }
  }

  /**
   * Notify all subscribers.
   */
  private notifyListeners(): void {
    const snapshot = { ...this.state }
    this.listeners.forEach(listener => {
      try {
        listener(snapshot)
      } catch (err) {
        console.error('[ResumeReconciliationEngine] Listener error:', err)
      }
    })
  }
}

/**
 * SINGLETON INSTANCE — shared across app lifecycle.
 */
let engineInstance: ResumeReconciliationEngine | null = null

export function getResumeReconciliationEngine(): ResumeReconciliationEngine {
  if (!engineInstance) {
    engineInstance = new ResumeReconciliationEngine()
  }
  return engineInstance
}

/**
 * SETUP PATTERN — Hook into visibility change:
 *
 * ```typescript
 * // In MapCanvas.tsx or App.tsx root component:
 * useEffect(() => {
 *   const engine = getResumeReconciliationEngine()
 *
 *   const onVisibilityChange = () => {
 *     if (document.visibilityState === 'visible') {
 *       console.log('[Resume] App visible, starting reconciliation')
 *       engine.onResume()
 *     }
 *   }
 *
 *   const onPageShow = () => {
 *     console.log('[Resume] pageshow event')
 *     engine.onResume()
 *   }
 *
 *   document.addEventListener('visibilitychange', onVisibilityChange)
 *   window.addEventListener('pageshow', onPageShow)
 *
 *   return () => {
 *     document.removeEventListener('visibilitychange', onVisibilityChange)
 *     window.removeEventListener('pageshow', onPageShow)
 *   }
 * }, [])
 * ```
 *
 * GPS UPDATE PATTERN — Call after each GPS update:
 *
 * ```typescript
 * // In useGPS or PanelDataContext GPS update handler:
 * const engine = getResumeReconciliationEngine()
 *
 * // Always track GPS tick
 * engine.onGpsTick()
 *
 * // If we were pending reconciliation, this clears it
 * if (engine.isPending()) {
 *   engine.onPostResumeGpsTick()
 * }
 *
 * // Now safe to update movement state, camera, etc.
 * updateMovementState()
 * ```
 *
 * CONSUMER PATTERN — Defer reactions while pending:
 *
 * ```typescript
 * // In ModernCameraController or any reaction component:
 * function ModernCameraController() {
 *   const engine = getResumeReconciliationEngine()
 *   const [isPending, setIsPending] = useState(false)
 *
 *   useEffect(() => {
 *     const unsubscribe = engine.subscribe(state => {
 *       setIsPending(state.isPending)
 *     })
 *     return unsubscribe
 *   }, [])
 *
 *   useEffect(() => {
 *     // Do NOT update camera if reconciliation pending
 *     if (isPending) {
 *       return
 *     }
 *
 *     // Safe to react to movement changes
 *     map.easeTo({ zoom: nextZoom })
 *
 *   }, [movement, isPending])
 * }
 * ```
 *
 * OPTIONAL: Cancel pending reconciliation on timeout:
 *
 * ```typescript
 * // Safety net: if no GPS for 30s post-resume, cancel pending state
 * useEffect(() => {
 *   if (!engine.isPending()) return
 *
 *   const timeoutId = setTimeout(() => {
 *     console.warn('[Resume] No GPS after 30s, cancelling reconciliation')
 *     engine.cancel()
 *   }, 30_000)
 *
 *   return () => clearTimeout(timeoutId)
 * }, [engine.isPending()])
 * ```
 *
 * BEHAVIOR COMPARISON:
 *
 * BEFORE patch:
 * Resume → immediate camera/state updates → glitch burst
 *
 * AFTER patch:
 * Resume → defer reactions (pending=true)
 *         → wait for first GPS tick
 *         → reconcile once (pending=false)
 *         → smooth normal operation
 *
 * EXAMPLE SCENARIO:
 * [00:00] User backgrounded app (running indoors, weak GPS)
 * [00:05] User resumes app
 *         → onResume() called, isPending = true
 *         → camera/state frozen
 * [00:05.5] GPS tick arrives (stale: 5s old position)
 *         → onPostResumeGpsTick() called, isPending = false
 *         → camera can now react (but to fresh data only)
 *         → smooth re-engagement
 *
 * Result: No phantom movement burst, deterministic recovery
 */
