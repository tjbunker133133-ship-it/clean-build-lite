/**
 * Central HUD audio / speech arbitration.
 *
 * Single authority for:
 * - TTS vs SpeechRecognition mutual exclusion (no self-listening loops)
 * - Authoritative stop-all teardown (alarms, TTS, registered timers/contexts)
 * - PRIORITY-BASED VOICE AUTHORITY (via voiceAuthorityController)
 *
 * Listen modes (OFF / POWER SAVE / HARD LISTEN) remain in VoicePanel +
 * voiceListenProfile; this module owns output + mic-gate state only.
 */

import { logInfo, logWarn } from './logger'
import {
  startSpeech as authorityStartSpeech,
  stopSpeech as authorityStopSpeech,
  clearSpeechQueue as authorityClearQueue,
  isSpeaking as authorityIsSpeaking,
  VOICE_PRIORITY,
  type VoicePriority,
  subscribeToSpeechState,
} from '../lib/voice/voiceAuthorityController'

export type VoiceAudioMode = 'off' | 'powerSave' | 'hardListen'

type StopListener = () => void

const stopListeners = new Set<StopListener>()

let speechActive = false
let recognitionHold = false
let ignoreRecognitionUntil = 0

export function registerHudAudioStopListener(listener: StopListener): () => void {
  stopListeners.add(listener)
  return () => {
    stopListeners.delete(listener)
  }
}

export function isHudSpeechActive(): boolean {
  return speechActive
}

export function setRecognitionOutputHold(hold: boolean): void {
  recognitionHold = hold
}

export function isRecognitionOutputHeld(): boolean {
  return recognitionHold
}

/** Post-TTS cooldown before accepting SR finals (echo guard). */
export function armRecognitionIgnoreUntil(epochMs: number): void {
  ignoreRecognitionUntil = epochMs
}

export function shouldBlockSpeechRecognition(): boolean {
  if (speechActive || recognitionHold) return true
  if (typeof performance !== 'undefined' && performance.now() < ignoreRecognitionUntil) return true
  return false
}

/** Ms until SR may start again (0 = ready now). Used to defer mic restart, not skip it. */
export function speechRecognitionBlockRemainingMs(): number {
  let remaining = 0
  if (speechActive || recognitionHold) {
    remaining = Math.max(remaining, 400)
  }
  if (typeof performance !== 'undefined' && performance.now() < ignoreRecognitionUntil) {
    remaining = Math.max(remaining, ignoreRecognitionUntil - performance.now() + 50)
  }
  return remaining
}

/**
 * Voice-only teardown (mic/TTS gates). Does not invoke registered alarm hooks.
 */
export function stopVoiceOutputOnly(reason = 'voice-off'): void {
  logInfo('VOICE', `voice-output-stop reason=${reason}`)
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  } catch {
    // ignore
  }
  speechActive = false
  recognitionHold = false
  ignoreRecognitionUntil = 0
}

/**
 * Authoritative audio stop — cancels TTS, runs all registered teardown hooks
 * (SOS test alarm, etc.), and resets arbitration gates.
 */
export function stopAllHudAudio(reason = 'stop-all'): void {
  logInfo('VOICE', `stop-all reason=${reason}`)
  stopVoiceOutputOnly(reason)
  for (const listener of stopListeners) {
    try {
      listener()
    } catch {
      // listener errors must not block teardown
    }
  }
  speechActive = false
  recognitionHold = false
  ignoreRecognitionUntil = 0
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('hud:audio-stop-all', { detail: { reason } }))
  }
}

function markSpeechStarted(): void {
  speechActive = true
}

function markSpeechEnded(): void {
  speechActive = false
}

/**
 * Determine voice priority based on content heuristics.
 * This is a best-effort classification for legacy call paths.
 */
function inferPriorityFromText(text: string): VoicePriority {
  const lower = text.toLowerCase()
  // Safety patterns
  if (
    lower.includes('emergency') ||
    lower.includes('sos') ||
    lower.includes('heart rate') ||
    lower.includes('battery critical') ||
    lower.includes('heat stress') ||
    lower.includes('cold stress') ||
    lower.includes('stop and assess') ||
    lower.includes('check in')
  ) {
    return VOICE_PRIORITY.SAFETY
  }
  // Command results (user-initiated actions)
  if (
    lower.includes('centered') ||
    lower.includes('zooming') ||
    lower.includes('zoomed') ||
    lower.includes('flashlight') ||
    lower.includes('morse') ||
    lower.includes('panel opened') ||
    lower.includes('pin added') ||
    lower.includes('route cleared') ||
    lower.match(/^(ok\.|done\.|confirmed\.)/)
  ) {
    return VOICE_PRIORITY.USER_COMMAND
  }
  // Help/guidance patterns
  if (
    lower.includes('commands are available') ||
    lower.includes('say') ||
    lower.includes('example') ||
    lower.includes('you can say')
  ) {
    return VOICE_PRIORITY.HELP_GUIDANCE
  }
  // Environment readouts
  if (
    lower.includes('weather') ||
    lower.includes('conditions') ||
    lower.includes('elevation') ||
    lower.includes('humidity') ||
    lower.includes('wind')
  ) {
    return VOICE_PRIORITY.ENVIRONMENT_READOUT
  }
  // Default to system feedback
  return VOICE_PRIORITY.SYSTEM_FEEDBACK
}

/**
 * Speak one phrase via Voice Authority Controller with priority enforcement.
 * This is the PRIMARY entry point for all HUD speech.
 *
 * Resolves only after utterance end/error (or safety timeout).
 * Respects priority: lower priority may be dropped if higher is speaking.
 */
export function speakHudPhrase(text: string, rate: number, priority?: VoicePriority): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      resolve()
      return
    }
    const trimmed = text.trim()
    if (!trimmed) {
      resolve()
      return
    }

    const effectivePriority = priority ?? inferPriorityFromText(trimmed)

    markSpeechStarted()

    // Subscribe to know when speech ends
    let unsub: (() => void) | null = null
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      if (unsub) {
        unsub()
        unsub = null
      }
      markSpeechEnded()
      resolve()
    }

    // Watch state changes
    unsub = subscribeToSpeechState((state) => {
      if (!state.speaking && settled) {
        // Already finished
        return
      }
      if (!state.speaking && !settled) {
        // Speech stopped (could be interrupt or natural end)
        finish()
      }
    })

    // Attempt to start speech through authority controller
    const result = authorityStartSpeech(trimmed, effectivePriority, 'voiceAudioArbitration')

    if (!result.started) {
      // Blocked by priority — resolve immediately with log
      logInfo('VOICE_ARBITRATION', `Speech dropped by authority: ${result.reason}`, {
        text: trimmed.slice(0, 60),
        priority: effectivePriority,
      })
      finish()
      return
    }

    // Safety timeout in case authority callbacks fail
    window.setTimeout(() => {
      if (!settled) {
        logWarn('VOICE_ARBITRATION', 'Speech safety timeout fired', { text: trimmed.slice(0, 40) })
        authorityStopSpeech('safety_timeout')
        finish()
      }
    }, Math.min(30_000, trimmed.length * 120 + 3000))

    // Apply rate by creating a temporary utterance to set defaults
    // (Actual TTS is managed by authority controller)
    if (rate !== 1.0) {
      try {
        const tempUtter = new SpeechSynthesisUtterance('')
        tempUtter.rate = rate
        // This sets the default rate for subsequent utterances in some engines
        window.speechSynthesis.speak(tempUtter)
        window.speechSynthesis.cancel() // Cancel the empty utterance
      } catch {
        // Ignore rate-setting errors
      }
    }
  })
}

/**
 * Emergency stop all speech immediately.
 * Use for: user "stop speaking" command, safety alerts that must speak NOW,
 * system reset, critical interruptions.
 */
export function stopAllSpeech(reason = 'emergency_stop'): void {
  logInfo('VOICE_ARBITRATION', `stopAllSpeech: ${reason}`)
  authorityStopSpeech(reason)
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  } catch {
    // Ignore
  }
}

/**
 * Clear speech queue and stop current.
 * More aggressive than stopAllSpeech — also clears any pending items.
 */
export function clearAllSpeech(reason = 'clear_all'): void {
  logInfo('VOICE_ARBITRATION', `clearAllSpeech: ${reason}`)
  authorityClearQueue(reason)
}

/**
 * Interrupt current speech with higher priority.
 * Returns true if interrupt succeeded.
 */
export function interruptSpeech(priority: VoicePriority, reason: string): boolean {
  logInfo('VOICE_ARBITRATION', `interruptSpeech requested: priority ${priority}, ${reason}`)
  return authorityStopSpeech(`interrupt_${reason}`)
}

/**
 * Check if TTS is currently active.
 */
export function isSpeaking(): boolean {
  return authorityIsSpeaking()
}
