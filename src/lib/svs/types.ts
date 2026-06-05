/**
 * Situational Voice Support (SVS) System - Core Types
 *
 * Tier 2: Stable Local Guidance Layer
 * Deterministic, offline-capable, battery-light voice support system.
 *
 * Architecture:
 * - Event Detection Layer: Emits normalized situational events
 * - Prompt Selection Layer: Maps events to appropriate voice prompts
 * - Delivery Governor: Prevents spam, manages cooldowns, enforces priorities
 * - TTS Output Layer: Integrates with existing HUD voice infrastructure
 */

// ============================================================================
// PRIORITY HIERARCHY (Safety First)
// ============================================================================

export type SvsPriority = 1 | 2 | 3

export const SVS_PRIORITY = {
  /** Safety/Emergency: Immediate delivery, interrupts lower priority */
  SAFETY: 1 as SvsPriority,
  /** Operational: Guidance, reconnects, weather risks */
  OPERATIONAL: 2 as SvsPriority,
  /** Supportive: Morale, pacing, general situational awareness */
  SUPPORTIVE: 3 as SvsPriority,
} as const

// ============================================================================
// EVENT TYPES (Deterministic Detection)
// ============================================================================

export type SvsEventType =
  // Safety/Emergency (Priority 1)
  | 'HIGH_HEART_RATE'
  | 'EXTREME_HEART_RATE'
  | 'HEAT_WARNING'
  | 'COLD_WARNING'
  | 'LOW_BATTERY'
  | 'PROLONGED_INACTIVITY'
  | 'SOS_REMINDER'
  // Operational (Priority 2)
  | 'MISSION_RESTORED'
  | 'MISSION_LINK_LOST'
  | 'MISSION_LINK_RECOVERED'
  | 'PEER_DISCONNECTED'
  | 'PEER_RECONNECTED'
  | 'WAYPOINT_NEARBY'
  | 'WAYPOINT_ARRIVED'
  | 'OFF_ROUTE'
  | 'WEATHER_ALERT'
  | 'SUNSET_APPROACHING'
  | 'ELEVATION_MILESTONE'
  | 'BATTERY_HALF'
  | 'BATTERY_LOW'
  // Supportive (Priority 3)
  | 'LONG_EXERTION'
  | 'STEADY_PACE'
  | 'HYDRATION_REMINDER'
  | 'REST_REMINDER'
  | 'SUNRISE_GREETING'
  | 'MORNING_START'
  | 'SESSION_MILESTONE'
  | 'MOTIVATION_SUPPORT'

export interface SvsEvent {
  type: SvsEventType
  priority: SvsPriority
  timestamp: number
  /** Contextual data for prompt selection */
  payload?: SvsEventPayload
  /** Unique deduplication key */
  dedupeKey: string
}

export interface SvsEventPayload {
  // Physical/telemetry
  heartRate?: number
  heartRateZone?: 'resting' | 'low' | 'moderate' | 'high' | 'extreme'
  temperature?: number
  temperatureUnit?: 'F' | 'C'
  elevation?: number
  elevationGain?: number
  speed?: number
  speedUnit?: 'mph' | 'kph'

  // Temporal
  durationMinutes?: number
  durationHours?: number
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night'
  sunsetMinutes?: number

  // Mission/operational
  missionId?: string
  peerCallsign?: string
  waypointName?: string
  waypointDistance?: number
  waypointDistanceUnit?: 'feet' | 'miles' | 'meters' | 'km'
  weatherCondition?: string
  weatherSeverity?: 'minor' | 'moderate' | 'severe'

  // Device/state
  batteryPercent?: number
  lastPromptMinutesAgo?: number

  // Tier 3 extensibility
  aiEnrichment?: Record<string, unknown>
}

// ============================================================================
// PROMPT TYPES (Local Selection)
// ============================================================================

export type SvsTone = 'calm' | 'urgent' | 'supportive' | 'observant' | 'minimal'

export interface SvsPrompt {
  id: string
  text: string
  priority: SvsPriority
  tone: SvsTone
  /** Variants for variety (prevents robotic repetition) */
  variants?: string[]
  /** Minimum cooldown before this prompt can be repeated (ms) */
  cooldownMs: number
  /** Whether this prompt can interrupt lower priority speech */
  canInterrupt: boolean
  /** Whether this prompt requires mission mode to be active */
  requiresMission?: boolean
  /** Whether to suppress if user has been recently active */
  suppressIfActiveMs?: number
}

export type SvsPromptCategory = 'safety' | 'operational' | 'wellness' | 'morale' | 'environmental'

// ============================================================================
// GOVERNOR STATE (Spam Prevention)
// ============================================================================

export type SvsDeliveryDecision =
  | { action: 'deliver'; prompt: SvsPrompt; reason: string }
  | { action: 'suppress'; reason: SvsGovernorRejection }

export type SvsGovernorRejection =
  | 'cooldown_active'
  | 'priority_blocked'
  | 'tts_busy'
  | 'user_silenced'
  | 'quiet_hours'
  | 'recently_delivered_similar'
  | 'mission_mode_required'
  | 'insufficient_context'
  | 'battery_saver'

export interface SvsGovernorState {
  /** Last delivery timestamp per prompt ID */
  lastDeliveredAt: Map<string, number>
  /** Last delivery timestamp per event type */
  lastEventAt: Map<SvsEventType, number>
  /** Current TTS speaking state */
  ttsActive: boolean
  /** Current priority level being spoken (if any) */
  currentPriority: SvsPriority | null
  /** Whether user has recently dismissed/quieted prompts */
  userSilencedUntil: number | null
  /** Quiet hours schedule (if enabled) */
  quietHoursActive: boolean
  /** Session delivery count (for throttling) */
  sessionDeliveries: number
  /** Session start timestamp */
  sessionStartedAt: number
}

// ============================================================================
// USER CONFIGURATION
// ============================================================================

export type SvsFrequency = 'minimal' | 'balanced' | 'active'
export type SvsMode = 'tactical' | 'supportive' | 'wellness' | 'silent'

export interface SvsUserConfig {
  /** Master enable/disable */
  enabled: boolean
  /** Frequency of prompts */
  frequency: SvsFrequency
  /** Voice behavior mode */
  mode: SvsMode
  /** Only speak during active missions */
  missionOnly: boolean
  /** Supportive prompts during exertion */
  exertionSupport: boolean
  /** Wellness prompts (hydration, rest) */
  wellnessPrompts: boolean
  /** Environmental prompts (sunset, weather) */
  environmentalPrompts: boolean
  /** Quiet hours (local time) */
  quietHoursStart: number | null // 0-23
  quietHoursEnd: number | null // 0-23
  /** Minimum battery percentage to speak (null = always) */
  minBatteryPercent: number | null
  /** Cooldown multiplier (1.0 = default) */
  cooldownMultiplier: number
}

export const SVS_CONFIG_DEFAULT: SvsUserConfig = {
  enabled: true,
  frequency: 'balanced',
  mode: 'supportive',
  missionOnly: false,
  exertionSupport: true,
  wellnessPrompts: true,
  environmentalPrompts: true,
  quietHoursStart: null,
  quietHoursEnd: null,
  minBatteryPercent: 15,
  cooldownMultiplier: 1.0,
}

// ============================================================================
// RUNTIME STATE
// ============================================================================

export interface SvsRuntimeSnapshot {
  isEnabled: boolean
  currentMode: SvsMode
  lastDeliveryAt: number | null
  lastDeliveryText: string | null
  deliveriesThisSession: number
  eventsDetectedThisSession: number
  governorState: 'idle' | 'speaking' | 'cooldown' | 'suppressed'
  queueDepth: number
}

// ============================================================================
// TIER 3 EXTENSIBILITY HOOKS
// ============================================================================

export interface SvsTier3Candidate {
  /** Original Tier 2 event */
  sourceEvent: SvsEvent
  /** AI-generated prompt text (must pass governor) */
  enrichedText: string
  /** AI confidence (governor may use for filtering) */
  confidence: number
  /** Suggested priority (governor may override) */
  suggestedPriority: SvsPriority
  /** Suggested cooldown (governor may adjust) */
  suggestedCooldownMs: number
}

export type SvsTier3EnrichmentHook = (event: SvsEvent) => SvsTier3Candidate | null

// ============================================================================
// DELIVERY RESULTS
// ============================================================================

export interface SvsDeliveryResult {
  delivered: boolean
  promptId?: string
  text?: string
  timestamp: number
  rejectionReason?: SvsGovernorRejection
}

// ============================================================================
// LISTENER TYPES
// ============================================================================

export type SvsEventListener = (event: SvsEvent) => void
export type SvsDeliveryListener = (result: SvsDeliveryResult) => void
export type SvsConfigChangeListener = (config: SvsUserConfig) => void
