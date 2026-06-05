/**
 * Situational Voice Support (SVS) - Prompt Library
 *
 * Local, deterministic prompt selection.
 * No AI generation in Tier 2 - pre-authored prompts only.
 *
 * Tone guidelines:
 * - Calm: Safety, operational (urgent but not panicked)
 * - Supportive: Wellness, morale (warm but not cheesy)
 * - Observant: Environmental, situational (neutral awareness)
 * - Minimal: Battery-conscious, brief contexts (short, direct)
 *
 * All prompts are:
 * - Field-capable (works in wind, exertion)
 * - Non-therapy (no emotional manipulation)
 * - Operationally relevant
 * - Sparsely used (governor-enforced)
 */

import type { SvsEventType, SvsPrompt, SvsPriority } from './types'
import { SVS_PRIORITY } from './types'

// ============================================================================
// SAFETY PROMPTS (Priority 1) - Can interrupt, urgent tone
// ============================================================================

const SAFETY_PROMPTS: Map<SvsEventType, SvsPrompt> = new Map([
  [
    'HIGH_HEART_RATE',
    {
      id: 'hr-high',
      text: 'Heart rate elevated. Consider slowing briefly.',
      variants: ['Elevated heart rate. Take a moment.', 'Heart rate high. Slow down if needed.'],
      priority: SVS_PRIORITY.SAFETY,
      tone: 'calm',
      cooldownMs: 5 * 60 * 1000, // 5 min
      canInterrupt: true,
    },
  ],
  [
    'EXTREME_HEART_RATE',
    {
      id: 'hr-extreme',
      text: 'Heart rate very high. Stop and assess.',
      variants: ['Extreme heart rate. Stop now.', 'Very high heart rate. Rest immediately.'],
      priority: SVS_PRIORITY.SAFETY,
      tone: 'urgent',
      cooldownMs: 10 * 60 * 1000, // 10 min
      canInterrupt: true,
    },
  ],
  [
    'HEAT_WARNING',
    {
      id: 'heat-warning',
      text: 'Heat stress risk. Find shade and hydrate.',
      variants: ['Hot conditions. Shade and water.', 'Heat warning. Rest and hydrate.'],
      priority: SVS_PRIORITY.SAFETY,
      tone: 'urgent',
      cooldownMs: 15 * 60 * 1000, // 15 min
      canInterrupt: true,
    },
  ],
  [
    'COLD_WARNING',
    {
      id: 'cold-warning',
      text: 'Cold stress conditions. Check extremities.',
      variants: ['Cold warning. Stay warm.', 'Freezing conditions. Watch for frostbite.'],
      priority: SVS_PRIORITY.SAFETY,
      tone: 'calm',
      cooldownMs: 20 * 60 * 1000, // 20 min
      canInterrupt: true,
    },
  ],
  [
    'LOW_BATTERY',
    {
      id: 'battery-critical',
      text: 'Battery critical. Preserve power or return.',
      variants: ['Battery very low. Turn off non-essentials.', 'Critical battery. Consider return route.'],
      priority: SVS_PRIORITY.SAFETY,
      tone: 'urgent',
      cooldownMs: 10 * 60 * 1000, // 10 min
      canInterrupt: true,
    },
  ],
  [
    'PROLONGED_INACTIVITY',
    {
      id: 'inactivity-alert',
      text: 'Motion not detected. Check in if able.',
      variants: ['No movement detected. Are you okay?', 'Inactivity alert. Press check-in if safe.'],
      priority: SVS_PRIORITY.SAFETY,
      tone: 'calm',
      cooldownMs: 5 * 60 * 1000, // 5 min (repeating)
      canInterrupt: true,
    },
  ],
  [
    'SOS_REMINDER',
    {
      id: 'sos-armed',
      text: 'SOS panel armed. Hold to cancel if safe.',
      variants: ['Emergency timer running. Cancel if not needed.'],
      priority: SVS_PRIORITY.SAFETY,
      tone: 'urgent',
      cooldownMs: 30 * 1000, // 30 sec (rapid during countdown)
      canInterrupt: true,
    },
  ],
])

// ============================================================================
// OPERATIONAL PROMPTS (Priority 2) - Important, non-interrupting
// ============================================================================

const OPERATIONAL_PROMPTS: Map<SvsEventType, SvsPrompt> = new Map([
  [
    'MISSION_RESTORED',
    {
      id: 'mission-restored',
      text: 'Mission link restored.',
      variants: ['Back online with team.', 'Mission connection resumed.'],
      priority: SVS_PRIORITY.OPERATIONAL,
      tone: 'observant',
      cooldownMs: 60 * 1000, // 1 min
      canInterrupt: false,
    },
  ],
  [
    'MISSION_LINK_LOST',
    {
      id: 'mission-lost',
      text: 'Mission link lost. Working to reconnect.',
      variants: ['Lost connection to team. Reconnecting.', 'Mission link dropped. Standby.'],
      priority: SVS_PRIORITY.OPERATIONAL,
      tone: 'calm',
      cooldownMs: 2 * 60 * 1000, // 2 min
      canInterrupt: false,
    },
  ],
  [
    'MISSION_LINK_RECOVERED',
    {
      id: 'mission-recovered',
      text: 'Mission link recovered.',
      variants: ['Reconnected to team.', 'Link restored.'],
      priority: SVS_PRIORITY.OPERATIONAL,
      tone: 'observant',
      cooldownMs: 60 * 1000,
      canInterrupt: false,
    },
  ],
  [
    'PEER_DISCONNECTED',
    {
      id: 'peer-lost',
      text: 'Teammate link dropped.',
      priority: SVS_PRIORITY.OPERATIONAL,
      tone: 'observant',
      cooldownMs: 3 * 60 * 1000,
      canInterrupt: false,
    },
  ],
  [
    'PEER_RECONNECTED',
    {
      id: 'peer-back',
      text: 'Teammate reconnected.',
      priority: SVS_PRIORITY.OPERATIONAL,
      tone: 'observant',
      cooldownMs: 60 * 1000,
      canInterrupt: false,
    },
  ],
  [
    'WAYPOINT_NEARBY',
    {
      id: 'waypoint-close',
      text: 'Waypoint approaching.',
      variants: ['Near waypoint.', 'Approaching destination.'],
      priority: SVS_PRIORITY.OPERATIONAL,
      tone: 'observant',
      cooldownMs: 30 * 1000,
      canInterrupt: false,
      suppressIfActiveMs: 5 * 1000,
    },
  ],
  [
    'WAYPOINT_ARRIVED',
    {
      id: 'waypoint-arrived',
      text: 'Waypoint reached.',
      variants: ['Arrived at waypoint.', 'Destination reached.'],
      priority: SVS_PRIORITY.OPERATIONAL,
      tone: 'supportive',
      cooldownMs: 60 * 1000,
      canInterrupt: false,
    },
  ],
  [
    'OFF_ROUTE',
    {
      id: 'off-route',
      text: 'Off route. Check map for direction.',
      variants: ['Drifting from route. Verify heading.', 'Route deviation. Check navigation.'],
      priority: SVS_PRIORITY.OPERATIONAL,
      tone: 'calm',
      cooldownMs: 2 * 60 * 1000,
      canInterrupt: false,
    },
  ],
  [
    'WEATHER_ALERT',
    {
      id: 'weather-alert',
      text: 'Weather change ahead. Monitor conditions.',
      variants: ['Weather alert. Stay aware.', 'Conditions changing. Watch sky.'],
      priority: SVS_PRIORITY.OPERATIONAL,
      tone: 'calm',
      cooldownMs: 10 * 60 * 1000,
      canInterrupt: false,
    },
  ],
  [
    'SUNSET_APPROACHING',
    {
      id: 'sunset-warning',
      text: 'Sunset approaching. Plan accordingly.',
      variants: ['Thirty minutes to sunset.', 'Light fading soon.'],
      priority: SVS_PRIORITY.OPERATIONAL,
      tone: 'observant',
      cooldownMs: 60 * 60 * 1000, // 1 hour
      canInterrupt: false,
    },
  ],
  [
    'ELEVATION_MILESTONE',
    {
      id: 'elevation-k',
      text: 'Elevation milestone reached.',
      variants: ['Thousand feet gained.', 'Solid ascent.'],
      priority: SVS_PRIORITY.OPERATIONAL,
      tone: 'supportive',
      cooldownMs: 30 * 60 * 1000, // 30 min
      canInterrupt: false,
    },
  ],
  [
    'BATTERY_HALF',
    {
      id: 'battery-half',
      text: 'Battery at half. Monitor usage.',
      variants: ['Fifty percent battery.', 'Half battery remaining.'],
      priority: SVS_PRIORITY.OPERATIONAL,
      tone: 'observant',
      cooldownMs: 30 * 60 * 1000,
      canInterrupt: false,
    },
  ],
  [
    'BATTERY_LOW',
    {
      id: 'battery-low',
      text: 'Battery low. Consider return.',
      variants: ['Twenty percent battery. Plan exit.', 'Low battery. Conserve mode.'],
      priority: SVS_PRIORITY.OPERATIONAL,
      tone: 'calm',
      cooldownMs: 10 * 60 * 1000,
      canInterrupt: false,
    },
  ],
])

// ============================================================================
// SUPPORTIVE PROMPTS (Priority 3) - Morale, pacing, wellness
// ============================================================================

const SUPPORTIVE_PROMPTS: Map<SvsEventType, SvsPrompt> = new Map([
  [
    'LONG_EXERTION',
    {
      id: 'long-effort',
      text: 'You have maintained a strong pace.',
      variants: ['Steady work. Conserve energy for return.', 'Good effort. Reserve something for later.'],
      priority: SVS_PRIORITY.SUPPORTIVE,
      tone: 'supportive',
      cooldownMs: 20 * 60 * 1000,
      canInterrupt: false,
    },
  ],
  [
    'STEADY_PACE',
    {
      id: 'steady-pace',
      text: 'Pace is steady.',
      variants: ['Good rhythm.', 'Consistent progress.'],
      priority: SVS_PRIORITY.SUPPORTIVE,
      tone: 'supportive',
      cooldownMs: 30 * 60 * 1000,
      canInterrupt: false,
    },
  ],
  [
    'HYDRATION_REMINDER',
    {
      id: 'hydrate',
      text: 'Hydration check.',
      variants: ['Time for water.', 'Drink if you have it.'],
      priority: SVS_PRIORITY.SUPPORTIVE,
      tone: 'observant',
      cooldownMs: 45 * 60 * 1000, // 45 min
      canInterrupt: false,
    },
  ],
  [
    'REST_REMINDER',
    {
      id: 'rest-suggested',
      text: 'Consider a brief pause when safe.',
      variants: ['Good spot for a break ahead.', 'Rest when convenient.'],
      priority: SVS_PRIORITY.SUPPORTIVE,
      tone: 'supportive',
      cooldownMs: 60 * 60 * 1000, // 1 hour
      canInterrupt: false,
    },
  ],
  [
    'SUNRISE_GREETING',
    {
      id: 'morning-start',
      text: 'Good morning. Conditions look favorable.',
      variants: ['Morning. Ready when you are.', 'Daylight. Good time to begin.'],
      priority: SVS_PRIORITY.SUPPORTIVE,
      tone: 'supportive',
      cooldownMs: 24 * 60 * 60 * 1000, // once per day
      canInterrupt: false,
    },
  ],
  [
    'MORNING_START',
    {
      id: 'session-start',
      text: 'Session started. Stay aware.',
      variants: ['Tracking active.', 'Ready to record.'],
      priority: SVS_PRIORITY.SUPPORTIVE,
      tone: 'observant',
      cooldownMs: 60 * 60 * 1000,
      canInterrupt: false,
    },
  ],
  [
    'SESSION_MILESTONE',
    {
      id: 'duration-milestone',
      text: 'Two hours active. Assess your energy.',
      variants: ['Halfway through a solid session.', 'Going well. Check in with yourself.'],
      priority: SVS_PRIORITY.SUPPORTIVE,
      tone: 'supportive',
      cooldownMs: 60 * 60 * 1000,
      canInterrupt: false,
    },
  ],
  [
    'MOTIVATION_SUPPORT',
    {
      id: 'morale-boost',
      text: 'Progress looks good.',
      variants: ['Moving well.', 'Strong session.'],
      priority: SVS_PRIORITY.SUPPORTIVE,
      tone: 'supportive',
      cooldownMs: 45 * 60 * 1000,
      canInterrupt: false,
    },
  ],
])

// ============================================================================
// PROMPT REGISTRY
// ============================================================================

const ALL_PROMPTS: Map<SvsEventType, SvsPrompt> = new Map([
  ...SAFETY_PROMPTS,
  ...OPERATIONAL_PROMPTS,
  ...SUPPORTIVE_PROMPTS,
])

export function getPromptForEvent(eventType: SvsEventType): SvsPrompt | undefined {
  return ALL_PROMPTS.get(eventType)
}

export function getAllPromptsForPriority(priority: SvsPriority): SvsPrompt[] {
  return Array.from(ALL_PROMPTS.values()).filter((p) => p.priority === priority)
}

export function getPromptCount(): number {
  return ALL_PROMPTS.size
}

export function hasPromptForEvent(eventType: SvsEventType): boolean {
  return ALL_PROMPTS.has(eventType)
}

/**
 * Select a variant for variety while maintaining determinism.
 * Uses time-based selection to prevent robotic repetition.
 */
export function selectPromptVariant(prompt: SvsPrompt): string {
  if (!prompt.variants || prompt.variants.length === 0) {
    return prompt.text
  }

  const allVariants = [prompt.text, ...prompt.variants]
  const hour = new Date().getHours()
  const index = hour % allVariants.length
  return allVariants[index]!
}

/**
 * Get adjusted cooldown based on user frequency preference.
 */
export function getAdjustedCooldown(
  baseCooldownMs: number,
  frequency: 'minimal' | 'balanced' | 'active',
): number {
  switch (frequency) {
    case 'minimal':
      return baseCooldownMs * 2.5
    case 'balanced':
      return baseCooldownMs
    case 'active':
      return baseCooldownMs * 0.6
  }
}
