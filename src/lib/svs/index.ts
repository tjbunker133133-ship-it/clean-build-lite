/**
 * Situational Voice Support (SVS) System - Main Entry Point
 *
 * Tier 2: Stable Local Guidance Layer
 *
 * Architecture:
 *   [Event Detection] -> [Prompt Selection] -> [Delivery Governor] -> [TTS Output]
 *
 * Integration:
 *   - MissionSyncContext: mission/link/peer events
 *   - useGPS: location, speed, motion
 *   - Wearables: heart rate, telemetry
 *   - Environmental: weather, sunset
 *   - VoicePanel: TTS coordination
 *
 * Tier 3 Extensibility:
 *   - Tier 3 AI enriches events before they reach governor
 *   - Governor remains authoritative - all prompts pass through it
 *   - Same delivery pipeline, enhanced content
 */

import type {
  SvsDeliveryResult,
  SvsEvent,
  SvsEventType,
  SvsFrequency,
  SvsGovernorRejection,
  SvsMode,
  SvsPriority,
  SvsRuntimeSnapshot,
  SvsTier3Candidate,
  SvsUserConfig,
} from './types'
import {
  SVS_CONFIG_DEFAULT,
  SVS_PRIORITY,
} from './types'
import {
  SVS_PRESETS,
} from './config'

import {
  cancelPendingSpeech,
  getLastDelivery,
  getRuntimeSnapshot,
  getTtsDiagnostics,
  speakPrompt,
  subscribeDeliveries,
  _resetTtsStateForTests,
} from './tts'

import {
  evaluateDelivery,
  getGovernorDiagnostics,
  getGovernorState,
  initGovernor,
  markTtsEnd,
  markTtsStart,
  markUserSilenced,
  recordDelivery,
  registerStateProviders,
  resetGovernor,
  updateConfig,
} from './governor'

import {
  detectBatteryEvent,
  detectElevationEvent,
  detectMissionEvent,
  detectMotionEvent,
  detectOffRouteEvent,
  detectPeerEvent,
  detectSessionStart,
  detectSunsetEvent,
  detectWaypointEvent,
  detectWeatherEvent,
  detectWellnessReminders,
  detectHeartRateEvent,
  emitEvent,
  getDetectionDiagnostics,
  resetEventDetection,
  subscribeSvsEvents,
} from './events'

import {
  getAdjustedCooldown,
  getAllPromptsForPriority,
  getPromptCount,
  getPromptForEvent,
  hasPromptForEvent,
  selectPromptVariant,
} from './prompts'

import {
  applyPreset,
  getFrequencyLabel,
  getModeDescription,
  getModeLabel,
  loadSvsConfig,
  resetSvsConfig,
  saveSvsConfig,
  subscribeConfigChanges,
  updateSvsConfig,
} from './config'

import { logInfo, logWarn } from '../../runtime/logger'

// ============================================================================
// RE-EXPORTS
// ============================================================================

export type {
  SvsDeliveryResult,
  SvsEvent,
  SvsEventType,
  SvsEventPayload,
  SvsFrequency,
  SvsGovernorRejection,
  SvsGovernorState,
  SvsMode,
  SvsPriority,
  SvsPrompt,
  SvsRuntimeSnapshot,
  SvsTier3Candidate,
  SvsTone,
  SvsUserConfig,
} from './types'

export {
  SVS_CONFIG_DEFAULT,
  SVS_PRIORITY,
} from './types'

export {
  SVS_PRESETS,
} from './config'

export {
  getPromptForEvent,
  hasPromptForEvent,
  selectPromptVariant,
  getAdjustedCooldown,
  getAllPromptsForPriority,
  getPromptCount,
} from './prompts'

export {
  loadSvsConfig,
  saveSvsConfig,
  updateSvsConfig,
  resetSvsConfig,
  subscribeConfigChanges,
  applyPreset,
  getFrequencyLabel,
  getModeLabel,
  getModeDescription,
} from './config'

export {
  subscribeSvsEvents,
  emitEvent,
  resetEventDetection,
  getDetectionDiagnostics,
  detectBatteryEvent,
  detectElevationEvent,
  detectHeartRateEvent,
  detectMissionEvent,
  detectMotionEvent,
  detectOffRouteEvent,
  detectPeerEvent,
  detectSessionStart,
  detectSunsetEvent,
  detectWaypointEvent,
  detectWeatherEvent,
  detectWellnessReminders,
} from './events'

export {
  evaluateDelivery,
  recordDelivery,
  getGovernorState,
  getGovernorDiagnostics,
  markUserSilenced,
  markTtsStart,
  markTtsEnd,
  initGovernor,
  resetGovernor,
  updateConfig,
  registerStateProviders,
} from './governor'

export {
  speakPrompt,
  subscribeDeliveries,
  cancelPendingSpeech,
  getLastDelivery,
  getRuntimeSnapshot,
  getTtsDiagnostics,
} from './tts'

// ============================================================================
// HIGH-LEVEL API
// ============================================================================

/**
 * Initialize the SVS system with user configuration.
 * Call once at app startup.
 */
export function initSvs(options?: {
  config?: Partial<SvsUserConfig>
  stateProviders?: Parameters<typeof registerStateProviders>[0]
}): void {
  const userConfig = options?.config ?? loadSvsConfig()
  initGovernor(userConfig)

  if (options?.stateProviders) {
    registerStateProviders(options.stateProviders)
  }

  logInfo('SVS', 'System initialized', {
    enabled: userConfig.enabled,
    mode: userConfig.mode,
    frequency: userConfig.frequency,
  })
}

/**
 * Process an event through the full pipeline:
 * detection -> governor -> TTS (if approved)
 */
export async function processEvent(event: SvsEvent): Promise<SvsDeliveryResult> {
  // Step 1: Governor evaluation (spam prevention)
  const decision = evaluateDelivery(event)

  if (decision.action === 'suppress') {
    logInfo('SVS', 'Event suppressed', {
      type: event.type,
      reason: decision.reason,
    })
    return {
      delivered: false,
      promptId: event.type,
      rejectionReason: decision.reason,
      timestamp: Date.now(),
    }
  }

  // Step 2: TTS delivery
  const result = await speakPrompt(decision.prompt, event.priority)

  // Step 3: Record delivery for cooldowns
  if (result.delivered && result.promptId) {
    recordDelivery(result.promptId, event.type)
  }

  return result
}

/**
 * Convenience method: detect event from telemetry and process if valid.
 */
export function detectAndProcess(eventType: SvsEventType, payload?: SvsEvent['payload']): void {
  const event = createManualEvent(eventType, payload)
  if (event) {
    void processEvent(event)
  }
}

/**
 * Manual event creation for external triggers (Tier 3, etc.)
 */
export function createManualEvent(
  type: SvsEventType,
  payload?: SvsEvent['payload'],
  priority?: SvsPriority,
): SvsEvent | null {
  const effectivePriority = priority ?? inferPriority(type)

  return {
    type,
    priority: effectivePriority,
    timestamp: Date.now(),
    payload: payload ?? {},
    dedupeKey: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }
}

function inferPriority(type: SvsEventType): SvsPriority {
  // Safety events
  if (
    type === 'HIGH_HEART_RATE' ||
    type === 'EXTREME_HEART_RATE' ||
    type === 'HEAT_WARNING' ||
    type === 'COLD_WARNING' ||
    type === 'LOW_BATTERY' ||
    type === 'PROLONGED_INACTIVITY' ||
    type === 'SOS_REMINDER'
  ) {
    return SVS_PRIORITY.SAFETY
  }

  // Supportive events
  if (
    type === 'LONG_EXERTION' ||
    type === 'STEADY_PACE' ||
    type === 'HYDRATION_REMINDER' ||
    type === 'REST_REMINDER' ||
    type === 'SUNRISE_GREETING' ||
    type === 'MORNING_START' ||
    type === 'SESSION_MILESTONE' ||
    type === 'MOTIVATION_SUPPORT'
  ) {
    return SVS_PRIORITY.SUPPORTIVE
  }

  // Default to operational
  return SVS_PRIORITY.OPERATIONAL
}

// ============================================================================
// TIER 3 EXTENSIBILITY HOOK
// ============================================================================

/**
 * Process a Tier 3 AI-enriched prompt candidate.
 * The governor still has final authority over delivery.
 */
export async function processTier3Candidate(candidate: SvsTier3Candidate): Promise<SvsDeliveryResult> {
  // Create synthetic event from Tier 3 candidate
  const event: SvsEvent = {
    ...candidate.sourceEvent,
    payload: {
      ...candidate.sourceEvent.payload,
      aiEnrichment: {
        confidence: candidate.confidence,
        suggestedCooldown: candidate.suggestedCooldownMs,
      },
    },
  }

  // Override priority if AI suggests higher (but never lower than safety threshold)
  if (candidate.suggestedPriority < event.priority) {
    event.priority = candidate.suggestedPriority
  }

  // Check with governor (AI confidence may affect decision in future)
  const decision = evaluateDelivery(event)

  if (decision.action === 'suppress') {
    return {
      delivered: false,
      rejectionReason: decision.reason,
      timestamp: Date.now(),
    }
  }

  // Use AI-generated text but governor-approved prompt structure
  const aiPrompt: typeof decision.prompt = {
    ...decision.prompt,
    text: candidate.enrichedText,
  }

  return speakPrompt(aiPrompt, event.priority)
}

// ============================================================================
// DIAGNOSTICS
// ============================================================================

export interface SvsDiagnostics {
  enabled: boolean
  config: SvsUserConfig
  governor: ReturnType<typeof getGovernorDiagnostics>
  detection: ReturnType<typeof getDetectionDiagnostics>
  tts: ReturnType<typeof getTtsDiagnostics>
  uptimeMinutes: number
}

export function getSvsDiagnostics(): SvsDiagnostics {
  return {
    enabled: loadSvsConfig().enabled,
    config: loadSvsConfig(),
    governor: getGovernorDiagnostics(),
    detection: getDetectionDiagnostics(),
    tts: getTtsDiagnostics(),
    uptimeMinutes: 0, // Could track actual uptime if needed
  }
}

// ============================================================================
// RESET
// ============================================================================

export function resetSvs(): void {
  resetGovernor()
  resetEventDetection()
  _resetTtsStateForTests()
  logInfo('SVS', 'Full system reset')
}

// ============================================================================
// BATTERY & PERFORMANCE
// ============================================================================

/**
 * Check if SVS should degrade based on system conditions.
 */
export function shouldDegradeSvs(batteryPercent: number | null): boolean {
  const config = loadSvsConfig()

  if (!config.enabled) return true

  if (batteryPercent !== null && batteryPercent < (config.minBatteryPercent ?? 10)) {
    return true
  }

  return false
}

/**
 * Get recommended action when degrading.
 */
export function getDegradationAction(): 'silence' | 'safety-only' | 'reduce-frequency' {
  const config = loadSvsConfig()

  if (!config.enabled) return 'silence'

  // If already minimal, go to safety-only
  if (config.frequency === 'minimal') {
    return 'safety-only'
  }

  return 'reduce-frequency'
}
