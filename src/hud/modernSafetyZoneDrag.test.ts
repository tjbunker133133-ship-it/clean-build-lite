import { describe, expect, it } from 'vitest'
import { clampSosScreenPosition, sosAnchorFromRect, sosPositionFromPointer } from './modernSafetyZoneDrag'

describe('modernSafetyZoneDrag', () => {
  it('derives anchor from button rect center', () => {
    const anchor = sosAnchorFromRect({ left: 300, top: 700, width: 64, height: 64 } as DOMRect)
    expect(anchor).toEqual({ x: 332, y: 732 })
  })

  it('does not jump to origin when dragging from default bottom-right anchor', () => {
    const viewport = { width: 390, height: 844 }
    const anchor = sosAnchorFromRect({ left: 310, top: 760, width: 64, height: 64 } as DOMRect)
    const dragOffset = { x: 10, y: 8 }
    const next = sosPositionFromPointer(anchor.x + 20, anchor.y - 15, dragOffset, viewport)
    expect(next.x).toBeGreaterThan(200)
    expect(next.y).toBeGreaterThan(600)
    expect(next.x).toBeLessThan(viewport.width)
    expect(next.y).toBeLessThan(viewport.height)
  })

  it('clamps SOS inside viewport padding', () => {
    const viewport = { width: 400, height: 800 }
    const clamped = clampSosScreenPosition({ x: -50, y: 900 }, viewport)
    expect(clamped.x).toBeGreaterThanOrEqual(48)
    expect(clamped.y).toBeLessThanOrEqual(800 - 48)
  })
})
