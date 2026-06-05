/**
 * Situational Voice Support (SVS) - User Configuration
 *
 * Lightweight settings with localStorage persistence.
 * Minimal UI surface area - respects low-noise HUD philosophy.
 */

import type { SvsFrequency, SvsMode, SvsUserConfig } from './types'
import { SVS_CONFIG_DEFAULT } from './types'
import { logInfo, logWarn } from '../../runtime/logger'

const STORAGE_KEY = 'hud_svs_config_v1'

// ============================================================================
// STATE
// ============================================================================

let cachedConfig: SvsUserConfig | null = null
let changeListeners: ((config: SvsUserConfig) => void)[] = []

// ============================================================================
// PUBLIC API
// ============================================================================

export function loadSvsConfig(): SvsUserConfig {
  if (cachedConfig !== null) {
    return cachedConfig
  }

  if (typeof localStorage === 'undefined') {
    return { ...SVS_CONFIG_DEFAULT }
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<SvsUserConfig>
      cachedConfig = sanitizeConfig({ ...SVS_CONFIG_DEFAULT, ...parsed })
      return cachedConfig
    }
  } catch (err) {
    logWarn('SVS', 'Config load failed', { error: String(err) })
  }

  cachedConfig = { ...SVS_CONFIG_DEFAULT }
  return cachedConfig
}

export function saveSvsConfig(config: SvsUserConfig): void {
  const sanitized = sanitizeConfig(config)
  cachedConfig = sanitized

  if (typeof localStorage === 'undefined') {
    return
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized))
    notifyListeners(sanitized)
    logInfo('SVS', 'Config saved', { mode: sanitized.mode, frequency: sanitized.frequency })
  } catch (err) {
    logWarn('SVS', 'Config save failed', { error: String(err) })
  }
}

export function updateSvsConfig(patch: Partial<SvsUserConfig>): void {
  const current = loadSvsConfig()
  const updated = { ...current, ...patch }
  saveSvsConfig(updated)
}

export function resetSvsConfig(): void {
  cachedConfig = { ...SVS_CONFIG_DEFAULT }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
  notifyListeners(cachedConfig)
  logInfo('SVS', 'Config reset to defaults')
}

export function subscribeConfigChanges(listener: (config: SvsUserConfig) => void): () => void {
  changeListeners.push(listener)
  return () => {
    changeListeners = changeListeners.filter((l) => l !== listener)
  }
}

// ============================================================================
// PRESET CONFIGURATIONS
// ============================================================================

export const SVS_PRESETS: Record<string, SvsUserConfig> = {
  tactical: {
    ...SVS_CONFIG_DEFAULT,
    mode: 'tactical',
    frequency: 'minimal',
    wellnessPrompts: false,
    environmentalPrompts: false,
    exertionSupport: false,
  },
  expedition: {
    ...SVS_CONFIG_DEFAULT,
    mode: 'supportive',
    frequency: 'balanced',
    missionOnly: true,
    wellnessPrompts: true,
    environmentalPrompts: true,
  },
  wellness: {
    ...SVS_CONFIG_DEFAULT,
    mode: 'wellness',
    frequency: 'active',
    wellnessPrompts: true,
    exertionSupport: true,
  },
  silent: {
    ...SVS_CONFIG_DEFAULT,
    enabled: false,
    mode: 'silent',
  },
} as const

export function applyPreset(presetName: keyof typeof SVS_PRESETS): void {
  const preset = SVS_PRESETS[presetName]
  if (preset) {
    saveSvsConfig(preset)
  }
}

// ============================================================================
// VALIDATION & SANITIZATION
// ============================================================================

function sanitizeConfig(config: SvsUserConfig): SvsUserConfig {
  return {
    enabled: Boolean(config.enabled),
    frequency: validateFrequency(config.frequency),
    mode: validateMode(config.mode),
    missionOnly: Boolean(config.missionOnly),
    exertionSupport: Boolean(config.exertionSupport),
    wellnessPrompts: Boolean(config.wellnessPrompts),
    environmentalPrompts: Boolean(config.environmentalPrompts),
    quietHoursStart: validateHour(config.quietHoursStart),
    quietHoursEnd: validateHour(config.quietHoursEnd),
    minBatteryPercent: validateBatteryPercent(config.minBatteryPercent),
    cooldownMultiplier: validateCooldownMultiplier(config.cooldownMultiplier),
  }
}

function validateFrequency(freq: unknown): SvsFrequency {
  if (freq === 'minimal' || freq === 'balanced' || freq === 'active') {
    return freq
  }
  return 'balanced'
}

function validateMode(mode: unknown): SvsMode {
  if (mode === 'tactical' || mode === 'supportive' || mode === 'wellness' || mode === 'silent') {
    return mode
  }
  return 'supportive'
}

function validateHour(hour: unknown): number | null {
  if (hour === null) return null
  const num = Number(hour)
  if (Number.isInteger(num) && num >= 0 && num <= 23) {
    return num
  }
  return null
}

function validateBatteryPercent(val: unknown): number | null {
  if (val === null) return null
  const num = Number(val)
  if (num >= 0 && num <= 100) {
    return num
  }
  return null
}

function validateCooldownMultiplier(val: unknown): number {
  const num = Number(val)
  if (num >= 0.5 && num <= 3.0) {
    return Math.round(num * 10) / 10
  }
  return 1.0
}

function notifyListeners(config: SvsUserConfig): void {
  for (const listener of changeListeners) {
    try {
      listener(config)
    } catch {
      // Ignore listener errors
    }
  }
}

// ============================================================================
// CONFIG UI HELPERS
// ============================================================================

export function getFrequencyLabel(freq: SvsFrequency): string {
  switch (freq) {
    case 'minimal':
      return 'Minimal (Safety only)'
    case 'balanced':
      return 'Balanced'
    case 'active':
      return 'Active (More prompts)'
  }
}

export function getModeLabel(mode: SvsMode): string {
  switch (mode) {
    case 'tactical':
      return 'Tactical (Operations only)'
    case 'supportive':
      return 'Supportive (Full guidance)'
    case 'wellness':
      return 'Wellness (Health focus)'
    case 'silent':
      return 'Silent (Off)'
  }
}

export function getModeDescription(mode: SvsMode): string {
  switch (mode) {
    case 'tactical':
      return 'Only operational and safety alerts. No wellness or morale prompts.'
    case 'supportive':
      return 'Balanced operational, safety, and situational support.'
    case 'wellness':
      return 'Prioritizes hydration, rest reminders, and health awareness.'
    case 'silent':
      return 'No situational voice prompts. Voice commands still work.'
  }
}
