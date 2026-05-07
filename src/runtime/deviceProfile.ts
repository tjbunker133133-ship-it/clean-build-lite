/**
 * UNIFIED DEVICE PROFILE — single source of truth for device classification.
 *
 * This module replaces the five legacy detection strategies that previously
 * lived in `utils/device.ts`, `lib/systemSettingsLinks.ts`, `CockpitContext`,
 * `CockpitHudPanel`, `MapCanvas`, `StatusRail`, `TopBar`, and inline regex
 * tests across the codebase.
 *
 * Read it once via `getDeviceProfile()` (cached), or subscribe with
 * `subscribeDeviceProfile(fn)` to react to viewport / orientation / display-mode
 * changes (e.g. PWA install).
 *
 * `interactionMode` is the canonical signal for whether to mount the
 * `MobileInteractionController` versus `DesktopInteractionController`.
 *
 * TABLET CONTRACT (DEPE rule): tablets are a *scaled* mobile field-HUD
 * environment, NOT a hybrid. Therefore `type === 'tablet'` ALWAYS produces
 * `interactionMode === 'mobile'`. The `type` flag is preserved for visual
 * scaling decisions only (panel sizes, density, spacing). Interaction,
 * gesture, voice, and persistence systems are driven exclusively by
 * `interactionMode`.
 *
 * UI/CSS adaptations may use the finer-grained `type` and `isIOS`/`isAndroid`
 * flags for cosmetic differences, but MUST NOT use them to switch interaction
 * controllers, storage scopes, or voice behaviour.
 */

export type DeviceType = 'desktop' | 'mobile' | 'tablet'
export type InteractionMode = 'desktop' | 'mobile'

export interface DeviceProfile {
  type: DeviceType
  isTouch: boolean
  isIOS: boolean
  isAndroid: boolean
  isAppleWebKit: boolean
  isPWA: boolean
  isStandalone: boolean
  isCoarsePointer: boolean
  prefersReducedMotion: boolean
  prefersReducedTransparency: boolean
  width: number
  height: number
  shortEdge: number
  longEdge: number
  orientation: 'portrait' | 'landscape'
  interactionMode: InteractionMode
  ua: string
}

const SSR_PROFILE: DeviceProfile = {
  type: 'desktop',
  isTouch: false,
  isIOS: false,
  isAndroid: false,
  isAppleWebKit: false,
  isPWA: false,
  isStandalone: false,
  isCoarsePointer: false,
  prefersReducedMotion: false,
  prefersReducedTransparency: false,
  width: 0,
  height: 0,
  shortEdge: 0,
  longEdge: 0,
  orientation: 'landscape',
  interactionMode: 'desktop',
  ua: '',
}

let cached: DeviceProfile | null = null
let sessionLockedInteractionMode: InteractionMode | null = null
type Listener = (p: DeviceProfile) => void
const listeners = new Set<Listener>()
let attached = false

function safeMatchMedia(query: string): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia(query).matches
  } catch {
    return false
  }
}

function computeProfile(): DeviceProfile {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return SSR_PROFILE

  const ua = navigator.userAgent || ''
  const maxTouch = typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0
  const isTouch = 'ontouchstart' in window || maxTouch > 0

  // iPadOS 13+ ships a Mac UA by default. Detect it via touch-capable Mac UA.
  const isIPadOSDesktopUa =
    /Macintosh/i.test(ua) && maxTouch > 1 && !(window as Window & { MSStream?: unknown }).MSStream
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || isIPadOSDesktopUa
  const isAndroid = /Android/i.test(ua)
  const isAppleWebKit = /AppleWebKit/i.test(ua) && (isIOS || /Macintosh/i.test(ua))

  const width = window.innerWidth || 0
  const height = window.innerHeight || 0
  const shortEdge = Math.min(width, height)
  const longEdge = Math.max(width, height)
  const orientation: 'portrait' | 'landscape' = height >= width ? 'portrait' : 'landscape'

  const isCoarsePointer = safeMatchMedia('(pointer: coarse)')
  const prefersReducedMotion = safeMatchMedia('(prefers-reduced-motion: reduce)')
  const prefersReducedTransparency = safeMatchMedia('(prefers-reduced-transparency: reduce)')

  const isStandalone =
    safeMatchMedia('(display-mode: standalone)') ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  const isPWA = isStandalone

  // Tablet = touch + intermediate short-edge (700–1100). Otherwise mobile if
  // touch+compact, else desktop.
  const isTabletLike = isTouch && shortEdge >= 700 && shortEdge <= 1100
  const isCompact = width < 900

  let type: DeviceType
  if (isTabletLike) type = 'tablet'
  else if (isTouch && isCompact) type = 'mobile'
  else type = 'desktop'

  // DEPE rule: tablet is a *scaled* mobile environment, never hybrid. Both
  // tablet and mobile types route to the mobile interaction controller. Only
  // the explicit `desktop` type uses desktop interaction. Touch-capable
  // laptops keep desktop behaviour because they classify as `desktop` here.
  const computedMode: InteractionMode = type === 'desktop' ? 'desktop' : 'mobile'
  // Session-locked interaction model: compute once at boot and keep immutable
  // for the lifetime of the runtime session (no mode flips on rotation/resize).
  if (sessionLockedInteractionMode == null) {
    sessionLockedInteractionMode = computedMode
  }
  const interactionMode: InteractionMode = sessionLockedInteractionMode

  return {
    type,
    isTouch,
    isIOS,
    isAndroid,
    isAppleWebKit,
    isPWA,
    isStandalone,
    isCoarsePointer,
    prefersReducedMotion,
    prefersReducedTransparency,
    width,
    height,
    shortEdge,
    longEdge,
    orientation,
    interactionMode,
    ua,
  }
}

function recompute(): void {
  const next = computeProfile()
  const prev = cached
  cached = next
  if (
    !prev ||
    prev.width !== next.width ||
    prev.height !== next.height ||
    prev.orientation !== next.orientation ||
    prev.interactionMode !== next.interactionMode ||
    prev.type !== next.type ||
    prev.isStandalone !== next.isStandalone ||
    prev.isCoarsePointer !== next.isCoarsePointer ||
    prev.prefersReducedMotion !== next.prefersReducedMotion
  ) {
    for (const fn of listeners) {
      try {
        fn(next)
      } catch {
        /* listener errors must never disturb runtime */
      }
    }
  }
}

function attachListenersOnce(): void {
  if (attached || typeof window === 'undefined') return
  attached = true
  window.addEventListener('resize', recompute, { passive: true })
  window.addEventListener('orientationchange', recompute, { passive: true })
  try {
    window.matchMedia('(display-mode: standalone)').addEventListener?.('change', recompute)
    window.matchMedia('(pointer: coarse)').addEventListener?.('change', recompute)
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', recompute)
  } catch {
    /* legacy Safari without addEventListener on MediaQueryList */
  }
}

export function getDeviceProfile(): DeviceProfile {
  if (cached) return cached
  cached = computeProfile()
  attachListenersOnce()
  return cached
}

export function subscribeDeviceProfile(fn: Listener): () => void {
  attachListenersOnce()
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** DEV/test hook: force recompute. Not for production code paths. */
export function refreshDeviceProfile(): DeviceProfile {
  recompute()
  return getDeviceProfile()
}

export function getSessionLockedInteractionMode(): InteractionMode {
  if (sessionLockedInteractionMode != null) return sessionLockedInteractionMode
  return getDeviceProfile().interactionMode
}
