/**
 * Situational Voice Support (SVS) - Delivery Governor
 *
 * CRITICAL COMPONENT: Spam prevention and delivery orchestration.
 *
 * Core responsibilities:
 * - Priority hierarchy enforcement (Safety > Operational > Supportive)
 * - Cooldown management per-prompt and per-event-type
 * - TTS state awareness (prevent overlapping speech)
 * - User silencing respect
 * - Quiet hours enforcement
 * - Mission-mode filtering
 * - Battery-aware degradation
 * - Duplicate/similar suppression
 *
 * The Governor is authoritative. Tier 3 AI must route through it.
 */

import type {
  SvsDeliveryDecision,
  SvsEvent,
  SvsEventType,
  SvsGovernorRejection,
  SvsGovernorState,
  SvsPriority,
  SvsPrompt,
  SvsUserConfig,
} from './types'
import { SVS_CONFIG_DEFAULT, SVS_PRIORITY } from './types'
import { getPromptForEvent, getAdjustedCooldown, selectPromptVariant } from './prompts'
import { logInfo, logWarn } from '../../runtime/logger'

// ============================================================================
// GOVERNOR CONSTANTS
// ============================================================================

/** Minimum time between ANY prompts (global rate limit) */
const GLOBAL_MIN_INTERVAL_MS = 8_000

/** Minimum time between supportive prompts (reduce noise) */
const SUPPORTIVE_MIN_INTERVAL_MS = 45_000

/** Session delivery cap (hard limit on chatter) */
const MAX_SESSION_DELIVERIES = 50

/** Cooldown after user silences a prompt (exponential backoff) */
const SILENCE_COOLDOWN_MS = 5 * 60 * 1000

/** Maximum silence extension */
const MAX_SILENCE_MS = 30 * 60 * 1000

/** Similar event suppression window */
const SIMILAR_EVENT_WINDOW_MS = 10 * 60 * 1000

/** Events considered "similar" for deduplication */
const SIMILAR_EVENT_GROUPS: SvsEventType[][] = [
  ['HIGH_HEART_RATE', 'EXTREME_HEART_RATE'],
  ['MISSION_LINK_LOST', 'PEER_DISCONNECTED'],
  ['MISSION_RESTORED', 'MISSION_LINK_RECOVERED', 'PEER_RECONNECTED'],
  ['HYDRATION_REMINDER', 'REST_REMINDER'],
]

// ============================================================================
// GOVERNOR STATE
// ============================================================================

let state: SvsGovernorState = {
  lastDeliveredAt: new Map(),
  lastEventAt: new Map(),
  ttsActive: false,
  currentPriority: null,
  userSilencedUntil: null,
  quietHoursActive: false,
  sessionDeliveries: 0,
  sessionStartedAt: Date.now(),
}

let config: SvsUserConfig = { ...SVS_CONFIG_DEFAULT }

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

export function initGovernor(userConfig?: Partial<SvsUserConfig>): void {
  config = { ...SVS_CONFIG_DEFAULT, ...userConfig }
  state = {
    lastDeliveredAt: new Map(),
    lastEventAt: new Map(),
    ttsActive: false,
    currentPriority: null,
    userSilencedUntil: null,
    quietHoursActive: checkQuietHours(),
    sessionDeliveries: 0,
    sessionStartedAt: Date.now(),
  }
  logInfo('SVS', 'Governor initialized', { frequency: config.frequency, mode: config.mode })
}

export function resetGovernor(): void {
  state.lastDeliveredAt.clear()
  state.lastEventAt.clear()
  state.ttsActive = false
  state.currentPriority = null
  state.userSilencedUntil = null
  state.sessionDeliveries = 0
  state.sessionStartedAt = Date.now()
  logInfo('SVS', 'Governor reset')
}

export function updateConfig(newConfig: Partial<SvsUserConfig>): void {
  config = { ...config, ...newConfig }
  state.quietHoursActive = checkQuietHours()
}

export function getGovernorState(): Readonly<SvsGovernorState> {
  return Object.freeze({ ...state })
}

// ============================================================================
// TTS STATE SYNCHRONIZATION
// ============================================================================

export function markTtsStart(priority: SvsPriority): void {
  state.ttsActive = true
  state.currentPriority = priority
}

export function markTtsEnd(): void {
  state.ttsActive = false
  state.currentPriority = null
}

export function isTtsActive(): boolean {
  return state.ttsActive
}

export function getCurrentSpeakingPriority(): SvsPriority | null {
  return state.currentPriority
}

// ============================================================================
// USER SILENCING
// ============================================================================

export function markUserSilenced(): void {
  const now = Date.now()
  const currentSilence = state.userSilencedUntil ?? now
  const remaining = Math.max(0, currentSilence - now)

  // Exponential backoff: 5min -> 10min -> 20min -> 30min (cap)
  const extension = Math.min(SILENCE_COOLDOWN_MS * (remaining > 0 ? 2 : 1), MAX_SILENCE_MS)

  state.userSilencedUntil = now + extension
  logInfo('SVS', 'User silenced', { until: new Date(state.userSilencedUntil).toISOString() })
}

export function clearUserSilence(): void {
  state.userSilencedUntil = null
}

// ============================================================================
// MAIN DELIVERY DECISION
// ============================================================================

export function evaluateDelivery(event: SvsEvent): SvsDeliveryDecision {
  const prompt = getPromptForEvent(event.type)

  if (!prompt) {
    return { action: 'suppress', reason: 'insufficient_context' }
  }

  // Priority 1: Safety checks
  const safetyCheck = checkSafetyConstraints(event, prompt)
  if (safetyCheck) return safetyCheck

  // Priority 2: User preferences
  const preferenceCheck = checkUserPreferences(event, prompt)
  if (preferenceCheck) return preferenceCheck

  // Priority 3: Rate limiting and cooldowns
  const rateCheck = checkRateLimits(event, prompt)
  if (rateCheck) return rateCheck

  // Priority 4: Similarity deduplication
  const dedupeCheck = checkSimilarity(event)
  if (dedupeCheck) return dedupeCheck

  // All checks passed - deliver
  const variant = selectPromptVariant(prompt)
  const deliverablePrompt: SvsPrompt = { ...prompt, text: variant }

  return {
    action: 'deliver',
    prompt: deliverablePrompt,
    reason: `priority-${prompt.priority}-cleared`,
  }
}

export function recordDelivery(promptId: string, eventType: SvsEventType): void {
  const now = Date.now()
  state.lastDeliveredAt.set(promptId, now)
  state.lastEventAt.set(eventType, now)
  state.sessionDeliveries++
}

// ============================================================================
// SAFETY CONSTRAINT CHECKS
// ============================================================================

function checkSafetyConstraints(
  event: SvsEvent,
  prompt: SvsPrompt,
): SvsDeliveryDecision | null {
  // Master enable check
  if (!config.enabled) {
    return { action: 'suppress', reason: 'user_silenced' }
  }

  // Mission-only mode
  if (config.missionOnly && !prompt.requiresMission && !isMissionActive()) {
    // Safety prompts still fire even without mission
    if (prompt.priority !== SVS_PRIORITY.SAFETY) {
      return { action: 'suppress', reason: 'mission_mode_required' }
    }
  }

  // Battery saver
  if (config.minBatteryPercent !== null) {
    const battery = getBatteryPercent()
    if (battery !== null && battery < config.minBatteryPercent) {
      // Only safety-critical prompts at low battery
      if (prompt.priority !== SVS_PRIORITY.SAFETY) {
        return { action: 'suppress', reason: 'battery_saver' }
      }
    }
  }

  // Quiet hours (safety overrides)
  if (state.quietHoursActive && prompt.priority !== SVS_PRIORITY.SAFETY) {
    return { action: 'suppress', reason: 'quiet_hours' }
  }

  // User silencing (safety overrides)
  if (state.userSilencedUntil !== null) {
    const now = Date.now()
    if (now < state.userSilencedUntil && prompt.priority !== SVS_PRIORITY.SAFETY) {
      return { action: 'suppress', reason: 'user_silenced' }
    }
    if (now >= state.userSilencedUntil) {
      state.userSilencedUntil = null // Auto-clear
    }
  }

  // TTS busy check
  if (state.ttsActive) {
    // Safety can interrupt anything
    if (prompt.priority === SVS_PRIORITY.SAFETY && prompt.canInterrupt) {
      return null // Allow through
    }

    // Operational can interrupt supportive
    if (
      prompt.priority === SVS_PRIORITY.OPERATIONAL &&
      prompt.canInterrupt &&
      state.currentPriority === SVS_PRIORITY.SUPPORTIVE
    ) {
      return null // Allow through
    }

    // Otherwise, suppress
    return { action: 'suppress', reason: 'tts_busy' }
  }

  return null
}

// ============================================================================
// USER PREFERENCE CHECKS
// ============================================================================

function checkUserPreferences(
  event: SvsEvent,
  prompt: SvsPrompt,
): SvsDeliveryDecision | null {
  // Mode-based filtering
  if (config.mode === 'silent') {
    return { action: 'suppress', reason: 'user_silenced' }
  }

  if (config.mode === 'tactical') {
    // Only operational and safety in tactical mode
    if (prompt.priority === SVS_PRIORITY.SUPPORTIVE) {
      return { action: 'suppress', reason: 'insufficient_context' }
    }
  }

  // Category toggles
  if (!config.wellnessPrompts && isWellnessPrompt(prompt)) {
    return { action: 'suppress', reason: 'insufficient_context' }
  }

  if (!config.environmentalPrompts && isEnvironmentalPrompt(prompt)) {
    return { action: 'suppress', reason: 'insufficient_context' }
  }

  if (!config.exertionSupport && prompt.id.includes('exertion')) {
    return { action: 'suppress', reason: 'insufficient_context' }
  }

  return null
}

// ============================================================================
// RATE LIMIT CHECKS
// ============================================================================

function checkRateLimits(event: SvsEvent, prompt: SvsPrompt): SvsDeliveryDecision | null {
  const now = Date.now()

  // Session cap
  if (state.sessionDeliveries >= MAX_SESSION_DELIVERIES) {
    // Only safety can exceed cap
    if (prompt.priority !== SVS_PRIORITY.SAFETY) {
      return { action: 'suppress', reason: 'cooldown_active' }
    }
  }

  // Global minimum interval
  const lastAny = getLastAnyDeliveryTime()
  if (lastAny !== null && now - lastAny < GLOBAL_MIN_INTERVAL_MS) {
    // Safety can override global interval (briefly)
    if (prompt.priority !== SVS_PRIORITY.SAFETY) {
      return { action: 'suppress', reason: 'cooldown_active' }
    }
  }

  // Supportive minimum interval (more strict)
  if (prompt.priority === SVS_PRIORITY.SUPPORTIVE) {
    if (lastAny !== null && now - lastAny < SUPPORTIVE_MIN_INTERVAL_MS) {
      return { action: 'suppress', reason: 'cooldown_active' }
    }
  }

  // Per-prompt cooldown
  const lastPrompt = state.lastDeliveredAt.get(prompt.id)
  const adjustedCooldown = getAdjustedCooldown(prompt.cooldownMs, config.frequency)

  if (lastPrompt !== undefined && now - lastPrompt < adjustedCooldown) {
    return { action: 'suppress', reason: 'cooldown_active' }
  }

  // Per-event-type cooldown (prevents similar rapid events)
  const lastEvent = state.lastEventAt.get(event.type)
  if (lastEvent !== undefined && now - lastEvent < adjustedCooldown) {
    return { action: 'suppress', reason: 'recently_delivered_similar' }
  }

  // Suppress-if-active check
  if (prompt.suppressIfActiveMs !== undefined) {
    const recentActivity = getRecentUserActivityTime()
    if (recentActivity !== null && now - recentActivity < prompt.suppressIfActiveMs) {
      return { action: 'suppress', reason: 'insufficient_context' }
    }
  }

  return null
}

// ============================================================================
// SIMILARITY DEDUPLICATION
// ============================================================================

function checkSimilarity(event: SvsEvent): SvsDeliveryDecision | null {
  const now = Date.now()

  for (const group of SIMILAR_EVENT_GROUPS) {
    if (!group.includes(event.type)) continue

    for (const similarType of group) {
      if (similarType === event.type) continue

      const lastSimilar = state.lastEventAt.get(similarType)
      if (lastSimilar !== undefined && now - lastSimilar < SIMILAR_EVENT_WINDOW_MS) {
        // Don't suppress safety, but log the overlap
        if (event.priority === SVS_PRIORITY.SAFETY) {
          logInfo('SVS', 'Similar safety event overlap', {
            current: event.type,
            similar: similarType,
            msAgo: now - lastSimilar,
          })
          return null
        }

        return { action: 'suppress', reason: 'recently_delivered_similar' }
      }
    }
  }

  return null
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function checkQuietHours(): boolean {
  if (config.quietHoursStart === null || config.quietHoursEnd === null) {
    return false
  }

  const hour = new Date().getHours()
  const start = config.quietHoursStart
  const end = config.quietHoursEnd

  if (start <= end) {
    return hour >= start && hour < end
  } else {
    // Wraps around midnight
    return hour >= start || hour < end
  }
}

function getLastAnyDeliveryTime(): number | null {
  let latest: number | null = null
  for (const ts of state.lastDeliveredAt.values()) {
    if (latest === null || ts > latest) {
      latest = ts
    }
  }
  return latest
}

function isWellnessPrompt(prompt: SvsPrompt): boolean {
  return (
    prompt.id.includes('hydrate') ||
    prompt.id.includes('rest') ||
    prompt.id.includes('wellness') ||
    prompt.id.includes('recovery')
  )
}

function isEnvironmentalPrompt(prompt: SvsPrompt): boolean {
  return (
    prompt.id.includes('sunset') ||
    prompt.id.includes('sunrise') ||
    prompt.id.includes('weather') ||
    prompt.id.includes('cold') ||
    prompt.id.includes('heat')
  )
}

// ============================================================================
// EXTERNAL STATE PROVIDERS (Stubs - integrated in main index)
// ============================================================================

let missionActiveFn: (() => boolean) | null = null
let batteryFn: (() => number | null) | null = null
let activityFn: (() => number | null) | null = null

export function registerStateProviders(options: {
  isMissionActive: () => boolean
  getBatteryPercent: () => number | null
  getRecentUserActivity: () => number | null
}): void {
  missionActiveFn = options.isMissionActive
  batteryFn = options.getBatteryPercent
  activityFn = options.getRecentUserActivity
}

function isMissionActive(): boolean {
  return missionActiveFn?.() ?? false
}

function getBatteryPercent(): number | null {
  return batteryFn?.() ?? null
}

function getRecentUserActivityTime(): number | null {
  return activityFn?.() ?? null
}

// ============================================================================
// DIAGNOSTIC EXPORTS
// ============================================================================

export function getGovernorDiagnostics(): Record<string, unknown> {
  return {
    deliveriesThisSession: state.sessionDeliveries,
    sessionMinutes: Math.round((Date.now() - state.sessionStartedAt) / 60000),
    uniquePromptsDelivered: state.lastDeliveredAt.size,
    ttsActive: state.ttsActive,
    currentPriority: state.currentPriority,
    userSilenced: state.userSilencedUntil !== null,
    quietHours: state.quietHoursActive,
    config: {
      enabled: config.enabled,
      frequency: config.frequency,
      mode: config.mode,
    },
  }
}
