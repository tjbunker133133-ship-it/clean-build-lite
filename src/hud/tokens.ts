/**
 * HUD panel touch & typography tokens — single source of truth for spacing,
 * gaps, control min-heights, and font floors. Mirrors field UX rules applied
 * in `index.css` under `html.platform-mobile`.
 *
 * The canonical mobile-vs-desktop detection used across the cockpit is
 * `getDeviceProfile().interactionMode === 'mobile'`. Pass that boolean as
 * `isMobile` to these helpers — do NOT introduce a parallel detection path.
 */

// ── Raw constants (kept so call sites can still reach for the underlying
// number when they need it, e.g. mid-layout math).
export const HUD_TOUCH_GAP_MOBILE_SM = 8
export const HUD_TOUCH_GAP_DESKTOP_SM = 6
export const HUD_TOUCH_GAP_MOBILE_MD = 12
export const HUD_TOUCH_GAP_DESKTOP_MD = 8
export const HUD_TOUCH_GAP_MOBILE_LG = 16
export const HUD_TOUCH_GAP_DESKTOP_LG = 12

/** Minimum on-screen control height for primary actions (WCAG-ish field target). */
export const HUD_TOUCH_TARGET_MIN_PX = 48

/** Body/label text floor when `platform-mobile` / mobile interaction mode is active. */
export const HUD_FONT_MIN_MOBILE_PX = 14

// ── Canonical token API (matches the spec used by the panel sweep).

/** Small panel-content gap (checkbox rows, label/value pairs). */
export function touchGapSm(isMobile: boolean): number {
  return isMobile ? HUD_TOUCH_GAP_MOBILE_SM : HUD_TOUCH_GAP_DESKTOP_SM
}

/** Medium panel-content gap (default panel body grid spacing). */
export function touchGapMd(isMobile: boolean): number {
  return isMobile ? HUD_TOUCH_GAP_MOBILE_MD : HUD_TOUCH_GAP_DESKTOP_MD
}

/** Large gap reserved for safety controls that must not crowd each other. */
export function touchGapLg(isMobile: boolean): number {
  return isMobile ? HUD_TOUCH_GAP_MOBILE_LG : HUD_TOUCH_GAP_DESKTOP_LG
}

/** Body / label text size for subtle helper text (replaces fontSize 10/11). */
export function touchFontSm(isMobile: boolean): number {
  return isMobile ? 14 : 11
}

/** Primary panel text size (replaces fontSize 12, route stats, etc). */
export function touchFontMd(isMobile: boolean): number {
  return isMobile ? 15 : 13
}

/** Minimum tap-target height/width for any clickable element. */
export function touchMinTarget(isMobile: boolean): number {
  return isMobile ? HUD_TOUCH_TARGET_MIN_PX : 32
}
