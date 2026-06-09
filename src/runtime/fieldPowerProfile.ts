/**
 * Field power profile — battery-aware cadence scaling for prolonged field use.
 * Extends runtimeActivityPolicy; does NOT alter Tier 1 GPS or core spatial pipelines.
 */

import { getRuntimeActivityLevel, type RuntimeActivityLevel } from './runtimeActivityPolicy'
import { markRuntimeUserEngagement } from './runtimeActivityPolicy'

export type FieldPowerTier = 'NORMAL' | 'CONSERVATIVE' | 'LOW_POWER' | 'THERMAL'

export type FieldPowerSnapshot = {
  tier: FieldPowerTier
  batteryPercent: number | null
  batteryCharging: boolean
  saveData: boolean
  navigationLowPower: boolean
  idleMotionSuppressed: boolean
  atmosphericCadenceMultiplier: number
  lowThermalMode: boolean
  sessionUptimeMs: number
  maxAtmosphericFps: number
}

const sessionStartMs = Date.now()
let tier: FieldPowerTier = 'NORMAL'
let batteryPercent: number | null = null
let batteryCharging = false
let saveData = false
let navigationActive = false
let installed = false

const LOW_BATTERY = 20
const CONSERVATIVE_BATTERY = 35

function readSaveData(): boolean {
  if (typeof navigator === 'undefined') return false
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return conn?.saveData === true
}

function deriveTier(): FieldPowerTier {
  if (typeof window !== 'undefined' && (window as Window & { __HUD_FORCE_THERMAL__?: boolean }).__HUD_FORCE_THERMAL__) {
    return 'THERMAL'
  }
  if (batteryPercent != null && !batteryCharging) {
    if (batteryPercent <= LOW_BATTERY) return 'LOW_POWER'
    if (batteryPercent <= CONSERVATIVE_BATTERY) return 'CONSERVATIVE'
  }
  if (saveData) return 'CONSERVATIVE'
  const activity = getRuntimeActivityLevel()
  if (activity === 'IDLE' && batteryPercent != null && batteryPercent <= 50 && !batteryCharging) {
    return 'CONSERVATIVE'
  }
  return 'NORMAL'
}

function recompute(): FieldPowerSnapshot {
  tier = deriveTier()
  const activity = getRuntimeActivityLevel()
  const idleMotionSuppressed =
    activity === 'IDLE' && (tier === 'LOW_POWER' || tier === 'THERMAL' || tier === 'CONSERVATIVE')
  const navigationLowPower = navigationActive && (tier === 'LOW_POWER' || tier === 'THERMAL')
  const lowThermalMode = tier === 'THERMAL' || tier === 'LOW_POWER'

  let atmosphericCadenceMultiplier = 1
  if (tier === 'THERMAL') atmosphericCadenceMultiplier = 0.25
  else if (tier === 'LOW_POWER') atmosphericCadenceMultiplier = 0.35
  else if (tier === 'CONSERVATIVE') atmosphericCadenceMultiplier = 0.6
  if (idleMotionSuppressed) atmosphericCadenceMultiplier *= 0.5
  if (navigationLowPower) atmosphericCadenceMultiplier *= 0.7

  let maxAtmosphericFps = 24
  if (tier === 'THERMAL') maxAtmosphericFps = 6
  else if (tier === 'LOW_POWER') maxAtmosphericFps = 8
  else if (tier === 'CONSERVATIVE') maxAtmosphericFps = 12
  if (activity === 'IDLE') maxAtmosphericFps = Math.min(maxAtmosphericFps, 10)
  if (navigationLowPower) maxAtmosphericFps = Math.min(maxAtmosphericFps, 8)

  return {
    tier,
    batteryPercent,
    batteryCharging,
    saveData,
    navigationLowPower,
    idleMotionSuppressed,
    atmosphericCadenceMultiplier,
    lowThermalMode,
    sessionUptimeMs: Date.now() - sessionStartMs,
    maxAtmosphericFps,
  }
}

export function getFieldPowerSnapshot(): FieldPowerSnapshot {
  return recompute()
}

/** Hint from movement/navigation consumers — does not change GPS truth. */
export function setFieldNavigationActive(active: boolean): void {
  if (navigationActive === active) return
  navigationActive = active
}

export function getPowerAdjustedMaxFps(baseMaxFps: number, activity?: RuntimeActivityLevel): number {
  const snap = getFieldPowerSnapshot()
  const act = activity ?? getRuntimeActivityLevel()
  if (act === 'BACKGROUND') return 0

  let cap = Math.min(baseMaxFps, snap.maxAtmosphericFps)
  if (snap.idleMotionSuppressed && act === 'IDLE') {
    cap = Math.min(cap, 8)
  }
  if (snap.atmosphericCadenceMultiplier < 0.4) {
    cap = Math.min(cap, 6)
  }
  return Math.max(0, cap)
}

async function wireBattery(): Promise<void> {
  const nav = navigator as Navigator & {
    getBattery?: () => Promise<{
      level: number
      charging: boolean
      addEventListener: (e: string, fn: () => void) => void
    }>
  }
  if (!nav.getBattery) return
  try {
    const bat = await nav.getBattery()
    batteryPercent = Math.round(bat.level * 100)
    batteryCharging = bat.charging
    bat.addEventListener('levelchange', () => {
      batteryPercent = Math.round(bat.level * 100)
    })
    bat.addEventListener('chargingchange', () => {
      batteryCharging = bat.charging
    })
  } catch {
    // Battery API blocked or unavailable — field profile degrades gracefully
  }
}

export function installFieldPowerProfile(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  saveData = readSaveData()

  const conn = (navigator as Navigator & { connection?: { addEventListener?: (e: string, fn: () => void) => void } }).connection
  conn?.addEventListener?.('change', () => {
    saveData = readSaveData()
  })

  void wireBattery()

  ;['pointerdown', 'keydown', 'touchstart'].forEach((ev) => {
    window.addEventListener(ev, markRuntimeUserEngagement, { passive: true })
  })
}

export function publishFieldPowerProfile(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & { __hudFieldPower?: () => FieldPowerSnapshot }
  w.__hudFieldPower = getFieldPowerSnapshot
}

export function __resetFieldPowerProfileForTests(): void {
  tier = 'NORMAL'
  batteryPercent = null
  batteryCharging = false
  saveData = false
  navigationActive = false
  installed = false
}
