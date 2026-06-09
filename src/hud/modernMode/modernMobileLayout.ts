/**
 * Shared mobile layout zones for Modern immersive runtime.
 * Single source for bottom-edge stacking and thumb-reach anchors.
 */

export const MODERN_MOBILE_LAYOUT = {
  /** Minimum touch target (field ergonomics). */
  touchMin: 44,
  /** SOS default anchor — bottom-right thumb zone. */
  sosDefaultRight: 'max(16px, env(safe-area-inset-right))',
  sosDefaultBottom: 'calc(16px + max(16px, env(safe-area-inset-bottom)))',
  /** DeadMan / reaction stack — bottom-left. */
  deadManBottom: 'calc(12px + max(16px, env(safe-area-inset-bottom)))',
  /** Center-bottom indicators (movement, mission, field scan). */
  centerRailBottom: 'calc(88px + env(safe-area-inset-bottom, 0px))',
  /** Floating chips (layers, measure). */
  chipBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
  measureChipBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
  /** Environmental reaction chips. */
  reactionBottom: 'calc(84px + env(safe-area-inset-bottom, 0px))',
  /** Top chrome clearance below micro-bar. */
  topChrome: 'calc(env(safe-area-inset-top, 0px) + 32px)',
} as const

export default MODERN_MOBILE_LAYOUT
