/**
 * Voice Regression Isolation Debug Module
 *
 * STRICT PURPOSE: Isolate exact source of voice/TTS regression on Android.
 * NO FEATURES. NO PATCHES. ONLY ISOLATION DIAGNOSTICS.
 *
 * Exposed via window.__hudDebug
 */

import { logInfo, logWarn } from './logger'
import { traceTTS } from './runtimeForensics'

const LOG_CAT = 'RUNTIME'

// ============================================================================
// REGRESSION ISOLATION STATE
// ============================================================================

export type VoiceDebugConfig = {
  /**
   * PHASE 1: Raw TTS bypass
   * Bypasses ALL orchestration - authority controller, priority, SR pause/resume
   * Calls ONLY: speechSynthesis.speak(new SpeechSynthesisUtterance(text))
   */
  rawMode: boolean

  /**
   * PHASE 2: Disable authority controller
   * When true: VoicePanel speaks directly via speakHudPhrase without priority checks
   */
  disableVoiceAuthority: boolean

  /**
   * PHASE 3: Disable SR pause/resume during TTS
   * When true: speakHandsFree does NOT stop/restart recognition during speech
   */
  disableSrPause: boolean

  /**
   * PHASE 4: Trace all cancel() calls
   * When true: Every cancel() call is logged with stack trace and context
   */
  traceCancelCalls: boolean

  /**
   * PHASE 5: Safe mode - minimal lifecycle
   * When true: All orchestration stripped, single utterance only, no queues
   */
  voiceSafeMode: boolean
}

const debugConfig: VoiceDebugConfig = {
  rawMode: false,
  disableVoiceAuthority: false,
  disableSrPause: false,
  traceCancelCalls: true, // Always trace cancel() - critical for regression isolation
  voiceSafeMode: false,
}

// Track all cancel() calls for regression analysis
const cancelCallLog: Array<{
  ts: number
  stack: string
  sessionId?: string
  activeUtteranceId?: string
  source: string
  speechState: {
    speaking: boolean
    pending: boolean
    paused: boolean
  }
}> = []

const MAX_CANCEL_LOG = 50

// ============================================================================
// PHASE 1: RAW TTS - Zero orchestration
// ============================================================================

/**
 * Raw TTS - bypasses ALL orchestration layers.
 * Tests whether Android TTS itself works without any wrapper logic.
 */
function rawSpeak(text: string): { sent: boolean; error?: string } {
  const trimmed = text.trim()
  if (!trimmed) {
    return { sent: false, error: 'empty_text' }
  }

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return { sent: false, error: 'speech_synthesis_not_supported' }
  }

  try {
    const synth = window.speechSynthesis
    const utterance = new SpeechSynthesisUtterance(trimmed)

    // Log state BEFORE
    const stateBefore = {
      speaking: synth.speaking,
      pending: synth.pending,
      paused: synth.paused,
    }

    // NO CANCEL. NO PRIORITY. NO PAUSE. DIRECT SPEAK.
    logInfo(LOG_CAT, 'RAW_SPEAK_START', {
      text: trimmed.slice(0, 60),
      stateBefore,
    })

    // Simple handlers for observation only
    utterance.onstart = () => {
      logInfo(LOG_CAT, 'RAW_SPEAK_ONSTART', { text: trimmed.slice(0, 40) })
    }
    utterance.onend = () => {
      logInfo(LOG_CAT, 'RAW_SPEAK_ONEND', { text: trimmed.slice(0, 40) })
    }
    utterance.onerror = (event) => {
      logWarn(LOG_CAT, 'RAW_SPEAK_ONERROR', {
        error: event.error,
        text: trimmed.slice(0, 40),
        charIndex: event.charIndex,
      })
    }

    synth.speak(utterance)

    // Log state IMMEDIATELY after speak()
    setTimeout(() => {
      logInfo(LOG_CAT, 'RAW_SPEAK_STATE_AFTER', {
        text: trimmed.slice(0, 40),
        speaking: synth.speaking,
        pending: synth.pending,
        paused: synth.paused,
      })
    }, 50)

    return { sent: true }
  } catch (err) {
    logWarn(LOG_CAT, 'RAW_SPEAK_THREW', {
      error: (err as Error).message,
      text: trimmed.slice(0, 40),
    })
    return { sent: false, error: (err as Error).message }
  }
}

// ============================================================================
// PHASE 2-5: Configuration flags
// ============================================================================

function setDisableVoiceAuthority(enabled: boolean): void {
  debugConfig.disableVoiceAuthority = enabled
  logInfo(LOG_CAT, 'CONFIG_DISABLE_AUTHORITY', { enabled })
}

function setDisableSrPause(enabled: boolean): void {
  debugConfig.disableSrPause = enabled
  logInfo(LOG_CAT, 'CONFIG_DISABLE_SR_PAUSE', { enabled })
}

function setVoiceSafeMode(enabled: boolean): void {
  debugConfig.voiceSafeMode = enabled
  logInfo(LOG_CAT, 'CONFIG_SAFE_MODE', { enabled })
}

function setTraceCancelCalls(enabled: boolean): void {
  debugConfig.traceCancelCalls = enabled
  logInfo(LOG_CAT, 'CONFIG_TRACE_CANCEL', { enabled })
}

// ============================================================================
// PHASE 4: Cancel() instrumentation
// ============================================================================

/**
 * Instrumented cancel() - logs every call with full context.
 * This is the leading regression hypothesis: cancel() firing during startup.
 */
export function instrumentedCancel(
  synth: SpeechSynthesis,
  context: string,
  sessionId?: string,
  activeUtteranceId?: string,
): void {
  const stateBefore = {
    speaking: synth.speaking,
    pending: synth.pending,
    paused: synth.paused,
  }

  // Capture stack trace
  let stack = ''
  try {
    throw new Error('Cancel() call site trace')
  } catch (e) {
    stack = (e as Error).stack || ''
  }

  // Log to forensic buffer
  traceTTS('synth_cancel_called', {
    context,
    sessionId,
    activeUtteranceId,
    stateBefore,
    stack: stack.split('\n').slice(2, 8).join(' | '), // Skip Error creation lines
  })

  // Log to debug buffer
  if (debugConfig.traceCancelCalls) {
    cancelCallLog.push({
      ts: Date.now(),
      stack,
      sessionId,
      activeUtteranceId,
      source: context,
      speechState: stateBefore,
    })

    while (cancelCallLog.length > MAX_CANCEL_LOG) {
      cancelCallLog.shift()
    }
  }

  logInfo(LOG_CAT, 'CANCEL_CALL', {
    context,
    sessionId,
    activeUtteranceId,
    speaking: stateBefore.speaking,
    pending: stateBefore.pending,
  })

  // Execute actual cancel
  try {
    synth.cancel()
  } catch (err) {
    logWarn(LOG_CAT, 'CANCEL_THREW', {
      context,
      error: (err as Error).message,
    })
  }
}

// ============================================================================
// DEBUG STATE ACCESSORS
// ============================================================================

function getCancelCallLog() {
  return [...cancelCallLog]
}

function getDebugConfig(): VoiceDebugConfig {
  return { ...debugConfig }
}

function clearCancelLog(): void {
  cancelCallLog.length = 0
  logInfo(LOG_CAT, 'CANCEL_LOG_CLEARED')
}

// ============================================================================
// DIAGNOSTIC SUMMARY
// ============================================================================

function generateDiagnosticReport(): {
  config: VoiceDebugConfig
  cancelCallCount: number
  recentCancels: typeof cancelCallLog
  speechSynthesisState: {
    supported: boolean
    speaking: boolean
    pending: boolean
    paused: boolean
    voices: number
  } | null
} {
  let synthState = null
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const synth = window.speechSynthesis
    synthState = {
      supported: true,
      speaking: synth.speaking,
      pending: synth.pending,
      paused: synth.paused,
      voices: synth.getVoices().length,
    }
  }

  return {
    config: getDebugConfig(),
    cancelCallCount: cancelCallLog.length,
    recentCancels: getCancelCallLog(),
    speechSynthesisState: synthState,
  }
}

// ============================================================================
// GLOBAL EXPOSURE
// ============================================================================

if (typeof window !== 'undefined') {
  const w = window as unknown as {
    __hudDebug?: {
      rawSpeak: typeof rawSpeak
      disableVoiceAuthority: boolean
      setDisableVoiceAuthority: typeof setDisableVoiceAuthority
      disableSrPause: boolean
      setDisableSrPause: typeof setDisableSrPause
      voiceSafeMode: boolean
      setVoiceSafeMode: typeof setVoiceSafeMode
      traceCancelCalls: boolean
      setTraceCancelCalls: typeof setTraceCancelCalls
      getCancelCallLog: typeof getCancelCallLog
      clearCancelLog: typeof clearCancelLog
      getDiagnosticReport: typeof generateDiagnosticReport
      _config: VoiceDebugConfig
    }
  }

  w.__hudDebug = {
    rawSpeak,
    disableVoiceAuthority: debugConfig.disableVoiceAuthority,
    setDisableVoiceAuthority,
    disableSrPause: debugConfig.disableSrPause,
    setDisableSrPause,
    voiceSafeMode: debugConfig.voiceSafeMode,
    setVoiceSafeMode,
    traceCancelCalls: debugConfig.traceCancelCalls,
    setTraceCancelCalls,
    getCancelCallLog,
    clearCancelLog,
    getDiagnosticReport: generateDiagnosticReport,
    _config: debugConfig,
  }

  // Proxy getters to ensure live config access
  Object.defineProperty(w.__hudDebug, 'disableVoiceAuthority', {
    get: () => debugConfig.disableVoiceAuthority,
    set: (v: boolean) => setDisableVoiceAuthority(v),
  })
  Object.defineProperty(w.__hudDebug, 'disableSrPause', {
    get: () => debugConfig.disableSrPause,
    set: (v: boolean) => setDisableSrPause(v),
  })
  Object.defineProperty(w.__hudDebug, 'voiceSafeMode', {
    get: () => debugConfig.voiceSafeMode,
    set: (v: boolean) => setVoiceSafeMode(v),
  })
  Object.defineProperty(w.__hudDebug, 'traceCancelCalls', {
    get: () => debugConfig.traceCancelCalls,
    set: (v: boolean) => setTraceCancelCalls(v),
  })

  logInfo(LOG_CAT, 'DEBUG_MODULE_INITIALIZED')
}

// ============================================================================
// EXPORT FOR INTEGRATION
// ============================================================================

export { debugConfig, rawSpeak, getCancelCallLog, clearCancelLog, generateDiagnosticReport }
