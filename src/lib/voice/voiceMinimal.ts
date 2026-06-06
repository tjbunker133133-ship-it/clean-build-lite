/**
 * VOICE MINIMAL — Phase 1 Stable Runtime
 *
 * PURPOSE: Smallest possible reliable TTS path for Android field use.
 * STRATEGY: Direct SpeechSynthesis only, no orchestration, no restart logic.
 *
 * VERIFICATION PROTOCOL:
 * 1. Enable: window.__hudDebug.useMinimalVoice = true
 * 2. Test: "HUD status" repeatedly on Android
 * 3. Verify: Audible playback, no interruption, stable across sessions
 * 4. If stable: keep; if not: investigate platform/browser issue
 *
 * ⚠️  GUARDRAIL WARNING — DO NOT MODIFY WITHOUT ANDROID FIELD TEST
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * This is the DEFAULT path for all user command responses.
 * ANY modification requires:
 *   1. Android field test (minimum 20 commands)
 *   2. Verify no "cancel() + setTimeout + speak()" pattern introduced
 *   3. Verify audio context preserved across utterances
 *
 * FORBIDDEN PATTERNS (will break Android audio):
 *   ❌ synth.cancel() before speak()
 *   ❌ setTimeout(() => synth.speak(), N)
 *   ❌ Priority queue management
 *   ❌ Orchestration layer calls
 *
 * ALLOWED PATTERNS:
 *   ✅ Direct synth.speak(utterance)
 *   ✅ Simple overlap prevention (skip if speaking)
 *   ✅ Basic onstart/onend/onerror handlers
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import { logInfo, logWarn } from '../../runtime/logger'

const LOG_CAT = 'VOICE'

// ============================================================================
// MINIMAL STATE — Only what's essential
// ============================================================================

let currentUtterance: SpeechSynthesisUtterance | null = null
let isSpeaking = false

// ============================================================================
// CORE MINIMAL SPEAK
// ============================================================================

/**
 * Minimal speak function — direct synth.speak() with only error handling.
 * NO: priority, NO cancel logic, NO restart scheduling, NO queues.
 * YES: basic lifecycle tracking, error logging.
 */
export function speakMinimal(text: string): { started: boolean; error?: string } {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return { started: false, error: 'TTS not supported' }
  }

  const synth = window.speechSynthesis
  const trimmed = text.trim()

  if (!trimmed) {
    return { started: false, error: 'empty text' }
  }

  // Simple overlap prevention: just don't start if already speaking
  // (Don't cancel — let current finish naturally)
  if (isSpeaking) {
    logInfo(LOG_CAT, 'Skipping speech — already active', { text: trimmed.slice(0, 40) })
    return { started: false, error: 'speech_active' }
  }

  try {
    const utterance = new SpeechSynthesisUtterance(trimmed)
    currentUtterance = utterance
    isSpeaking = true

    // Minimal handlers — only track state and log errors
    utterance.onstart = () => {
      logInfo(LOG_CAT, 'Speech started', { text: trimmed.slice(0, 40) })
    }

    utterance.onend = () => {
      logInfo(LOG_CAT, 'Speech completed')
      isSpeaking = false
      currentUtterance = null
    }

    utterance.onerror = (event) => {
      logWarn(LOG_CAT, 'Speech error', { error: event.error, text: trimmed.slice(0, 40) })
      isSpeaking = false
      currentUtterance = null
    }

    // Direct speak — no cancel, no delay, no priority
    synth.speak(utterance)

    logInfo(LOG_CAT, 'speak() called', { textLength: trimmed.length })
    return { started: true }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logWarn(LOG_CAT, 'speak() threw', { error: errorMsg })
    isSpeaking = false
    currentUtterance = null
    return { started: false, error: errorMsg }
  }
}

/**
 * Minimal cleanup — only if utterance is stuck.
 * Use only when synth.speaking stays true unexpectedly.
 */
export function cleanupMinimal(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

  const synth = window.speechSynthesis

  // Only cancel if truly stuck (speaking but no actual progress)
  if (synth.speaking && currentUtterance) {
    logInfo(LOG_CAT, 'Cleanup: canceling stuck speech')
    synth.cancel()
    isSpeaking = false
    currentUtterance = null
  }
}

/**
 * Get minimal voice state for debugging.
 */
export function getMinimalVoiceState(): {
  isSpeaking: boolean
  hasUtterance: boolean
  synthSpeaking: boolean
  synthPending: boolean
} {
  const synth = typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null

  return {
    isSpeaking,
    hasUtterance: !!currentUtterance,
    synthSpeaking: synth?.speaking ?? false,
    synthPending: synth?.pending ?? false,
  }
}

/**
 * Force stop current speech (emergency only).
 */
export function stopMinimal(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

  window.speechSynthesis.cancel()
  isSpeaking = false
  currentUtterance = null
}

// ============================================================================
// BACKWARD COMPATIBILITY EXPORTS
// ============================================================================

/**
 * Check if minimal voice mode should be used.
 * Controlled by window.__hudDebug.useMinimalVoice
 */
export function shouldUseMinimalVoice(): boolean {
  const w = window as unknown as {
    __hudDebug?: { useMinimalVoice?: boolean }
  }
  return !!w.__hudDebug?.useMinimalVoice
}
