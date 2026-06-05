/**
 * Situational Voice Support (SVS) - TTS Output Layer
 *
 * Integrates with existing HUD TTS infrastructure.
 * Uses the voiceAudioArbitration system for proper coordination.
 *
 * Responsibilities:
 * - Speak approved prompts through HUD TTS
 * - Coordinate with voice recognition (pause/resume)
 * - Respect speech rate preferences
 * - Handle interruption gracefully
 * - Provide delivery feedback to governor
 */

import { speakHudPhrase, stopVoiceOutputOnly, setRecognitionOutputHold, interruptSpeech } from '../../runtime/voiceAudioArbitration'
import { VOICE_PRIORITY, type VoicePriority } from '../../lib/voice/voiceAuthorityController'
import { logInfo, logWarn } from '../../runtime/logger'
import type { SvsDeliveryResult, SvsPriority, SvsPrompt, SvsRuntimeSnapshot } from './types'
import { markTtsStart, markTtsEnd } from './governor'

// ============================================================================
// TTS STATE
// ============================================================================

type TtsState = 'idle' | 'speaking' | 'paused'

let ttsState: TtsState = 'idle'
let lastDelivery: SvsDeliveryResult | null = null
let deliveryListeners: ((result: SvsDeliveryResult) => void)[] = []
let runtimeSnapshot: SvsRuntimeSnapshot = {
  isEnabled: true,
  currentMode: 'supportive',
  lastDeliveryAt: null,
  lastDeliveryText: null,
  deliveriesThisSession: 0,
  eventsDetectedThisSession: 0,
  governorState: 'idle',
  queueDepth: 0,
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Map SVS priority to Voice Authority priority.
 * Safety (1) → SAFETY (100) — can interrupt everything
 * Operational (2) → USER_COMMAND (80) — can interrupt environment/help
 * Supportive (3) → HELP_GUIDANCE (20) — lowest priority
 */
function mapSvsPriorityToAuthority(svsPriority: SvsPriority): VoicePriority {
  switch (svsPriority) {
    case 1: // Safety
      return VOICE_PRIORITY.SAFETY
    case 2: // Operational
      return VOICE_PRIORITY.USER_COMMAND
    case 3: // Supportive
      return VOICE_PRIORITY.HELP_GUIDANCE
    default:
      return VOICE_PRIORITY.SYSTEM_FEEDBACK
  }
}

export function speakPrompt(prompt: SvsPrompt, priority: SvsPriority): Promise<SvsDeliveryResult> {
  return new Promise((resolve) => {
    const authorityPriority = mapSvsPriorityToAuthority(priority)

    // SAFETY ALERTS: Always interrupt immediately via Voice Authority
    if (priority === 1 && prompt.canInterrupt) {
      logInfo('SVS', 'SAFETY ALERT interrupt triggered', {
        promptId: prompt.id,
        text: prompt.text.slice(0, 50),
      })
      // Force immediate interrupt through authority controller
      interruptSpeech(VOICE_PRIORITY.SAFETY, `svs-safety-${prompt.id}`)
    }

    if (ttsState === 'speaking') {
      // Handle interruption based on priority
      if (!prompt.canInterrupt) {
        const result: SvsDeliveryResult = {
          delivered: false,
          rejectionReason: 'tts_busy',
          timestamp: Date.now(),
        }
        notifyListeners(result)
        resolve(result)
        return
      }

      // Interrupt current speech via authority controller
      logInfo('SVS', 'Interrupting current TTS for higher priority', {
        incoming: prompt.id,
        priority,
        authorityPriority,
      })
      stopVoiceOutputOnly('svs-interrupt')
    }

    // Mark governor TTS state
    markTtsStart(priority)
    ttsState = 'speaking'

    // Pause voice recognition if active
    setRecognitionOutputHold(true)

    // Speak the prompt
    const text = prompt.text
    const rate = getSpeechRateForPriority(priority)

    logInfo('SVS', 'Speaking prompt', {
      id: prompt.id,
      priority,
      authorityPriority,
      text: text.slice(0, 50),
    })

    // Pass authority priority to ensure priority enforcement at TTS layer
    speakHudPhrase(text, rate, authorityPriority)
      .then(() => {
        const result: SvsDeliveryResult = {
          delivered: true,
          promptId: prompt.id,
          text: text,
          timestamp: Date.now(),
        }

        lastDelivery = result
        updateRuntimeSnapshot(result)
        markTtsEnd()
        ttsState = 'idle'

        // Resume voice recognition
        setRecognitionOutputHold(false)

        notifyListeners(result)
        resolve(result)
      })
      .catch((err) => {
        logWarn('SVS', 'TTS delivery failed', { error: String(err), prompt: prompt.id })

        const result: SvsDeliveryResult = {
          delivered: false,
          promptId: prompt.id,
          timestamp: Date.now(),
        }

        markTtsEnd()
        ttsState = 'idle'

        // Resume voice recognition even on error
        setRecognitionOutputHold(false)

        notifyListeners(result)
        resolve(result)
      })
  })
}

export function cancelPendingSpeech(): void {
  if (ttsState === 'speaking') {
    stopVoiceOutputOnly('svs-cancel')
    markTtsEnd()
    ttsState = 'idle'
    setRecognitionOutputHold(false)
  }
}

export function subscribeDeliveries(listener: (result: SvsDeliveryResult) => void): () => void {
  deliveryListeners.push(listener)
  return () => {
    deliveryListeners = deliveryListeners.filter((l) => l !== listener)
  }
}

export function getLastDelivery(): SvsDeliveryResult | null {
  return lastDelivery
}

export function getRuntimeSnapshot(): SvsRuntimeSnapshot {
  return { ...runtimeSnapshot }
}

// ============================================================================
// INTERNAL FUNCTIONS
// ============================================================================

function notifyListeners(result: SvsDeliveryResult): void {
  for (const listener of deliveryListeners) {
    try {
      listener(result)
    } catch {
      // Ignore listener errors
    }
  }
}

function updateRuntimeSnapshot(result: SvsDeliveryResult): void {
  runtimeSnapshot.lastDeliveryAt = result.timestamp
  runtimeSnapshot.lastDeliveryText = result.text ?? null
  if (result.delivered) {
    runtimeSnapshot.deliveriesThisSession++
  }
}

function getSpeechRateForPriority(priority: SvsPriority): number {
  // Safety messages: slightly slower for clarity
  // Supportive messages: normal speed
  const baseRate = 0.95

  switch (priority) {
    case 1: // Safety
      return 0.92
    case 2: // Operational
      return baseRate
    case 3: // Supportive
      return 0.97
  }
}

// ============================================================================
// DIAGNOSTIC EXPORTS
// ============================================================================

export function getTtsDiagnostics(): Record<string, unknown> {
  return {
    ttsState,
    lastDelivery: lastDelivery
      ? {
          promptId: lastDelivery.promptId,
          delivered: lastDelivery.delivered,
          ago: Date.now() - lastDelivery.timestamp,
        }
      : null,
    deliveriesThisSession: runtimeSnapshot.deliveriesThisSession,
  }
}

export function _resetTtsStateForTests(): void {
  ttsState = 'idle'
  lastDelivery = null
  deliveryListeners = []
  runtimeSnapshot = {
    isEnabled: true,
    currentMode: 'supportive',
    lastDeliveryAt: null,
    lastDeliveryText: null,
    deliveriesThisSession: 0,
    eventsDetectedThisSession: 0,
    governorState: 'idle',
    queueDepth: 0,
  }
}
