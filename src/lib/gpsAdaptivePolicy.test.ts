import { describe, expect, it } from 'vitest'
import { chooseGpsPowerMode, type AdaptiveGpsSignals } from './gpsAdaptivePolicy'

const base: AdaptiveGpsSignals = {
  accuracyM: 12,
  speedMs: 0.2,
  inferredSpeedMs: 0.2,
  stableHeadingStreak: 0,
  stationaryAccumulatorMs: 0,
  emergencyBypass: false,
}

describe('chooseGpsPowerMode', () => {
  it('forces active navigation when emergency bypass is on', () => {
    expect(chooseGpsPowerMode({ ...base, emergencyBypass: true, stationaryAccumulatorMs: 999_999 })).toBe(
      'active_navigation',
    )
  })

  it('selects active navigation when accuracy is unknown or poor', () => {
    expect(chooseGpsPowerMode({ ...base, accuracyM: null })).toBe('active_navigation')
    expect(chooseGpsPowerMode({ ...base, accuracyM: 60 })).toBe('active_navigation')
  })

  it('selects active navigation when motion is significant', () => {
    expect(chooseGpsPowerMode({ ...base, speedMs: 2, inferredSpeedMs: 0 })).toBe('active_navigation')
  })

  it('selects stable tracking when fix is tight, motion modest, and heading stable', () => {
    expect(
      chooseGpsPowerMode({
        ...base,
        accuracyM: 18,
        speedMs: 0.25,
        inferredSpeedMs: 0.25,
        stableHeadingStreak: 5,
        stationaryAccumulatorMs: 5000,
      }),
    ).toBe('stable_tracking')
  })

  it('selects stationary low power after sustained stillness', () => {
    expect(
      chooseGpsPowerMode({
        ...base,
        accuracyM: 20,
        speedMs: 0.05,
        inferredSpeedMs: 0.05,
        stableHeadingStreak: 8,
        stationaryAccumulatorMs: 50_000,
      }),
    ).toBe('stationary_low')
  })
})
