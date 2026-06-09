import { describe, expect, it } from 'vitest'
import {
  TRANSITION_MATRIX,
  pointerOwnerForMode,
  resolveTransitionPath,
  validateModeTransition,
} from './transitions'

describe('operationalStateGraph transitions (v1.0 matrix)', () => {
  const ctx = { measurementPointCount: 0, missionActive: false }

  it('encodes the spec matrix for blocked direct transitions', () => {
    expect(TRANSITION_MATRIX.measure.route).toBe('deny')
    expect(TRANSITION_MATRIX.route.measure).toBe('deny')
    expect(TRANSITION_MATRIX.mission.measure).toBe('deny')
    expect(TRANSITION_MATRIX.navigation.measure).toBe('deny')
    expect(TRANSITION_MATRIX.measure.mission).toBe('conditional')
  })

  it('resolves denied transitions through idle hub', () => {
    expect(resolveTransitionPath('route', 'measure', ctx)).toEqual(['idle', 'measure'])
    expect(resolveTransitionPath('measure', 'route', ctx)).toEqual(['idle', 'route'])
    expect(resolveTransitionPath('mission', 'measure', ctx)).toEqual(['idle', 'measure'])
  })

  it('allows direct transitions from idle', () => {
    for (const to of ['measure', 'route', 'mission', 'radial', 'navigation'] as const) {
      const v = validateModeTransition('idle', to, ctx)
      expect(v.allowed).toBe(true)
      expect(v.resolvedPath).toEqual([to])
    }
  })

  it('blocks MEASURE→MISSION when measurement has points unless path clears measure', () => {
    const blocked = validateModeTransition('measure', 'mission', {
      ...ctx,
      measurementPointCount: 2,
    })
    expect(blocked.allowed).toBe(true)
    expect(blocked.resolvedPath).toEqual(['idle', 'mission'])

    const allowed = validateModeTransition('measure', 'mission', ctx)
    expect(allowed.allowed).toBe(true)
    expect(allowed.resolvedPath).toEqual(['mission'])
  })

  it('assigns pointer ownership per spec', () => {
    expect(pointerOwnerForMode('idle', null)).toBe('map')
    expect(pointerOwnerForMode('navigation', null)).toBe('map')
    expect(pointerOwnerForMode('mission', null)).toBe('mission')
    expect(pointerOwnerForMode('measure', null)).toBe('measure')
    expect(pointerOwnerForMode('route', null)).toBe('route')
    expect(pointerOwnerForMode('radial', null)).toBe('radial')
  })

  it('always allows radial as transient overlay target', () => {
    for (const from of ['idle', 'measure', 'route', 'mission', 'navigation'] as const) {
      const v = validateModeTransition(from, 'radial', ctx)
      expect(v.allowed).toBe(true)
    }
  })
})
