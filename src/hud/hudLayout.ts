/**
 * Shared layout reserves for top bar, dock rails, and map HUD banners.
 * Keeps dock strips below the brand bar on notched phones.
 */

import { getDeviceProfile } from '../runtime/deviceProfile'

/** Content height inside TopBar (excludes safe-area padding). */
export function topBarContentHeightPx(): number {
  const p = getDeviceProfile()
  return p.width < 720 || p.isCoarsePointer ? 62 : 54
}

/** Space reserved below the physical top edge before dock lanes start. */
export function dockTopOffsetPx(): number {
  const p = getDeviceProfile()
  const bar = topBarContentHeightPx()
  const safeGuess =
    p.isIOS && (p.isStandalone || p.isPWA) ? 44 : p.isIOS ? 20 : 0
  return bar + safeGuess + 8
}

/** Map overlay banners (NEXT waypoint, etc.) sit just under the top bar. */
export function mapBannerTopCss(): string {
  return `calc(env(safe-area-inset-top, 0px) + ${topBarContentHeightPx() + 6}px)`
}

/** Bottom-left field status stack (mesh, offline map) — above dock gutter. */
export function fieldStatusRailBottomCss(): string {
  return 'calc(env(safe-area-inset-bottom, 0px) + 12px)'
}
