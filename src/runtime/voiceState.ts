/**
 * Canonical voice subsystem state model.
 *
 * The previous implementation interleaved a UI-affordance state (`sleeping`,
 * `listening`, `processing`, `success`, `failure`) with a separate `armed`
 * boolean. That works for rendering but cannot answer the runtime question
 * "is the recognizer actually running right now or have we entered a silent
 * dead-state?".
 *
 * `VoiceRuntimeState` is the truth state surfaced via `runtimeSnapshot`. It
 * is independent of the UI state and is updated only at lifecycle edges
 * (start / onstart / onend / onerror / dead-watchdog / disarm).
 */

export type VoiceRuntimeState =
  /** Recognizer never armed. Mic permission may still be `prompt` or `granted`. */
  | 'inactive'
  /** User pressed the toggle, permission gate running. */
  | 'arming'
  /** onstart fired, recognizer is genuinely listening. */
  | 'listening'
  /** Wake-word matched, command pipeline running. Returns to listening on completion. */
  | 'processing'
  /** SR was interrupted (background / route change / audio ownership) and is trying to recover. */
  | 'recovering'
  /** Recognizer ended cleanly (e.g. user disarmed). */
  | 'inactive_clean'
  /** SR is blocked (permission denied, service not allowed, or OS/browser refused). */
  | 'blocked'
  /** SR is degraded (bounded recovery attempts exceeded); requires manual re-arm. */
  | 'degraded'
  /** armed=true but recognizer never produced an onstart inside the watchdog window.
   *  This is the "silent dead-state" the audit flagged. UI must treat as not-listening. */
  | 'dead'
  /** Mic permission denied or SpeechRecognition unsupported. */
  | 'unavailable'

export interface VoiceStateSnapshot {
  state: VoiceRuntimeState
  armed: boolean
  supported: boolean
  permission: 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported'
  lastTransitionAt: number
  lastError: string | null
  lastTranscript: string | null
  // Continuity/recovery telemetry
  lastSrStartAt: number | null
  lastRecognitionAt: number | null
  restartAttempts: number
  lastInterruptionReason: string | null
}

export const VOICE_STATE_DEFAULT: VoiceStateSnapshot = {
  state: 'inactive',
  armed: false,
  supported: false,
  permission: 'unknown',
  lastTransitionAt: 0,
  lastError: null,
  lastTranscript: null,
  lastSrStartAt: null,
  lastRecognitionAt: null,
  restartAttempts: 0,
  lastInterruptionReason: null,
}
