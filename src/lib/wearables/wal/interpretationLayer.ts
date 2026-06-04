/**
 * WAL interpretation layer — readiness and suggestions only.
 * MUST NOT trigger SOS or bypass escalation state machine.
 */

import type { InterpretationSnapshot, ReadinessIndicator, WearableSignal } from './types'
import type { WalPresetConfig } from './userPresets'

export function interpretWearableSignals(
  signals: WearableSignal[],
  preset: WalPresetConfig,
  nowMs: number = Date.now(),
): InterpretationSnapshot {
  const readiness: ReadinessIndicator[] = []
  const suggestions: string[] = []
  const affirmations: string[] = []

  if (!preset.readinessEnabled && !preset.suggestionsEnabled && !preset.affirmationsEnabled) {
    return { readiness, suggestions, affirmations }
  }

  const latestHr = signals
    .filter((s) => s.type === 'heart_rate')
    .sort((a, b) => b.timestamp - a.timestamp)[0]
  const latestBattery = signals
    .filter((s) => s.type === 'battery')
    .sort((a, b) => b.timestamp - a.timestamp)[0]
  const latestMotion = signals
    .filter((s) => s.type === 'motion' || s.type === 'sleep')
    .sort((a, b) => b.timestamp - a.timestamp)[0]

  if (preset.readinessEnabled) {
    if (latestHr) {
      const bpm = typeof latestHr.value === 'number' ? latestHr.value : null
      const ageMs = nowMs - latestHr.timestamp
      if (bpm === 0 || bpm == null) {
        readiness.push({
          id: 'hr-absent',
          label: 'Heart rate',
          severity: 'warn',
          detail: 'No recent heart rate sample from companion device',
        })
      } else if (ageMs > 120_000) {
        readiness.push({
          id: 'hr-stale',
          label: 'Heart rate',
          severity: 'warn',
          detail: 'Heart rate sample is stale — refresh companion link',
        })
      } else {
        readiness.push({
          id: 'hr-ok',
          label: 'Heart rate',
          severity: 'ok',
          detail: `${bpm} bpm (advisory)`,
        })
      }
    }

    if (latestBattery && typeof latestBattery.value === 'number') {
      const pct = latestBattery.value
      readiness.push({
        id: 'battery',
        label: 'Companion battery',
        severity: pct < 15 ? 'warn' : 'ok',
        detail: `${pct}%`,
      })
    }

    if (latestMotion && nowMs - latestMotion.timestamp > 600_000) {
      readiness.push({
        id: 'motion-quiet',
        label: 'Activity',
        severity: 'info',
        detail: 'Low motion recently — context only, not an emergency trigger alone',
      })
    }
  }

  if (preset.suggestionsEnabled) {
    if (latestHr && typeof latestHr.value === 'number' && latestHr.value > 120) {
      suggestions.push('Elevated heart rate — consider pace and hydration (advisory only).')
    }
    if (latestBattery && typeof latestBattery.value === 'number' && latestBattery.value < 20) {
      suggestions.push('Companion device battery low — charge phone before extended field use.')
    }
  }

  if (preset.affirmationsEnabled) {
    affirmations.push('Field check: you are connected to your mission HUD.')
  }

  return { readiness, suggestions, affirmations }
}
