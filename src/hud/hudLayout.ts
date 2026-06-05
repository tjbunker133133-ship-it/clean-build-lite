/**
 * Shared layout reserves for top bar, dock rails, and map HUD banners.
 * Keeps dock strips below the brand bar on notched phones.
 */

import { getDeviceProfile } from '../runtime/deviceProfile'

/** Content height inside TopBar (excludes safe-area padding). */
export function topBarContentHeightPx(): number {
  const p = getDeviceProfile()
  return p.width < 720 || p.isCoarsePointer ? 78 : 58
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

/** Bottom stack for team comms confirm/toast — above field status rail. */
export function teamCommsToastBottomCss(): string {
  const p = getDeviceProfile()
  const lift = p.interactionMode === 'mobile' ? 168 : 108
  return `calc(env(safe-area-inset-bottom, 0px) + ${lift}px)`
}

/** Canonical z-index stack: map < route < HUD panels < status rail < comms toast */
export const HUD_Z_MAP = 0
export const HUD_Z_ROUTE = 10
export const HUD_Z_PANEL = 300
export const HUD_Z_STATUS_RAIL = 204
export const HUD_Z_TEAM_COMMS = 211

/** Bottom-left field status card — clear dock peek strips and arrival strip on phones. */
export function fieldStatusRailBottomCss(): string {
  const p = getDeviceProfile()
  const lift = p.interactionMode === 'mobile' ? 76 : 20
  return `calc(env(safe-area-inset-bottom, 0px) + ${lift}px)`
}
