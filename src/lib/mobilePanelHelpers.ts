/**
 * Mobile-only cockpit panel helpers (DEPE: interactionMode === 'mobile' includes tablets).
 * Pure functions — safe to unit test; no React, no map/GPS/rescue coupling.
 */

import type { CockpitPanelRect } from '../types/cockpit'

export const MOBILE_PANEL_FONT_SCALE_MIN = 0.9
export const MOBILE_PANEL_FONT_SCALE_MAX = 1.25
export const MOBILE_PANEL_FONT_SCALE_STEP = 0.05

/** Floating shell max height — was ~60vh; field HUD needs more readable scroll viewport. */
export const MOBILE_FLOATING_MAX_HEIGHT_VH = 78
export const MOBILE_RESIZE_HITBOX_PX = 52
export const MOBILE_PRESET_SEQUENCE = ['compact', 'normal', 'large'] as const
export type MobilePanelSizePreset = (typeof MOBILE_PRESET_SEQUENCE)[number]
export const MOBILE_DENSITY_COLLAPSE_IDLE_MS = 9000

/** CONTRACT lock: mobile drag release never auto-docks from edge proximity (see CockpitHudPanel). */
export const MOBILE_DRAG_EDGE_DOCK_DISABLED = true as const

export function clampMobilePanelFontScale(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(MOBILE_PANEL_FONT_SCALE_MAX, Math.max(MOBILE_PANEL_FONT_SCALE_MIN, n))
}

export function cycleMobilePanelSizePreset(
  current: MobilePanelSizePreset | 'custom',
): MobilePanelSizePreset {
  if (current === 'custom') return 'normal'
  const idx = MOBILE_PRESET_SEQUENCE.indexOf(current)
  return MOBILE_PRESET_SEQUENCE[(idx + 1) % MOBILE_PRESET_SEQUENCE.length]
}

export function mobilePresetDimensions(
  preset: MobilePanelSizePreset,
  viewport: { vw: number; vh: number },
  minSize: { w: number; h: number },
): { w: number; h: number } {
  const scale =
    preset === 'compact'
      ? { w: 0.34, h: 0.38 }
      : preset === 'large'
        ? { w: 0.58, h: 0.7 }
        : { w: 0.46, h: 0.54 }
  const maxH = Math.max(minSize.h, Math.floor((viewport.vh * MOBILE_FLOATING_MAX_HEIGHT_VH) / 100))
  const w = Math.max(minSize.w, Math.min(Math.round(viewport.vw * scale.w), Math.max(minSize.w, viewport.vw - 20)))
  const h = Math.max(minSize.h, Math.min(Math.round(viewport.vh * scale.h), maxH))
  return { w, h }
}

/**
 * Minimize/dock side: fewer panels on that rail wins; tie → panel center vs viewport half.
 * Deterministic, no persistence, no prompts (mobile field-stability pass).
 */
export function chooseMobileMinimizeDockSideAutoBalance(
  panels: Record<string, CockpitPanelRect | undefined>,
  panelId: string,
  posX: number,
  panelW: number,
  vw: number,
): 'left' | 'right' {
  let leftCount = 0
  let rightCount = 0
  for (const [id, panel] of Object.entries(panels)) {
    if (id === panelId || !panel?.docked) continue
    const side = panel.dockSide ?? 'left'
    if (side === 'left') leftCount += 1
    else rightCount += 1
  }
  if (leftCount < rightCount) return 'left'
  if (rightCount < leftCount) return 'right'
  const cx = posX + panelW / 2
  return cx < vw / 2 ? 'left' : 'right'
}

/**
 * CONTRACT: mobile floating commits store clamped pixel coords — no SNAP_PX quantization.
 * Exported for test lock only; runtime uses inline clamp in CockpitHudPanel.
 */
export function mobileFloatingCommitCoords(nx: number, ny: number): { x: number; y: number } {
  return { x: nx, y: ny }
}

/**
 * Clamp only when a panel would become unreachable. This prevents jitter from
 * transient visualViewport changes (URL bar / keyboard) while preserving
 * emergency reachability guarantees.
 */
export function clampMobileToReachableViewport(
  pos: { x: number; y: number },
  size: { w: number; h: number },
  viewport: { vw: number; vh: number },
  topInset = 36,
): { x: number; y: number } {
  const maxX = Math.max(0, viewport.vw - size.w)
  const maxY = Math.max(topInset, viewport.vh - size.h)
  const unreachableX = pos.x < 0 || pos.x > maxX
  const unreachableY = pos.y < topInset || pos.y > maxY
  if (!unreachableX && !unreachableY) return pos
  return {
    x: Math.max(0, Math.min(pos.x, maxX)),
    y: Math.max(topInset, Math.min(pos.y, maxY)),
  }
}

/** Mobile focus mode: de-emphasize non-active floating panels without hiding them. */
export function mobileFocusOpacity(panelZ: number, topZ: number): number {
  return panelZ >= topZ ? 1 : 0.9
}

export function shouldApplyViewportClampDeduped(
  prev: { x: number; y: number } | null,
  next: { x: number; y: number },
): boolean {
  if (!prev) return true
  return Math.abs(prev.x - next.x) > 0.5 || Math.abs(prev.y - next.y) > 0.5
}

export function shouldRunMaterialViewportRecovery(
  prev: { vw: number; vh: number } | null,
  next: { vw: number; vh: number },
): boolean {
  if (!prev) return true
  const orientationChanged = (prev.vw > prev.vh) !== (next.vw > next.vh)
  const widthDelta = Math.abs(prev.vw - next.vw)
  const heightDelta = Math.abs(prev.vh - next.vh)
  return orientationChanged || widthDelta >= 40 || heightDelta >= 40
}

export function isPanelReachableInViewport(
  pos: { x: number; y: number },
  size: { w: number; h: number },
  viewport: { vw: number; vh: number },
  topInset = 36,
): boolean {
  const maxX = Math.max(0, viewport.vw - size.w)
  const maxY = Math.max(topInset, viewport.vh - size.h)
  return pos.x >= 0 && pos.x <= maxX && pos.y >= topInset && pos.y <= maxY
}

export function shouldSuppressRepeatedDimensionWrite(
  prev: { w: number; h: number } | null,
  next: { w: number; h: number },
  epsilon = 0.5,
): boolean {
  if (!prev) return false
  return Math.abs(prev.w - next.w) <= epsilon && Math.abs(prev.h - next.h) <= epsilon
}

export function sanitizeMobilePanelRect(
  panel: CockpitPanelRect,
  viewport: { vw: number; vh: number },
): { panel: CockpitPanelRect; changed: boolean; reason: string | null } {
  const next = { ...panel }
  let reason: string | null = null
  if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || !Number.isFinite(next.w)) {
    next.x = 8
    next.y = 48
    next.w = Math.max(120, Math.min(320, viewport.vw - 20))
    next.h = Number.isFinite(next.h ?? NaN) ? next.h : 220
    reason = 'non-finite-coordinates'
  }
  next.w = Math.max(120, Math.min(next.w, Math.max(120, viewport.vw - 20)))
  const resolvedH = Math.max(96, Math.min(next.h ?? 220, Math.max(96, viewport.vh - 48)))
  next.h = resolvedH
  const clamped = clampMobileToReachableViewport(
    { x: next.x, y: next.y },
    { w: next.w, h: resolvedH },
    viewport,
    36,
  )
  if (Math.abs(clamped.x - next.x) > 0.5 || Math.abs(clamped.y - next.y) > 0.5) {
    next.x = clamped.x
    next.y = clamped.y
    reason = reason ?? 'unreachable-clamp'
  }
  const changed =
    Math.abs(next.x - panel.x) > 0.5 ||
    Math.abs(next.y - panel.y) > 0.5 ||
    Math.abs(next.w - panel.w) > 0.5 ||
    Math.abs((next.h ?? 0) - (panel.h ?? 0)) > 0.5
  return { panel: next, changed, reason }
}
