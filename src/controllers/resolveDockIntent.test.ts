import { describe, expect, it } from 'vitest'
import { resolveDockIntent } from './resolveDockIntent'
import type { DockIntentContext } from './InteractionController'

function ctx(isMobile: boolean): DockIntentContext {
  return { isMobile }
}

describe('resolveDockIntent', () => {
  it('allows only explicit minimize docking on mobile', () => {
    expect(resolveDockIntent('minimize', ctx(true))).toBe(true)
    expect(resolveDockIntent('drag', ctx(true))).toBe(false)
    expect(resolveDockIntent('toggle', ctx(true))).toBe(false)
  })

  it('keeps desktop docking behavior unchanged', () => {
    expect(resolveDockIntent('minimize', ctx(false))).toBe(true)
    expect(resolveDockIntent('drag', ctx(false))).toBe(true)
    expect(resolveDockIntent('toggle', ctx(false))).toBe(true)
  })
})
