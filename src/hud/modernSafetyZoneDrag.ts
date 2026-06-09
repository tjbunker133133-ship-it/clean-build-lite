/** Pure helpers for Modern SOS drag positioning (testable, no React). */

export type SosScreenPosition = { x: number; y: number }

export function sosAnchorFromRect(rect: DOMRect): SosScreenPosition {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

export function clampSosScreenPosition(
  pos: SosScreenPosition,
  viewport: { width: number; height: number },
  buttonSize = 64,
  padding = 16,
): SosScreenPosition {
  const half = buttonSize / 2
  return {
    x: Math.max(padding + half, Math.min(viewport.width - padding - half, pos.x)),
    y: Math.max(padding + half, Math.min(viewport.height - padding - half, pos.y)),
  }
}

/** Pointer center minus drag offset, clamped to viewport. */
export function sosPositionFromPointer(
  clientX: number,
  clientY: number,
  dragOffset: SosScreenPosition,
  viewport: { width: number; height: number },
): SosScreenPosition {
  return clampSosScreenPosition(
    { x: clientX - dragOffset.x, y: clientY - dragOffset.y },
    viewport,
  )
}
