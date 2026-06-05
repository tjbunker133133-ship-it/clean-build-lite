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
): { started: boolean; interrupted: boolean; reason?: string } {
  const trimmed = text.trim()
  if (!trimmed) {
    return { started: false, interrupted: false, reason: 'empty_text' }
  }

  const now = Date.now()
  const speechId = `sp-${++speechIdCounter}-${now}`

  // Check if we should interrupt or block
  if (currentSpeech !== null) {
    if (priority > currentSpeech.priority) {
      // Higher priority — interrupt
      logInfo(LOG_CAT, `Interrupting priority ${currentSpeech.priority} with priority ${priority}`, {
        current: currentSpeech.sourceId,
        incoming: sourceId,
      })
      performInterrupt(speechId, trimmed, priority, sourceId)
      return { started: true, interrupted: true }
    } else {
      // Equal or lower priority — drop (no queueing to prevent overlap)
      logInfo(LOG_CAT, `Dropping speech: priority ${priority} <= current ${currentSpeech.priority}`, {
        sourceId,
      })
      return { started: false, interrupted: false, reason: 'priority_blocked' }
    }
  }

  // No current speech — start immediately
  beginSpeech(speechId, trimmed, priority, sourceId)
  return { started: true, interrupted: false }
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

  // Cancel browser TTS
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      // Ignore cancel errors
    }
  }

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
  // Record interrupted speech to history (partial)
  if (currentSpeech) {
    recordToHistory(currentSpeech.text, currentSpeech.priority, currentSpeech.sourceId)
  }

  // Cancel current
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      // Ignore
    }
  }

  currentSpeech = null

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

  notifyStateChange()

  // Execute TTS
  executeTTS(text, id)
}

// C1 FIX: Stable cleanup function — no dynamic reassignment, no closure chain
function cleanupSpeech(speechId: string): void {
  // Clear any pending timeout for this speechId (stable lookup, no closures)
  const timeoutId = speechTimeouts.get(speechId)
  if (timeoutId !== undefined) {
    window.clearTimeout(timeoutId)
    speechTimeouts.delete(speechId)
  }

  if (!currentSpeech || currentSpeech.id !== speechId) {
    return // Already changed or stale
  }

  recordToHistory(currentSpeech.text, currentSpeech.priority, currentSpeech.sourceId)
  currentSpeech = null
  notifyStateChange()
}

function executeTTS(text: string, speechId: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    logWarn(LOG_CAT, 'TTS not supported')
    cleanupSpeech(speechId)
    return
  }

  const synth = window.speechSynthesis

  try {
    synth.cancel() // Ensure clean state
  } catch {
    // Ignore
  }

  const utterance = new SpeechSynthesisUtterance(text)

  // Store reference for potential cancellation
  if (currentSpeech && currentSpeech.id === speechId) {
    currentSpeech.utterance = utterance
  }

  // C1 FIX: Use stable cleanup function, register timeout in Map (no closure chain)
  utterance.onend = () => cleanupSpeech(speechId)
  utterance.onerror = () => cleanupSpeech(speechId)

  // Safety timeout — force cleanup if events don't fire
  const safetyTimeout = window.setTimeout(() => {
    cleanupSpeech(speechId)
  }, Math.min(30000, text.length * 150 + 2000))

  // C1 FIX: Register timeout in stable Map — no function reassignment, no closure accumulation
  speechTimeouts.set(speechId, safetyTimeout)

  try {
    synth.speak(utterance)
  } catch (err) {
    logWarn(LOG_CAT, 'speak() threw', { error: (err as Error).message })
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
