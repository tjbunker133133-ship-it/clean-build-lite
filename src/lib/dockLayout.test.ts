import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CockpitPanelRect } from '../types/cockpit'
import { relayoutDockedPanels } from '../context/CockpitContext'

vi.mock('../lib/viewport', () => ({
  cockpitViewport: () => ({ vw: 390, vh: 844 }),
}))

beforeEach(() => {
  vi.stubGlobal('window', {
    __HUD_RUNTIME__: {
      layout: { dock: true, panels: true, cockpit: true, overlays: true },
    },
  })
})

function dockedPanel(y: number, side: 'left' | 'right' = 'left'): CockpitPanelRect {
  return {
    x: 0,
    y,
    w: 280,
    h: null,
    z: 400,
    minimized: true,
    docked: true,
    dockSide: side,
  }
}

describe('relayoutDockedPanels', () => {
  it('assigns unique vertical slots on the same rail', () => {
    const panels = {
      layers: dockedPanel(48, 'left'),
      waypoints: dockedPanel(48, 'left'),
      situation: dockedPanel(48, 'left'),
    }
    const next = relayoutDockedPanels(panels)
    const ys = Object.values(next)
      .filter((p) => p.docked && p.dockSide === 'left')
      .map((p) => p.y)
      .sort((a, b) => a - b)
    expect(ys).toHaveLength(3)
    expect(new Set(ys).size).toBe(3)
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(80)
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(80)
  })

  it('keeps left and right rails independent', () => {
    const panels = {
      layers: dockedPanel(200, 'left'),
      voice: dockedPanel(200, 'right'),
    }
    const next = relayoutDockedPanels(panels)
    expect(next.layers.x).toBeLessThan(next.voice.x)
    expect(next.layers.y).toBe(next.voice.y)
  })
})
