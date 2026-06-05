/**
 * Situational Voice Support (SVS) - Event Detection Layer
 *
 * Deterministic, lightweight event emitters that watch:
 * - GPS/motion telemetry
 * - Mission lifecycle
 * - Wearable data
 * - Environmental conditions
 * - Time-based conditions
 *
 * All detection is:
 * - Threshold-based (no ML)
 * - Offline-capable
 * - Battery-conscious
 * - Event-driven (minimal polling)
 *
 * Integration points:
 * - useGPS() for location, speed, motion
 * - MissionSyncContext for peer/link events
 * - Wearable telemetry for HR, etc.
 * - Environmental overlays for weather
 * - System APIs for battery, time
 */

import type { SvsEvent, SvsEventPayload, SvsEventType, SvsPriority } from './types'
import { SVS_PRIORITY } from './types'
import { logInfo, logWarn } from '../../runtime/logger'

// ============================================================================
// THRESHOLD CONFIGURATION
// ============================================================================

const DETECTION_THRESHOLDS = {
  // Heart rate zones (bpm)
  HR_HIGH: 160,
  HR_EXTREME: 180,
  HR_ZONE_CHANGE_DEBOUNCE_MS: 30_000,

  // Speed (mph) - contextual by activity
  SPEED_FAST_BIKING: 20,
  SPEED_STEADY_THRESHOLD: 0.5, // min movement to count as active

  // Inactivity
  INACTIVITY_WARNING_MS: 10 * 60 * 1000, // 10 min
  INACTIVITY_ALERT_MS: 20 * 60 * 1000, // 20 min

  // Elevation
  ELEVATION_MILESTONE_FT: 1000,
  ELEVATION_DEBOUNCE_MS: 5 * 60 * 1000,

  // Battery
  BATTERY_LOW_PERCENT: 20,
  BATTERY_HALF_PERCENT: 50,
  BATTERY_CRITICAL_PERCENT: 10,

  // Sunset
  SUNSET_WARNING_MINUTES: 30,

  // Session duration
  LONG_EXERTION_MINUTES: 60,
  SESSION_MILESTONE_MINUTES: 120,
  HYDRATION_REMINDER_MINUTES: 45,
  REST_REMINDER_MINUTES: 90,
} as const

// ============================================================================
// EVENT EMITTER REGISTRY
// ============================================================================

type EventListener = (event: SvsEvent) => void
const listeners = new Set<EventListener>()

let lastEmitted = new Map<SvsEventType, number>()
let detectionState = initDetectionState()

interface DetectionState {
  // HR tracking
  lastHrZone: 'low' | 'moderate' | 'high' | 'extreme' | null
  lastHrZoneChangeAt: number

  // Elevation tracking
  elevationGained: number
  lastElevationMilestone: number
  lastElevationEventAt: number

  // Session tracking
  sessionStartAt: number | null
  lastHydrationReminder: number | null
  lastRestReminder: number | null
  lastLongExertion: number | null
  lastSessionMilestone: number | null

  // Inactivity tracking
  lastMotionAt: number
  inactivityWarningEmitted: boolean

  // Battery tracking
  lastBatteryLevel: number | null
  lastBatteryWarning: number | null

  // Mission tracking
  lastMissionState: boolean
  lastPeerCount: number

  // Daily tracking
  lastDay: number
  sunriseGreetingEmitted: boolean
}

function initDetectionState(): DetectionState {
  const now = Date.now()
  return {
    lastHrZone: null,
    lastHrZoneChangeAt: 0,
    elevationGained: 0,
    lastElevationMilestone: 0,
    lastElevationEventAt: 0,
    sessionStartAt: null,
    lastHydrationReminder: null,
    lastRestReminder: null,
    lastLongExertion: null,
    lastSessionMilestone: null,
    lastMotionAt: now,
    inactivityWarningEmitted: false,
    lastBatteryLevel: null,
    lastBatteryWarning: null,
    lastMissionState: false,
    lastPeerCount: 0,
    lastDay: new Date().getDate(),
    sunriseGreetingEmitted: false,
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function subscribeSvsEvents(listener: EventListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitEvent(event: SvsEvent): void {
  // Deduplication check
  const last = lastEmitted.get(event.type)
  const now = Date.now()

  if (last !== undefined && now - last < 5000) {
    // Skip rapid duplicates
    return
  }

  lastEmitted.set(event.type, now)

  for (const listener of listeners) {
    try {
      listener(event)
    } catch (err) {
      logWarn('SVS', 'Event listener error', { error: String(err) })
    }
  }
}

export function resetEventDetection(): void {
  lastEmitted.clear()
  detectionState = initDetectionState()
  logInfo('SVS', 'Event detection reset')
}

// ============================================================================
// HEART RATE DETECTION
// ============================================================================

export function detectHeartRateEvent(heartRate: number | null): SvsEvent | null {
  if (heartRate === null) return null

  const now = Date.now()

  // Zone calculation
  let zone: DetectionState['lastHrZone']
  if (heartRate < 100) zone = 'low'
  else if (heartRate < 140) zone = 'moderate'
  else if (heartRate < DETECTION_THRESHOLDS.HR_HIGH) zone = 'high'
  else zone = 'extreme'

  // Debounce zone changes
  if (zone === detectionState.lastHrZone) {
    // Still in same zone, check if sustained extreme
    if (
      zone === 'extreme' &&
      heartRate >= DETECTION_THRESHOLDS.HR_EXTREME &&
      now - detectionState.lastHrZoneChangeAt > DETECTION_THRESHOLDS.HR_ZONE_CHANGE_DEBOUNCE_MS
    ) {
      return createEvent('EXTREME_HEART_RATE', SVS_PRIORITY.SAFETY, {
        heartRate,
        heartRateZone: zone,
      })
    }
    return null
  }

  // Zone changed
  const prevZone = detectionState.lastHrZone
  detectionState.lastHrZone = zone
  detectionState.lastHrZoneChangeAt = now

  // Only emit on entering concerning zones
  if (zone === 'extreme' && heartRate >= DETECTION_THRESHOLDS.HR_EXTREME) {
    return createEvent('EXTREME_HEART_RATE', SVS_PRIORITY.SAFETY, {
      heartRate,
      heartRateZone: zone,
    })
  }

  if (zone === 'extreme' && prevZone !== 'extreme') {
    return createEvent('HIGH_HEART_RATE', SVS_PRIORITY.SAFETY, {
      heartRate,
      heartRateZone: zone,
    })
  }

  return null
}

// ============================================================================
// MOTION & EXERTION DETECTION
// ============================================================================

export function detectMotionEvent(
  speedMph: number | null,
  isMoving: boolean,
  activityDurationMinutes: number | null,
): SvsEvent | null {
  const now = Date.now()

  // Track motion for inactivity detection
  if (isMoving && speedMph !== null && speedMph > DETECTION_THRESHOLDS.SPEED_STEADY_THRESHOLD) {
    detectionState.lastMotionAt = now
    detectionState.inactivityWarningEmitted = false
  }

  // Check for prolonged inactivity
  const inactiveMs = now - detectionState.lastMotionAt
  if (inactiveMs > DETECTION_THRESHOLDS.INACTIVITY_ALERT_MS && !detectionState.inactivityWarningEmitted) {
    detectionState.inactivityWarningEmitted = true
    return createEvent('PROLONGED_INACTIVITY', SVS_PRIORITY.SAFETY, {
      durationMinutes: Math.round(inactiveMs / 60000),
    })
  }

  // Long exertion detection
  if (
    activityDurationMinutes !== null &&
    activityDurationMinutes >= DETECTION_THRESHOLDS.LONG_EXERTION_MINUTES
  ) {
    const last = detectionState.lastLongExertion
    if (last === null || now - last > 60 * 60 * 1000) {
      detectionState.lastLongExertion = now
      return createEvent('LONG_EXERTION', SVS_PRIORITY.SUPPORTIVE, {
        durationMinutes: activityDurationMinutes,
      })
    }
  }

  // Steady pace detection
  if (speedMph !== null && speedMph > 5) {
    // Only emit occasionally during steady movement
    const lastSteady = lastEmitted.get('STEADY_PACE')
    if (lastSteady === undefined || now - lastSteady > 30 * 60 * 1000) {
      return createEvent('STEADY_PACE', SVS_PRIORITY.SUPPORTIVE, { speed: speedMph })
    }
  }

  return null
}

// ============================================================================
// BATTERY DETECTION
// ============================================================================

export function detectBatteryEvent(batteryPercent: number | null): SvsEvent | null {
  if (batteryPercent === null) return null

  const prevLevel = detectionState.lastBatteryLevel
  detectionState.lastBatteryLevel = batteryPercent

  // Critical battery
  if (batteryPercent <= DETECTION_THRESHOLDS.BATTERY_CRITICAL_PERCENT) {
    const lastWarn = detectionState.lastBatteryWarning
    if (lastWarn === null || Date.now() - lastWarn > 5 * 60 * 1000) {
      detectionState.lastBatteryWarning = Date.now()
      return createEvent('LOW_BATTERY', SVS_PRIORITY.SAFETY, { batteryPercent })
    }
  }

  // Low battery (transition into)
  if (
    batteryPercent <= DETECTION_THRESHOLDS.BATTERY_LOW_PERCENT &&
    prevLevel !== null &&
    prevLevel > DETECTION_THRESHOLDS.BATTERY_LOW_PERCENT
  ) {
    return createEvent('BATTERY_LOW', SVS_PRIORITY.OPERATIONAL, { batteryPercent })
  }

  // Half battery (transition into)
  if (
    batteryPercent <= DETECTION_THRESHOLDS.BATTERY_HALF_PERCENT &&
    prevLevel !== null &&
    prevLevel > DETECTION_THRESHOLDS.BATTERY_HALF_PERCENT
  ) {
    return createEvent('BATTERY_HALF', SVS_PRIORITY.OPERATIONAL, { batteryPercent })
  }

  return null
}

// ============================================================================
// ELEVATION DETECTION
// ============================================================================

export function detectElevationEvent(
  elevationFt: number | null,
  elevationGain: number | null,
): SvsEvent | null {
  if (elevationFt === null) return null

  const now = Date.now()

  // Track elevation gain
  if (elevationGain !== null) {
    detectionState.elevationGained = elevationGain

    // Milestone detection
    const milestone = Math.floor(elevationGain / DETECTION_THRESHOLDS.ELEVATION_MILESTONE_FT)
    if (
      milestone > detectionState.lastElevationMilestone &&
      now - detectionState.lastElevationEventAt > DETECTION_THRESHOLDS.ELEVATION_DEBOUNCE_MS
    ) {
      detectionState.lastElevationMilestone = milestone
      detectionState.lastElevationEventAt = now
      return createEvent('ELEVATION_MILESTONE', SVS_PRIORITY.OPERATIONAL, {
        elevation: elevationFt,
        elevationGain,
      })
    }
  }

  return null
}

// ============================================================================
// MISSION & PEER DETECTION
// ============================================================================

export function detectMissionEvent(
  missionActive: boolean,
  wasRestored: boolean,
  linkLost: boolean,
  linkRecovered: boolean,
): SvsEvent | null {
  const prevState = detectionState.lastMissionState
  detectionState.lastMissionState = missionActive

  // Mission restored
  if (wasRestored && !prevState) {
    return createEvent('MISSION_RESTORED', SVS_PRIORITY.OPERATIONAL, {})
  }

  // Link lost
  if (linkLost) {
    return createEvent('MISSION_LINK_LOST', SVS_PRIORITY.OPERATIONAL, {})
  }

  // Link recovered
  if (linkRecovered) {
    return createEvent('MISSION_LINK_RECOVERED', SVS_PRIORITY.OPERATIONAL, {})
  }

  return null
}

export function detectPeerEvent(peerCount: number, prevPeerCount: number): SvsEvent | null {
  if (peerCount < detectionState.lastPeerCount) {
    // Peer disconnected
    detectionState.lastPeerCount = peerCount
    return createEvent('PEER_DISCONNECTED', SVS_PRIORITY.OPERATIONAL, {})
  }

  if (peerCount > detectionState.lastPeerCount && prevPeerCount > 0) {
    // Peer reconnected (not initial connection)
    detectionState.lastPeerCount = peerCount
    return createEvent('PEER_RECONNECTED', SVS_PRIORITY.OPERATIONAL, {})
  }

  detectionState.lastPeerCount = peerCount
  return null
}

// ============================================================================
// WAYPOINT DETECTION
// ============================================================================

export function detectWaypointEvent(
  distanceToWaypoint: number | null,
  waypointName: string | null,
  arrived: boolean,
): SvsEvent | null {
  if (!waypointName) return null

  if (arrived) {
    return createEvent('WAYPOINT_ARRIVED', SVS_PRIORITY.OPERATIONAL, {
      waypointName,
    })
  }

  if (distanceToWaypoint !== null && distanceToWaypoint < 500) {
    // Within 500 feet (or meters - unit agnostic)
    const lastNearby = lastEmitted.get('WAYPOINT_NEARBY')
    const now = Date.now()
    if (lastNearby === undefined || now - lastNearby > 60_000) {
      return createEvent('WAYPOINT_NEARBY', SVS_PRIORITY.OPERATIONAL, {
        waypointName,
        waypointDistance: distanceToWaypoint,
      })
    }
  }

  return null
}

// ============================================================================
// ROUTE DETECTION
// ============================================================================

export function detectOffRouteEvent(
  offRoute: boolean,
  offRouteFeet: number | null,
): SvsEvent | null {
  if (!offRoute) return null

  const lastOffRoute = lastEmitted.get('OFF_ROUTE')
  const now = Date.now()

  // Debounce off-route alerts
  if (lastOffRoute === undefined || now - lastOffRoute > 5 * 60 * 1000) {
    return createEvent('OFF_ROUTE', SVS_PRIORITY.OPERATIONAL, {
      waypointDistance: offRouteFeet ?? undefined,
      waypointDistanceUnit: 'feet',
    })
  }

  return null
}

// ============================================================================
// ENVIRONMENTAL DETECTION
// ============================================================================

export function detectWeatherEvent(
  temperature: number | null,
  heatIndex: number | null,
  windChill: number | null,
): SvsEvent | null {
  if (temperature === null) return null

  // Heat warning
  if (heatIndex !== null && heatIndex > 90) {
    const lastHeat = lastEmitted.get('HEAT_WARNING')
    const now = Date.now()
    if (lastHeat === undefined || now - lastHeat > 20 * 60 * 1000) {
      return createEvent('HEAT_WARNING', SVS_PRIORITY.SAFETY, {
        temperature,
        temperatureUnit: 'F',
      })
    }
  }

  // Cold warning
  if (windChill !== null && windChill < 20) {
    const lastCold = lastEmitted.get('COLD_WARNING')
    const now = Date.now()
    if (lastCold === undefined || now - lastCold > 20 * 60 * 1000) {
      return createEvent('COLD_WARNING', SVS_PRIORITY.SAFETY, {
        temperature,
        temperatureUnit: 'F',
      })
    }
  }

  return null
}

export function detectSunsetEvent(
  sunsetMinutes: number | null,
  isDark: boolean,
): SvsEvent | null {
  if (sunsetMinutes === null || isDark) return null

  if (
    sunsetMinutes <= DETECTION_THRESHOLDS.SUNSET_WARNING_MINUTES &&
    sunsetMinutes > DETECTION_THRESHOLDS.SUNSET_WARNING_MINUTES - 5
  ) {
    // Only emit in the 5-minute window approaching the threshold
    const lastSunset = lastEmitted.get('SUNSET_APPROACHING')
    if (lastSunset === undefined) {
      return createEvent('SUNSET_APPROACHING', SVS_PRIORITY.OPERATIONAL, { sunsetMinutes })
    }
  }

  return null
}

// ============================================================================
// SESSION/WELLNESS DETECTION
// ============================================================================

export function detectSessionStart(): SvsEvent | null {
  const now = Date.now()

  // New day check for greeting
  const today = new Date().getDate()
  if (today !== detectionState.lastDay) {
    detectionState.lastDay = today
    detectionState.sunriseGreetingEmitted = false
  }

  const hour = new Date().getHours()

  // Morning greeting (6-10 AM, once per day)
  if (hour >= 6 && hour < 10 && !detectionState.sunriseGreetingEmitted) {
    detectionState.sunriseGreetingEmitted = true
    return createEvent('SUNRISE_GREETING', SVS_PRIORITY.SUPPORTIVE, {
      timeOfDay: 'morning',
    })
  }

  // Session start
  if (detectionState.sessionStartAt === null) {
    detectionState.sessionStartAt = now
    return createEvent('MORNING_START', SVS_PRIORITY.SUPPORTIVE, {})
  }

  return null
}

export function detectWellnessReminders(activityMinutes: number | null): SvsEvent | null {
  if (activityMinutes === null || detectionState.sessionStartAt === null) return null

  const now = Date.now()

  // Hydration reminder
  const lastHydration = detectionState.lastHydrationReminder ?? detectionState.sessionStartAt
  const minsSinceHydration = (now - lastHydration) / 60000
  if (minsSinceHydration >= DETECTION_THRESHOLDS.HYDRATION_REMINDER_MINUTES) {
    detectionState.lastHydrationReminder = now
    return createEvent('HYDRATION_REMINDER', SVS_PRIORITY.SUPPORTIVE, {
      durationMinutes: activityMinutes,
    })
  }

  // Rest reminder
  const lastRest = detectionState.lastRestReminder ?? detectionState.sessionStartAt
  const minsSinceRest = (now - lastRest) / 60000
  if (minsSinceRest >= DETECTION_THRESHOLDS.REST_REMINDER_MINUTES) {
    detectionState.lastRestReminder = now
    return createEvent('REST_REMINDER', SVS_PRIORITY.SUPPORTIVE, {
      durationMinutes: activityMinutes,
    })
  }

  // Session milestone
  const lastMilestone = detectionState.lastSessionMilestone ?? detectionState.sessionStartAt
  const minsSinceMilestone = (now - lastMilestone) / 60000
  if (minsSinceMilestone >= DETECTION_THRESHOLDS.SESSION_MILESTONE_MINUTES) {
    detectionState.lastSessionMilestone = now
    return createEvent('SESSION_MILESTONE', SVS_PRIORITY.SUPPORTIVE, {
      durationMinutes: activityMinutes,
    })
  }

  return null
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function createEvent(
  type: SvsEventType,
  priority: SvsPriority,
  payload: Omit<SvsEventPayload, 'lastPromptMinutesAgo'>,
): SvsEvent {
  const last = lastEmitted.get(type)
  const lastPromptMinutesAgo = last !== undefined ? Math.round((Date.now() - last) / 60000) : undefined

  return {
    type,
    priority,
    timestamp: Date.now(),
    payload: { ...payload, lastPromptMinutesAgo },
    dedupeKey: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }
}

export function getDetectionDiagnostics(): Record<string, unknown> {
  return {
    hrZone: detectionState.lastHrZone,
    elevationGained: detectionState.elevationGained,
    sessionMinutes: detectionState.sessionStartAt
      ? Math.round((Date.now() - detectionState.sessionStartAt) / 60000)
      : null,
    inactiveMinutes: Math.round((Date.now() - detectionState.lastMotionAt) / 60000),
    lastBattery: detectionState.lastBatteryLevel,
    eventsEmitted: lastEmitted.size,
  }
}
