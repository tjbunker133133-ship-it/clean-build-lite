/**
 * Central HUD audio / speech arbitration.
 *
 * Single authority for:
 * - TTS vs SpeechRecognition mutual exclusion (no self-listening loops)
 * - Authoritative stop-all teardown (alarms, TTS, registered timers/contexts)
 *
 * Listen modes (OFF / POWER SAVE / HARD LISTEN) remain in VoicePanel +
 * voiceListenProfile; this module owns output + mic-gate state only.
 */

import { logInfo } from './logger'

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
 * Speak one phrase via Web Speech API. Resolves only after utterance end/error
 * (or a generous safety timeout) — never on an optimistic timer that clears
 * the speech gate while audio is still playing.
 */
export function speakHudPhrase(text: string, rate: number): Promise<void> {
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
    markSpeechStarted()
    const synth = window.speechSynthesis
    try {
      synth.cancel()
    } catch {
      // ignore
    }
    const utterance = new SpeechSynthesisUtterance(trimmed)
    utterance.rate = rate
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      markSpeechEnded()
      resolve()
    }
    utterance.onend = finish
    utterance.onerror = finish
    try {
      synth.speak(utterance)
    } catch {
      finish()
      return
    }
    // Safety only when platform never fires onend/onerror (Android WebView edge).
    window.setTimeout(finish, Math.min(25_000, trimmed.length * 120 + 3000))
  })
}
