import { describe, expect, it } from 'vitest'
import {
  clampMobileToReachableViewport,
  cycleMobilePanelSizePreset,
  mobileFocusOpacity,
  mobilePresetDimensions,
  shouldApplyViewportClampDeduped,
  shouldRunMaterialViewportRecovery,
  sanitizeMobilePanelRect,
  chooseMobileMinimizeDockSideAutoBalance,
  clampMobilePanelFontScale,
  mobileFloatingCommitCoords,
  MOBILE_DENSITY_COLLAPSE_IDLE_MS,
  MOBILE_DRAG_EDGE_DOCK_DISABLED,
  MOBILE_FLOATING_MAX_HEIGHT_VH,
  MOBILE_PANEL_FONT_SCALE_MAX,
  MOBILE_PANEL_FONT_SCALE_MIN,
  MOBILE_RESIZE_HITBOX_PX,
  isPanelReachableInViewport,
  shouldSuppressRepeatedDimensionWrite,
} from './mobilePanelHelpers'
import type { CockpitPanelRect } from '../types/cockpit'

function panel(docked: boolean, side?: 'left' | 'right'): CockpitPanelRect {
  return {
    x: 0,
    y: 100,
    w: 300,
    h: 200,
    z: 1,
    minimized: false,
    docked,
    dockSide: side,
  }
}

describe('clampMobilePanelFontScale', () => {
  it('clamps to bounded range', () => {
    expect(clampMobilePanelFontScale(0.5)).toBe(MOBILE_PANEL_FONT_SCALE_MIN)
    expect(clampMobilePanelFontScale(2)).toBe(MOBILE_PANEL_FONT_SCALE_MAX)
    expect(clampMobilePanelFontScale(1)).toBe(1)
  })

  it('non-finite falls back to 1', () => {
    expect(clampMobilePanelFontScale(Number.NaN)).toBe(1)
  })
})

describe('chooseMobileMinimizeDockSideAutoBalance', () => {
  it('picks side with fewer docked panels', () => {
    const panels: Record<string, CockpitPanelRect | undefined> = {
      a: panel(true, 'left'),
      b: panel(true, 'left'),
      self: panel(false),
    }
    const side = chooseMobileMinimizeDockSideAutoBalance(panels, 'self', 200, 280, 400)
    expect(side).toBe('right')
  })

  it('tie-breaks by nearest viewport half', () => {
    const panels: Record<string, CockpitPanelRect | undefined> = {
      a: panel(true, 'left'),
      b: panel(true, 'right'),
      self: panel(false),
    }
    expect(chooseMobileMinimizeDockSideAutoBalance(panels, 'self', 10, 100, 400)).toBe('left')
    expect(chooseMobileMinimizeDockSideAutoBalance(panels, 'self', 250, 100, 400)).toBe('right')
  })

  it('excludes self panel from counts', () => {
    const panels: Record<string, CockpitPanelRect | undefined> = {
      self: panel(true, 'left'),
    }
    const side = chooseMobileMinimizeDockSideAutoBalance(panels, 'self', 200, 280, 400)
    expect(side === 'left' || side === 'right').toBe(true)
  })

  it('is idempotent: same inputs yield same output', () => {
    const panels: Record<string, CockpitPanelRect | undefined> = {
      a: panel(true, 'right'),
      self: panel(false),
    }
    const a = chooseMobileMinimizeDockSideAutoBalance(panels, 'self', 50, 280, 400)
    const b = chooseMobileMinimizeDockSideAutoBalance(panels, 'self', 50, 280, 400)
    expect(a).toBe(b)
  })
})

describe('mobileFloatingCommitCoords (snap bypass contract)', () => {
  it('preserves exact clamped coordinates', () => {
    expect(mobileFloatingCommitCoords(42.3, 108.7)).toEqual({ x: 42.3, y: 108.7 })
  })
})

describe('mobile scroll / shell invariant', () => {
  it('floating max height uses agreed vh cap', () => {
    expect(MOBILE_FLOATING_MAX_HEIGHT_VH).toBe(78)
  })
})

describe('clampMobileToReachableViewport', () => {
  it('preserves explicit position when still reachable', () => {
    const pos = { x: 100, y: 120 }
    const out = clampMobileToReachableViewport(pos, { w: 280, h: 240 }, { vw: 390, vh: 844 })
    expect(out).toEqual(pos)
  })

  it('clamps only unreachable coordinates into viewport', () => {
    const out = clampMobileToReachableViewport(
      { x: 500, y: 900 },
      { w: 280, h: 240 },
      { vw: 390, vh: 844 },
    )
    expect(out.x).toBe(110)
    expect(out.y).toBe(604)
  })
})

describe('mobile resize ergonomics', () => {
  it('uses a field-safe resize hitbox', () => {
    expect(MOBILE_RESIZE_HITBOX_PX).toBeGreaterThanOrEqual(44)
    expect(MOBILE_RESIZE_HITBOX_PX).toBeLessThanOrEqual(56)
  })
})

describe('mobile panel size presets', () => {
  it('cycles compact/normal/large deterministically', () => {
    expect(cycleMobilePanelSizePreset('compact')).toBe('normal')
    expect(cycleMobilePanelSizePreset('normal')).toBe('large')
    expect(cycleMobilePanelSizePreset('large')).toBe('compact')
    expect(cycleMobilePanelSizePreset('custom')).toBe('normal')
  })

  it('returns deterministic bounded preset dimensions', () => {
    const compact = mobilePresetDimensions('compact', { vw: 390, vh: 844 }, { w: 120, h: 96 })
    const normal = mobilePresetDimensions('normal', { vw: 390, vh: 844 }, { w: 120, h: 96 })
    const large = mobilePresetDimensions('large', { vw: 390, vh: 844 }, { w: 120, h: 96 })
    expect(compact.w).toBeLessThan(normal.w)
    expect(normal.w).toBeLessThan(large.w)
    expect(compact.h).toBeLessThan(normal.h)
    expect(normal.h).toBeLessThan(large.h)
  })
})

describe('mobile focus mode', () => {
  it('de-emphasizes inactive panels without hiding them', () => {
    expect(mobileFocusOpacity(500, 500)).toBe(1)
    expect(mobileFocusOpacity(499, 500)).toBeGreaterThan(0.8)
    expect(mobileFocusOpacity(499, 500)).toBeLessThan(1)
  })
})

describe('mobile density control invariant', () => {
  it('uses a bounded deterministic auto-collapse timeout', () => {
    expect(MOBILE_DENSITY_COLLAPSE_IDLE_MS).toBeGreaterThanOrEqual(4000)
    expect(MOBILE_DENSITY_COLLAPSE_IDLE_MS).toBeLessThanOrEqual(15000)
  })
})

describe('viewport clamp dedupe', () => {
  it('dedupes same/near-identical clamp coordinates', () => {
    expect(shouldApplyViewportClampDeduped({ x: 10, y: 20 }, { x: 10.2, y: 20.1 })).toBe(false)
    expect(shouldApplyViewportClampDeduped({ x: 10, y: 20 }, { x: 11, y: 22 })).toBe(true)
    expect(shouldApplyViewportClampDeduped(null, { x: 11, y: 22 })).toBe(true)
  })
})

describe('material viewport recovery gate', () => {
  it('suppresses transient viewport churn', () => {
    expect(
      shouldRunMaterialViewportRecovery(
        { vw: 390, vh: 844 },
        { vw: 392, vh: 838 },
      ),
    ).toBe(false)
  })

  it('allows orientation/material-size recovery', () => {
    expect(
      shouldRunMaterialViewportRecovery(
        { vw: 390, vh: 844 },
        { vw: 844, vh: 390 },
      ),
    ).toBe(true)
    expect(
      shouldRunMaterialViewportRecovery(
        { vw: 390, vh: 844 },
        { vw: 450, vh: 844 },
      ),
    ).toBe(true)
  })
})

describe('mobile persistence sanitize', () => {
  it('sanitizes stale desktop coordinates into reachable mobile bounds', () => {
    const out = sanitizeMobilePanelRect(
      {
        x: 1400,
        y: 900,
        w: 600,
        h: 500,
        z: 1,
        minimized: false,
      },
      { vw: 390, vh: 844 },
    )
    expect(out.changed).toBe(true)
    expect(out.panel.x).toBeGreaterThanOrEqual(0)
    expect(out.panel.y).toBeGreaterThanOrEqual(36)
    expect(out.panel.w).toBeLessThanOrEqual(370)
    expect(out.reason).toBe('unreachable-clamp')
  })

  it('sanitizes non-finite panel coordinates safely', () => {
    const out = sanitizeMobilePanelRect(
      {
        x: Number.NaN,
        y: Number.POSITIVE_INFINITY,
        w: Number.NaN,
        h: null,
        z: 1,
        minimized: false,
      },
      { vw: 390, vh: 844 },
    )
    expect(out.changed).toBe(true)
    expect(Number.isFinite(out.panel.x)).toBe(true)
    expect(Number.isFinite(out.panel.y)).toBe(true)
    expect(Number.isFinite(out.panel.w)).toBe(true)
    expect(out.reason).toBe('non-finite-coordinates')
  })
})

describe('MOBILE_DRAG_EDGE_DOCK_DISABLED (contract)', () => {
  it('mobile drag release must not edge-dock', () => {
    expect(MOBILE_DRAG_EDGE_DOCK_DISABLED).toBe(true)
  })
})

describe('panel reachability', () => {
  it('reports reachable panel inside viewport bounds', () => {
    expect(
      isPanelReachableInViewport(
        { x: 12, y: 72 },
        { w: 280, h: 240 },
        { vw: 390, vh: 844 },
      ),
    ).toBe(true)
  })

  it('reports unreachable panel outside viewport bounds', () => {
    expect(
      isPanelReachableInViewport(
        { x: 2000, y: 72 },
        { w: 280, h: 240 },
        { vw: 390, vh: 844 },
      ),
    ).toBe(false)
  })
})

describe('dimension write suppression', () => {
  it('suppresses near-identical repeated dimensions', () => {
    expect(
      shouldSuppressRepeatedDimensionWrite(
        { w: 320, h: 240 },
        { w: 320.2, h: 240.2 },
      ),
    ).toBe(true)
  })

  it('allows material dimension changes', () => {
    expect(
      shouldSuppressRepeatedDimensionWrite(
        { w: 320, h: 240 },
        { w: 336, h: 260 },
      ),
    ).toBe(false)
  })
})
