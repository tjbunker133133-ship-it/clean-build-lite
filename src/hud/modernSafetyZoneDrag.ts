/**
 * modernSafetyZoneDrag.ts — Pure helpers for Modern SOS drag (testable, no React).
 */

import type { CockpitSafeAreaInsets } from '../lib/viewport'

export type SosScreenPosition = { x: number; y: number }

export type SosViewport = { width: number; height: number }

export function sosAnchorFromRect(rect: DOMRect): SosScreenPosition {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

export function clampSosScreenPosition(
  pos: SosScreenPosition,
  viewport: SosViewport,
  insets: CockpitSafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 },
  buttonSize = 64,
  padding = 16,
  topChrome = 48,
): SosScreenPosition {
  const half = buttonSize / 2
  const minX = padding + insets.left + half
  const maxX = viewport.width - padding - insets.right - half
  const minY = padding + insets.top + topChrome + half
  const maxY = viewport.height - padding - insets.bottom - half
  return {
    x: Math.max(minX, Math.min(maxX, pos.x)),
    y: Math.max(minY, Math.min(maxY, pos.y)),
  }
}

/** Snap toward thumb-reach edge zones when released near screen edges. */
export function magnetizeSosPosition(
  pos: SosScreenPosition,
  viewport: SosViewport,
  insets: CockpitSafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 },
  buttonSize = 64,
  magnetPx = 32,
  topChrome = 48,
): SosScreenPosition {
  const half = buttonSize / 2
  const padding = 16
  const clamped = clampSosScreenPosition(pos, viewport, insets, buttonSize, padding, topChrome)
  let { x, y } = clamped

  const leftEdge = padding + insets.left + half
  const rightEdge = viewport.width - padding - insets.right - half
  const bottomEdge = viewport.height - padding - insets.bottom - half
  const topEdge = padding + insets.top + topChrome + half

  if (x - leftEdge < magnetPx) x = leftEdge
  if (rightEdge - x < magnetPx) x = rightEdge
  if (bottomEdge - y < magnetPx) y = bottomEdge
  if (y - topEdge < magnetPx) y = topEdge

  return { x, y }
}

/** Pointer center minus drag offset, clamped to visible viewport + safe areas. */
export function sosPositionFromPointer(
  clientX: number,
  clientY: number,
  dragOffset: SosScreenPosition,
  viewport: SosViewport,
  insets?: CockpitSafeAreaInsets,
): SosScreenPosition {
  return clampSosScreenPosition(
    { x: clientX - dragOffset.x, y: clientY - dragOffset.y },
    viewport,
    insets,
  )
}
