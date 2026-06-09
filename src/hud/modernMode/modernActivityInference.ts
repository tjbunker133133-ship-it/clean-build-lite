/**
 * Tier 3 activity inference — pure orchestration over existing telemetry.
 * No ML, no new sensors. Derives field activity from movement, route, weather, terrain.
 */

import type { ModernSituationalFocus } from './ModernSituationalContext'

export type ModernFieldActivity =
  | 'emergency'
  | 'driving'
  | 'biking'
  | 'hiking'
  | 'navigation'
  | 'rafting'
  | 'fishing'
  | 'camping'
  | 'climbing'
  | 'urban'
  | 'observation'
  | 'stationary'

export type ModernRuntimeTone = 'calm' | 'attentive' | 'urgent' | 'protective' | 'companion'

export type ModernSensoryProfile = {
  glanceMode: boolean
  suppressDecor: boolean
  suppressPassive: boolean
  hapticGuidance: boolean
  voicePriority: 'low' | 'normal' | 'high'
  tone: ModernRuntimeTone
}

export type ActivityInferenceInput = {
  speedMs: number
  emergency: boolean
  routeNavigating: boolean
  missionActive: boolean
  weatherIntense: boolean
  weatherStorm: boolean
  hazardOverlay: boolean
  terrainOverlay: boolean
  waterContext?: boolean
  hourLocal: number
}

export function inferModernFieldActivity(input: ActivityInferenceInput): ModernFieldActivity {
  if (input.emergency) return 'emergency'
  if (input.routeNavigating && input.speedMs >= 7) return 'driving'
  if (input.routeNavigating && input.speedMs >= 2.5) return 'biking'
  if (input.routeNavigating) return 'navigation'
  if (input.speedMs >= 7) return 'driving'
  if (input.speedMs >= 4.5 && input.waterContext) return 'rafting'
  if (input.speedMs >= 2.5) return 'biking'
  if (input.speedMs >= 0.9 && input.terrainOverlay && input.hazardOverlay) return 'climbing'
  if (input.speedMs >= 0.8 && input.speedMs < 2.5) return 'hiking'
  if (input.speedMs < 0.35 && input.weatherStorm) return 'fishing'
  if (
    input.speedMs < 0.4 &&
    !input.missionActive &&
    (input.hourLocal >= 20 || input.hourLocal < 6)
  ) {
    return 'camping'
  }
  if (input.speedMs < 0.5 && input.terrainOverlay) return 'observation'
  if (input.speedMs >= 0.5 && input.speedMs < 1.2 && !input.terrainOverlay) return 'urban'
  return 'stationary'
}

export function resolveRuntimeTone(
  activity: ModernFieldActivity,
  focus: ModernSituationalFocus,
  weatherStorm: boolean,
): ModernRuntimeTone {
  if (activity === 'emergency' || focus === 'emergency') return 'urgent'
  if (weatherStorm || focus === 'weather') return 'protective'
  if (activity === 'driving' || activity === 'biking' || activity === 'rafting') return 'attentive'
  if (activity === 'hiking' || activity === 'navigation' || activity === 'climbing') return 'companion'
  if (activity === 'fishing' || activity === 'camping' || activity === 'observation') return 'calm'
  return 'calm'
}

export function resolveSensoryProfile(
  activity: ModernFieldActivity,
  focus: ModernSituationalFocus,
  density: 'minimal' | 'balanced' | 'rich',
  speedMs: number,
): ModernSensoryProfile {
  const tone = resolveRuntimeTone(activity, focus, focus === 'weather')
  const highSpeed = speedMs >= 2.5
  const glanceMode =
    activity === 'driving' ||
    activity === 'biking' ||
    activity === 'rafting' ||
    focus === 'navigation' ||
    focus === 'driving' ||
    density === 'minimal'

  const suppressDecor =
    focus === 'emergency' ||
    focus === 'navigation' ||
    focus === 'driving' ||
    density === 'minimal' ||
    highSpeed ||
    activity === 'driving' ||
    activity === 'biking' ||
    activity === 'rafting'

  const suppressPassive =
    focus === 'emergency' ||
    density === 'minimal' ||
    glanceMode

  const hapticGuidance =
    activity === 'biking' ||
    activity === 'driving' ||
    activity === 'navigation' ||
    activity === 'rafting' ||
    focus === 'navigation'

  const voicePriority: ModernSensoryProfile['voicePriority'] =
    focus === 'emergency'
      ? 'high'
      : glanceMode
        ? 'high'
        : activity === 'fishing' || activity === 'camping'
          ? 'low'
          : 'normal'

  return {
    glanceMode,
    suppressDecor,
    suppressPassive,
    hapticGuidance,
    voicePriority,
    tone,
  }
}

/** Dev-facing runtime layer classification (Phase 1 identity audit). */
export const MODERN_RUNTIME_LAYERS = {
  operational: [
    'ModernSafetyZone',
    'ModernMapSubsystems',
    'ModernInteractionHost',
    'EnvironmentalReactionLayer',
    'ModernRouteSheet',
    'WeatherSheet',
    'MissionSheet',
  ],
  environmental: [
    'AtmosphericEnvironment',
    'ModernDirectionalAtmosphere',
    'EnvironmentalInteractionLayer',
    'RouteAtmosphereLayer',
    'ModernOverlayAtmosphere',
  ],
  sensory: ['useModernFieldIntelligence', 'HudSystemHealthBridge', 'emitHaptic'],
  emotional: ['ModernSituationalContext', 'ERL temporalMood', 'SVS companion events'],
  decorative: [
    'ModernAdaptiveDecor',
    'ModernFieldPresence',
    'ModernFieldMotionLayer',
    'ModernSubstrateVeil',
    'ModernMapTapPulse',
  ],
  redundant: ['EnvironmentalInteractionLayer.VoiceActivityIndicator'],
} as const
