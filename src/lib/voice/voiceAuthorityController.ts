/**
 * Voice Authority Controller — Priority-based TTS orchestration layer.
 *
 * SINGLE RESPONSIBILITY: Ensure only one voice output stream is active,
 * with deterministic priority-based preemption.
 *
 * CONSTRAINTS:
 * - No UI dependencies
 * - No business logic
 * - Pure orchestration layer only
 * - Synchronous state, async speech handling
 */

import { logInfo, logWarn } from '../../runtime/logger'
import { traceTTS } from '../../runtime/runtimeForensics'
import {
  debugConfig,
  instrumentedCancel,
} from '../../runtime/voiceRegressionDebug'
const LOG_CAT = 'VOICE' as const

// ============================================================================
// PRIORITY DEFINITIONS (HIGHEST to LOWEST)
// ============================================================================

export const VOICE_PRIORITY = {
  /** SAFETY: Immediate, non-negotiable, interrupts everything */
  SAFETY: 100,
  /** USER COMMAND RESULT: Direct user action feedback */
  USER_COMMAND: 80,
  /** SYSTEM FEEDBACK: Status, confirmations */
  SYSTEM_FEEDBACK: 60,
  /** ENVIRONMENT READOUT: Weather, fire, water briefs */
  ENVIRONMENT_READOUT: 40,
  /** HELP / GUIDANCE: Lowest priority, interruptible */
  HELP_GUIDANCE: 20,
} as const

export type VoicePriority = typeof VOICE_PRIORITY[keyof typeof VOICE_PRIORITY]

// ============================================================================
// STATE
// ============================================================================

type SpeechEntry = {
  id: string
  text: string
  priority: VoicePriority
  sourceId: string
  startedAt: number
  utterance?: SpeechSynthesisUtterance
}

type SpeechQueueEntry = {
  id: string
  text: string
  priority: VoicePriority
  sourceId: string
  queuedAt: number
}

let currentSpeech: SpeechEntry | null = null
let speechQueue: SpeechQueueEntry[] = []
let speechIdCounter = 0

// Stable timeout registry — no closure chaining, no function reassignment (C1 FIX)
const speechTimeouts = new Map<string, number>()

// Track last few speeches for "repeat last" command
const speechHistory: Array<{ text: string; priority: VoicePriority; sourceId: string; timestamp: number }> = []
const MAX_HISTORY = 5

// ============================================================================
// CALLBACKS
// ============================================================================

type SpeechStateCallback = (state: { speaking: boolean; text: string | null; priority: VoicePriority | null }) => void

const stateListeners = new Set<SpeechStateCallback>()

export function subscribeToSpeechState(cb: SpeechStateCallback): () => void {
  stateListeners.add(cb)
  // Immediate initial state
  cb({
    speaking: currentSpeech !== null,
    text: currentSpeech?.text ?? null,
    priority: currentSpeech?.priority ?? null,
  })
  return () => stateListeners.delete(cb)
}

function notifyStateChange(): void {
  const state = {
    speaking: currentSpeech !== null,
    text: currentSpeech?.text ?? null,
    priority: currentSpeech?.priority ?? null,
  }
  for (const cb of stateListeners) {
    try {
      cb(state)
    } catch {
      // Ignore callback errors
    }
  }
}

// ============================================================================
// CORE API
// ============================================================================

/**
 * Start speech with priority enforcement.
 * Higher priority interrupts lower priority immediately.
 * Lower/equal priority is dropped (not queued to prevent audio stacking).
 */
export function startSpeech(
  text: string,
  priority: VoicePriority,
  sourceId: string,
  onComplete?: () => void,
): { started: boolean; interrupted: boolean; reason?: string } {
  const trimmed = text.trim()
  traceTTS('speak_requested', { text: trimmed.slice(0, 60), priority, sourceId })

  if (!trimmed) {
    traceTTS('speak_rejected_empty', { sourceId })
    return { started: false, interrupted: false, reason: 'empty_text' }
  }

  // REGRESSION ISOLATION: SAFE MODE - raw SpeechSynthesis only
  if (debugConfig.voiceSafeMode) {
    traceTTS('safe_mode_raw_speak', { text: trimmed.slice(0, 60), sourceId })
    // MINIMAL PATH: new SpeechSynthesisUtterance -> speak() ONLY
    // No cancel, no priority, no handlers, no orchestration
    try {
      const synth = window.speechSynthesis
      const utterance = new SpeechSynthesisUtterance(trimmed)

      // Only the most minimal handlers for forensic capture
      utterance.onstart = () => traceTTS('safe_mode_utterance_onstart', { sourceId })
      utterance.onend = () => traceTTS('safe_mode_utterance_onend', { sourceId })
      utterance.onerror = (e) => traceTTS('safe_mode_utterance_onerror', { sourceId, error: e.error })

      synth.speak(utterance)
      traceTTS('safe_mode_speak_called', { sourceId })
      return { started: true, interrupted: false }
    } catch (err) {
      traceTTS('safe_mode_speak_threw', { sourceId, error: (err as Error).message })
      return { started: false, interrupted: false, reason: 'safe_mode_error' }
    }
  }

  // REGRESSION ISOLATION: Bypass authority controller when disabled (but still use executeTTS)
  if (debugConfig.disableVoiceAuthority) {
    traceTTS('authority_bypassed', { reason: 'authority_disabled', sourceId })
    // Direct execution without priority logic but still with executeTTS hygiene
    const now = Date.now()
    const speechId = `sp-bypass-${++speechIdCounter}-${now}`
    executeTTS(trimmed, speechId)
    return { started: true, interrupted: false }
  }

  const now = Date.now()
  const speechId = `sp-${++speechIdCounter}-${now}`

  // Store completion callback for this speech session
  if (onComplete) {
    speechCompleteCallbacks.set(speechId, onComplete)
  }

  // Check if we should interrupt or block
  if (currentSpeech !== null) {
    if (priority > currentSpeech.priority) {
      // Higher priority — interrupt
      logInfo(LOG_CAT, `Interrupting priority ${currentSpeech.priority} with priority ${priority}`, {
        current: currentSpeech.sourceId,
        incoming: sourceId,
      })
      traceTTS('interrupt_triggered', {
        newId: speechId,
        newPriority: priority,
        newSource: sourceId,
        currentPriority: currentSpeech.priority,
        currentSource: currentSpeech.sourceId,
      })
      performInterrupt(speechId, trimmed, priority, sourceId)
      return { started: true, interrupted: true }
    } else {
      // Equal or lower priority — drop (no queueing to prevent overlap)
      logInfo(LOG_CAT, `Dropping speech: priority ${priority} <= current ${currentSpeech.priority}`, {
        sourceId,
      })
      traceTTS('speak_rejected_priority', {
        priority,
        currentPriority: currentSpeech.priority,
        sourceId,
        currentSource: currentSpeech.sourceId,
      })
      // Clean up callback since speech won't start
      speechCompleteCallbacks.delete(speechId)
      return { started: false, interrupted: false, reason: 'priority_blocked' }
    }
  }

  // No current speech — start immediately
  beginSpeech(speechId, trimmed, priority, sourceId)
  return { started: true, interrupted: false }
}

// Store completion callbacks by speechId
const speechCompleteCallbacks = new Map<string, () => void>()

export function subscribeToSpeechComplete(speechId: string, callback: () => void): () => void {
  speechCompleteCallbacks.set(speechId, callback)
  return () => speechCompleteCallbacks.delete(speechId)
}

/**
 * Stop current speech immediately.
 */
export function stopSpeech(reason: string): boolean {
  if (!currentSpeech) {
    return false
  }

  const speechId = currentSpeech.id

  logInfo(LOG_CAT, `Stopping speech: ${reason}`, {
    speechId,
    sourceId: currentSpeech.sourceId,
    progressMs: Date.now() - currentSpeech.startedAt,
  })

  // C1 FIX: Clear registered timeout from Map (prevent orphaned timers)
  const timeoutId = speechTimeouts.get(speechId)
  if (timeoutId !== undefined) {
    window.clearTimeout(timeoutId)
    speechTimeouts.delete(speechId)
  }

  // Cancel browser TTS - INSTRUMENTED for regression isolation
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    instrumentedCancel(
      window.speechSynthesis,
      'stopSpeech',
      speechId,
      currentSpeech?.id
    )
  }

  // Don't invoke completion callback since this is an interruption
  speechCompleteCallbacks.delete(speechId)

  recordToHistory(currentSpeech.text, currentSpeech.priority, currentSpeech.sourceId)
  currentSpeech = null
  notifyStateChange()

  // Do NOT auto-play queue — explicit action required
  return true
}

/**
 * Interrupt speech with higher priority.
 * Convenience wrapper that enforces priority check.
 */
export function interruptSpeech(priority: VoicePriority, sourceId = 'interrupt'): boolean {
  if (!currentSpeech) {
    return false
  }

  if (priority <= currentSpeech.priority) {
    logWarn(LOG_CAT, `Interrupt rejected: priority ${priority} <= current ${currentSpeech.priority}`)
    return false
  }

  return stopSpeech(`priority_interrupt_${sourceId}`)
}

/**
 * Clear any queued speech and stop current.
 */
export function clearSpeechQueue(reason: string): void {
  const clearedCount = speechQueue.length
  speechQueue = []

  if (currentSpeech) {
    stopSpeech(reason)
  }

  logInfo(LOG_CAT, `Cleared queue (${clearedCount} items) + stopped current: ${reason}`)
}

/**
 * Check if currently speaking.
 */
export function isSpeaking(): boolean {
  return currentSpeech !== null
}

/**
 * Get current speech info.
 */
export function getCurrentSpeech(): { text: string; priority: VoicePriority; sourceId: string; durationMs: number } | null {
  if (!currentSpeech) return null
  return {
    text: currentSpeech.text,
    priority: currentSpeech.priority,
    sourceId: currentSpeech.sourceId,
    durationMs: Date.now() - currentSpeech.startedAt,
  }
}

/**
 * Get last N speeches from history (for "repeat last" command).
 */
export function getSpeechHistory(count = 1): Array<{ text: string; priority: VoicePriority; sourceId: string }> {
  return speechHistory.slice(-count).reverse()
}

/**
 * Repeat the most recent speech.
 */
export function repeatLastSpeech(): { success: boolean; text?: string; reason?: string } {
  const last = speechHistory[speechHistory.length - 1]
  if (!last) {
    return { success: false, reason: 'no_history' }
  }

  const result = startSpeech(last.text, last.priority, 'repeat-last')
  if (result.started) {
    return { success: true, text: last.text }
  }
  return { success: false, reason: result.reason }
}

// ============================================================================
// INTERNAL IMPLEMENTATION
// ============================================================================

function performInterrupt(
  newId: string,
  text: string,
  priority: VoicePriority,
  sourceId: string,
): void {
  // Record interrupted speech to history (partial) and clean up callback
  if (currentSpeech) {
    traceTTS('utterance_cancelled', {
      speechId: currentSpeech.id,
      interruptedBy: newId,
      partialText: currentSpeech.text.slice(0, 40),
    })
    // Don't invoke callback since this is an interruption
    speechCompleteCallbacks.delete(currentSpeech.id)
    recordToHistory(currentSpeech.text, currentSpeech.priority, currentSpeech.sourceId)
  }

  // Cancel current - INSTRUMENTED for regression isolation
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    instrumentedCancel(
      window.speechSynthesis,
      'performInterrupt',
      newId,
      currentSpeech?.id
    )
  }

  currentSpeech = null
  traceTTS('state_notified', { speaking: false, reason: 'interrupted' })

  // Start new speech
  beginSpeech(newId, text, priority, sourceId)
}

function beginSpeech(
  id: string,
  text: string,
  priority: VoicePriority,
  sourceId: string,
): void {
  currentSpeech = {
    id,
    text,
    priority,
    sourceId,
    startedAt: Date.now(),
  }

  traceTTS('utterance_created', { id, text: text.slice(0, 60), priority, sourceId })
  notifyStateChange()
  traceTTS('state_notified', { speaking: true, speechId: id })

  // Execute TTS
  executeTTS(text, id)
}

// C1 FIX: Stable cleanup function — no dynamic reassignment, no closure chain
function cleanupSpeech(speechId: string, completed = true): void {
  traceTTS('cleanup_speech', { speechId, currentSpeechId: currentSpeech?.id, completed })

  // Clear any pending timeout for this speechId (stable lookup, no closures)
  const timeoutId = speechTimeouts.get(speechId)
  if (timeoutId !== undefined) {
    window.clearTimeout(timeoutId)
    speechTimeouts.delete(speechId)
  }

  // Invoke completion callback if this was a natural completion (not interrupt)
  if (completed) {
    const callback = speechCompleteCallbacks.get(speechId)
    if (callback) {
      traceTTS('completion_callback_invoked', { speechId })
      try {
        callback()
      } catch (e) {
        logWarn(LOG_CAT, 'Speech completion callback threw', { error: (e as Error).message })
      }
      speechCompleteCallbacks.delete(speechId)
    }
  }

  if (!currentSpeech || currentSpeech.id !== speechId) {
    traceTTS('cleanup_speech_stale', { speechId, reason: 'already_changed' })
    return // Already changed or stale
  }

  const completedSpeech = currentSpeech
  recordToHistory(completedSpeech.text, completedSpeech.priority, completedSpeech.sourceId)
  currentSpeech = null
  notifyStateChange()
  traceTTS('state_notified', { speaking: false, reason: completed ? 'completed' : 'interrupted', completedSpeechId: speechId })
}

function executeTTS(text: string, speechId: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    logWarn(LOG_CAT, 'TTS not supported')
    traceTTS('synth_speak_threw', { reason: 'not_supported', speechId })
    cleanupSpeech(speechId)
    return
  }

  const synth = window.speechSynthesis

  // Log current synth state BEFORE any operations
  const stateBefore = {
    speaking: synth.speaking,
    pending: synth.pending,
    paused: synth.paused,
  }
  traceTTS('synth_state_before', {
    speechId,
    ...stateBefore,
  })

  // ANDROID/CHROME FIX: Check if audio is locked behind gesture requirement
  if (!stateBefore.speaking && stateBefore.pending) {
    traceTTS('synth_pending_true', { speechId, reason: 'previous_utterance_stuck' })
  }

  // CRITICAL FIX: Create utterance and set up handlers BEFORE any cancel/speak sequence
  // This ensures the utterance object is fully constructed before Android async operations
  const utterance = new SpeechSynthesisUtterance(text)
  traceTTS('utterance_created', { speechId, textLength: text.length })

  // Mobile-specific: Audio focus can be lost if recognition restarts during utterance setup
  let startupWindowOpen = true
  window.setTimeout(() => { startupWindowOpen = false }, 100)

  // Store reference for potential cancellation
  if (currentSpeech && currentSpeech.id === speechId) {
    currentSpeech.utterance = utterance
  }

  // C1 FIX: Use stable cleanup function, register timeout in Map (no closure chain)
  utterance.onend = () => {
    traceTTS('utterance_onend', { speechId, text: text.slice(0, 40), startupWindowClosed: !startupWindowOpen })
    cleanupSpeech(speechId, true) // true = completed naturally
  }
  utterance.onerror = (event) => {
    traceTTS('utterance_onerror', {
      speechId,
      error: event.error,
      text: text.slice(0, 40),
      charIndex: event.charIndex,
      startupWindowClosed: !startupWindowOpen,
    })
    cleanupSpeech(speechId, false) // false = error, don't invoke completion callback
  }
  utterance.onstart = () => {
    traceTTS('utterance_onstart', { speechId, text: text.slice(0, 40), startupWindowClosed: !startupWindowOpen })
    startupWindowOpen = false // Mark startup complete
  }

  // Safety timeout — force cleanup if events don't fire
  const safetyTimeout = window.setTimeout(() => {
    traceTTS('safety_timeout_fired', { speechId, text: text.slice(0, 40), startupWindowClosed: !startupWindowOpen })
    cleanupSpeech(speechId, false) // false = timeout, don't invoke completion callback
  }, Math.min(30000, text.length * 150 + 2000))

  // C1 FIX: Register timeout in stable Map — no function reassignment, no closure accumulation
  speechTimeouts.set(speechId, safetyTimeout)

  // REGRESSION FIX: Conditional cancel with Android delay
  // HYPOTHESIS: Unconditional cancel() immediately before speak() creates race on Android
  // FIX: Only cancel if something is actually active, then delay speak on Android
  const needsCancel = stateBefore.speaking || stateBefore.pending

  if (needsCancel) {
    // Log the cancel for regression analysis
    traceTTS('synth_cancel_needed', {
      speechId,
      reason: 'active_speech_detected',
      speaking: stateBefore.speaking,
      pending: stateBefore.pending,
    })
    instrumentedCancel(
      synth,
      'executeTTS.conditional_cleanup',
      speechId,
      currentSpeech?.id
    )

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⚠️  GUARDRAIL: Cancel+delay pattern — SYSTEM INTERRUPT LANE ONLY
    //
    // This cancel()+setTimeout()+speak() pattern is ONLY safe for:
    //   - SOS alerts
    //   - Emergency notifications
    //   - Safety-critical interrupts
    //
    // FORBIDDEN for user command responses — breaks Android audio context.
    // User responses MUST use speakMinimal() in VoicePanel.tsx (direct speak).
    //
    // See TIER2_VOICE_STABILITY_GUARDRAILS.md — Two-Lane Architecture.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ANDROID FIX: Delay speak() after cancel to let browser complete async cleanup
    // 50ms is sufficient for Chrome/Android to process cancel without killing new utterance
    const isAndroid = /Android/i.test(navigator.userAgent)
    const delayMs = isAndroid ? 50 : 0

    if (delayMs > 0) {
      traceTTS('android_speak_delay', { speechId, delayMs, reason: 'cancel_race_mitigation' })
      window.setTimeout(() => {
        performSpeak(synth, utterance, speechId, text, startupWindowOpen)
      }, delayMs)
      return
    }
  }

  // Direct speak path (no cancel needed, or non-Android with immediate execution)
  performSpeak(synth, utterance, speechId, text, startupWindowOpen)
}

/**
 * Perform the actual speak() call with full instrumentation.
 * Separated to handle both immediate and delayed execution paths.
 */
function performSpeak(
  synth: SpeechSynthesis,
  utterance: SpeechSynthesisUtterance,
  speechId: string,
  text: string,
  startupWindowOpen: boolean,
): void {
  try {
    traceTTS('synth_speak_called', { speechId, textLength: text.length, voiceCount: synth.getVoices().length })
    synth.speak(utterance)

    // CRITICAL: Check if speak() actually started
    window.setTimeout(() => {
      const stateAfterSpeak = {
        speaking: synth.speaking,
        pending: synth.pending,
      }
      traceTTS('synth_state_after_speak', { speechId, ...stateAfterSpeak })

      if (!stateAfterSpeak.speaking && !stateAfterSpeak.pending) {
        // Speech didn't start - likely blocked by browser (gesture requirement, audio focus, etc)
        traceTTS('synth_speaking_never_true', { speechId, reason: 'browser_blocked_or_gesture_required' })
      }
    }, 50) // Check shortly after speak() call

  } catch (err) {
    logWarn(LOG_CAT, 'speak() threw', { error: (err as Error).message })
    traceTTS('synth_speak_threw', { speechId, error: (err as Error).message })
    cleanupSpeech(speechId)
  }
}

function recordToHistory(text: string, priority: VoicePriority, sourceId: string): void {
  speechHistory.push({
    text,
    priority,
    sourceId,
    timestamp: Date.now(),
  })

  // Trim history
  while (speechHistory.length > MAX_HISTORY) {
    speechHistory.shift()
  }
}

// ============================================================================
// DIAGNOSTICS
// ============================================================================

export function getVoiceAuthorityDiagnostics(): {
  speaking: boolean
  current: ReturnType<typeof getCurrentSpeech>
  historyCount: number
  queueLength: number
} {
  return {
    speaking: isSpeaking(),
    current: getCurrentSpeech(),
    historyCount: speechHistory.length,
    queueLength: speechQueue.length,
  }
}

// ============================================================================
// INITIALIZATION SAFETY
// ============================================================================

/** Reset on module load (hot reload protection) */
if (typeof window !== 'undefined') {
  // C1 FIX: Clear any orphaned timeouts from Map (prevent memory leak on reload)
  for (const [speechId, timeoutId] of speechTimeouts) {
    window.clearTimeout(timeoutId)
    speechTimeouts.delete(speechId)
  }

  // Clear any orphaned speech state
  try {
    window.speechSynthesis?.cancel()
  } catch {
    // Ignore
  }
}
