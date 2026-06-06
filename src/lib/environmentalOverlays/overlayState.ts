import { ENVIRONMENTAL_OVERLAY_IDS, isEnvironmentalOverlayId } from './catalog'
import { traceOverlay } from '../../runtime/runtimeForensics'
import type { EnvironmentalOverlayId } from './types'

const STORAGE_KEY = 'hud_env_overlay_toggles_v1'

export type OverlayToggleState = Record<EnvironmentalOverlayId, boolean>

export function defaultOverlayToggles(): OverlayToggleState {
  return Object.fromEntries(
    ENVIRONMENTAL_OVERLAY_IDS.map((id) => [id, false]),
  ) as OverlayToggleState
}

export function loadOverlayToggles(): OverlayToggleState {
  const base = defaultOverlayToggles()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      // GUARDRAIL: Trace empty storage (first visit or cleared)
      traceOverlay('storage_load_empty', { key: STORAGE_KEY })
      return base
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') {
      traceOverlay('storage_load_invalid', { key: STORAGE_KEY, type: typeof parsed })
      return base
    }
    let validCount = 0
    let invalidCount = 0
    for (const id of ENVIRONMENTAL_OVERLAY_IDS) {
      if (typeof parsed[id] === 'boolean') {
        base[id] = parsed[id]
        validCount++
      } else if (parsed[id] !== undefined) {
        invalidCount++
      }
    }
    traceOverlay('storage_load_success', {
      key: STORAGE_KEY,
      validCount,
      invalidCount,
      rawSize: raw.length,
    })
    return base
  } catch (err) {
    // GUARDRAIL: Trace parse failures for forensics
    traceOverlay('storage_load_failed', {
      key: STORAGE_KEY,
      error: (err as Error).message.slice(0, 100),
    })
    return base
  }
}

export function saveOverlayToggles(toggles: OverlayToggleState): void {
  const enabledCount = Object.values(toggles).filter(Boolean).length
  try {
    const serialized = JSON.stringify(toggles)
    localStorage.setItem(STORAGE_KEY, serialized)
    // GUARDRAIL: Trace successful save
    traceOverlay('storage_save_success', {
      key: STORAGE_KEY,
      size: serialized.length,
      enabledCount,
      totalCount: ENVIRONMENTAL_OVERLAY_IDS.length,
    })
  } catch (err) {
    const errorMsg = (err as Error).message ?? String(err)
    const isQuota = errorMsg.toLowerCase().includes('quota') ||
                    errorMsg.toLowerCase().includes('exceeded') ||
                    errorMsg.toLowerCase().includes('full')
    // GUARDRAIL: Trace storage failures
    traceOverlay(isQuota ? 'storage_quota_exceeded' : 'storage_save_error', {
      key: STORAGE_KEY,
      error: errorMsg.slice(0, 100),
      enabledCount,
    })
  }
}

export function setOverlayToggle(
  toggles: OverlayToggleState,
  id: EnvironmentalOverlayId,
  enabled: boolean,
): OverlayToggleState {
  if (!isEnvironmentalOverlayId(id)) return toggles
  return { ...toggles, [id]: enabled }
}
