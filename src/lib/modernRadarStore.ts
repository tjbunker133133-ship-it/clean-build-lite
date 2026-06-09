/**
 * Balanced-layer radar preference store (legacy).
 *
 * Modern immersive field uses fieldIntentStore + fieldIntentModel (FIM).
 * Do NOT use opacity/enabled for Modern environmental expression.
 */

type Listener = () => void

const STORAGE_KEY = 'hud_modern_radar_v1'

/** Balanced-layer legacy toggle — NOT used by Modern environmental field. */
let radarEnabled = true
try {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored != null) radarEnabled = stored === 'true'
} catch {
  // ignore storage errors
}

/** Field sensitivity — modulates expression strength, never existence. */
let radarOpacity = 0.45
try {
  const raw = localStorage.getItem('hud_modern_radar_opacity_v1')
  if (raw != null) {
    const v = parseFloat(raw)
    if (v > 0 && v <= 1) radarOpacity = v
  }
} catch {
  // ignore
}

const listeners = new Set<Listener>()

function notify() {
  listeners.forEach((fn) => fn())
}

export function getRadarEnabled(): boolean {
  return radarEnabled
}

export function getRadarOpacity(): number {
  return radarOpacity
}

export function setRadarEnabled(v: boolean): void {
  if (radarEnabled === v) return
  radarEnabled = v
  try {
    localStorage.setItem(STORAGE_KEY, v ? 'true' : 'false')
  } catch {
    // ignore
  }
  notify()
}

export function setRadarOpacity(v: number): void {
  const clamped = Math.max(0.1, Math.min(1, v))
  if (radarOpacity === clamped) return
  radarOpacity = clamped
  try {
    localStorage.setItem('hud_modern_radar_opacity_v1', String(clamped))
  } catch {
    // ignore
  }
  notify()
}

export function subscribeRadar(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
