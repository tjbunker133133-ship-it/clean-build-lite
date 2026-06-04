/**
 * WAL user configuration presets — controls sensitivity and verbosity.
 * Does not alter Tier 1 SOS slide-hold behavior.
 */

import type { EscalationTriggerKind } from './types'

export type WalUserMode = 'minimal_field' | 'balanced' | 'training' | 'silent'

export type WalPresetConfig = {
  mode: WalUserMode
  label: string
  /** Auto-enter escalation_pending from these triggers (never skips timer). */
  autoEscalationTriggers: EscalationTriggerKind[]
  /** Show readiness indicators from interpretation layer */
  readinessEnabled: boolean
  /** Hydration/rest/fatigue suggestions */
  suggestionsEnabled: boolean
  /** User-controlled affirmations (training) */
  affirmationsEnabled: boolean
  /** Companion notification verbosity for escalation projections */
  notificationVerbosity: 'alerts_only' | 'standard' | 'verbose' | 'none'
  /** Default countdown before auto-confirm path (ms) — user must still be able to cancel */
  defaultEscalationTimerMs: number
}

export const WAL_PRESET_DEFAULTS: Record<WalUserMode, WalPresetConfig> = {
  minimal_field: {
    mode: 'minimal_field',
    label: 'Minimal Field',
    autoEscalationTriggers: ['user_emergency_button', 'manual_operator'],
    readinessEnabled: true,
    suggestionsEnabled: false,
    affirmationsEnabled: false,
    notificationVerbosity: 'alerts_only',
    defaultEscalationTimerMs: 60_000,
  },
  balanced: {
    mode: 'balanced',
    label: 'Balanced',
    autoEscalationTriggers: [
      'heart_rate_zero_or_absent',
      'fall_detected',
      'prolonged_inactivity',
      'user_emergency_button',
      'manual_operator',
    ],
    readinessEnabled: true,
    suggestionsEnabled: true,
    affirmationsEnabled: false,
    notificationVerbosity: 'standard',
    defaultEscalationTimerMs: 45_000,
  },
  training: {
    mode: 'training',
    label: 'Training',
    autoEscalationTriggers: [
      'heart_rate_zero_or_absent',
      'fall_detected',
      'user_emergency_button',
      'manual_operator',
    ],
    readinessEnabled: true,
    suggestionsEnabled: true,
    affirmationsEnabled: true,
    notificationVerbosity: 'verbose',
    defaultEscalationTimerMs: 45_000,
  },
  silent: {
    mode: 'silent',
    label: 'Silent',
    autoEscalationTriggers: ['manual_operator'],
    readinessEnabled: false,
    suggestionsEnabled: false,
    affirmationsEnabled: false,
    notificationVerbosity: 'none',
    defaultEscalationTimerMs: 60_000,
  },
}

const PRESET_STORAGE_KEY = 'hud_wal_user_mode_v1'

export function loadWalUserMode(): WalUserMode {
  if (typeof localStorage === 'undefined') return 'balanced'
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY)
    if (raw && raw in WAL_PRESET_DEFAULTS) return raw as WalUserMode
  } catch {
    /* ignore */
  }
  return 'balanced'
}

export function saveWalUserMode(mode: WalUserMode): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

export function getWalPresetConfig(mode: WalUserMode = loadWalUserMode()): WalPresetConfig {
  return WAL_PRESET_DEFAULTS[mode]
}

export function presetAllowsAutoEscalation(
  trigger: EscalationTriggerKind,
  mode: WalUserMode = loadWalUserMode(),
): boolean {
  return WAL_PRESET_DEFAULTS[mode].autoEscalationTriggers.includes(trigger)
}
