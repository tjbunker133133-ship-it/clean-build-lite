import { ENVIRONMENTAL_OVERLAY_IDS, isEnvironmentalOverlayId } from './catalog'
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
    if (!raw) return base
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return base
    for (const id of ENVIRONMENTAL_OVERLAY_IDS) {
      if (typeof parsed[id] === 'boolean') base[id] = parsed[id]
    }
    return base
  } catch {
    return base
  }
}

export function saveOverlayToggles(toggles: OverlayToggleState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toggles))
  } catch {
    /* quota / private mode */
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
