/**
 * Feature flag — modernERL.enabled
 * Default true in Modern mode; always false in Classic/Balanced.
 */

const STORAGE_KEY = 'modernERL.enabled'

let runtimeOverride: boolean | null = null

export function isModernERLEnabled(immersive: boolean): boolean {
  if (!immersive) return false
  if (runtimeOverride != null) return runtimeOverride
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'false') return false
    if (raw === 'true') return true
  } catch {
    // ignore
  }
  return true
}

export function setModernERLEnabled(enabled: boolean): void {
  runtimeOverride = enabled
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    // ignore
  }
}

/** Test-only reset */
export function __resetModernERLFlagsForTests(): void {
  runtimeOverride = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
