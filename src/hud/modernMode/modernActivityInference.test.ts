import { describe, expect, it } from 'vitest'
import {
  inferModernFieldActivity,
  resolveSensoryProfile,
  resolveRuntimeTone,
} from './modernActivityInference'

const base = {
  emergency: false,
  routeNavigating: false,
  missionActive: false,
  weatherIntense: false,
  weatherStorm: false,
  hazardOverlay: false,
  terrainOverlay: false,
  hourLocal: 14,
}

describe('modernActivityInference', () => {
  it('prioritizes emergency over movement', () => {
    expect(
      inferModernFieldActivity({ ...base, emergency: true, speedMs: 10 }),
    ).toBe('emergency')
  })

  it('infers driving at highway speeds', () => {
    expect(inferModernFieldActivity({ ...base, speedMs: 8 })).toBe('driving')
  })

  it('infers biking at moderate speeds', () => {
    expect(inferModernFieldActivity({ ...base, speedMs: 4 })).toBe('biking')
  })

  it('infers hiking on foot', () => {
    expect(
      inferModernFieldActivity({ ...base, speedMs: 1.2, terrainOverlay: true }),
    ).toBe('hiking')
  })

  it('enables glance mode for biking', () => {
    const profile = resolveSensoryProfile('biking', 'travel', 'balanced', 4)
    expect(profile.glanceMode).toBe(true)
    expect(profile.suppressDecor).toBe(true)
    expect(profile.hapticGuidance).toBe(true)
  })

  it('uses calm tone for fishing', () => {
    expect(resolveRuntimeTone('fishing', 'stationary', false)).toBe('calm')
  })

  it('uses urgent tone for emergency focus', () => {
    expect(resolveRuntimeTone('stationary', 'emergency', false)).toBe('urgent')
  })
})
