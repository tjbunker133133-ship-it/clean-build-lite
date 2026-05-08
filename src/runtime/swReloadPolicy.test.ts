import { describe, expect, it } from 'vitest'
import { shouldDeferReloadOnControllerChange, shouldFlushDeferredReload } from './swReloadPolicy'

describe('shouldDeferReloadOnControllerChange', () => {
  it('defers reload when any blocking runtime condition exists', () => {
    expect(
      shouldDeferReloadOnControllerChange({
        inFlightVoiceGesture: true,
        recovering: false,
        gestureActive: false,
      }),
    ).toBe(true)
    expect(
      shouldDeferReloadOnControllerChange({
        inFlightVoiceGesture: false,
        recovering: true,
        gestureActive: false,
      }),
    ).toBe(true)
    expect(
      shouldDeferReloadOnControllerChange({
        inFlightVoiceGesture: false,
        recovering: false,
        gestureActive: true,
      }),
    ).toBe(true)
  })

  it('allows reload when runtime is stable', () => {
    expect(
      shouldDeferReloadOnControllerChange({
        inFlightVoiceGesture: false,
        recovering: false,
        gestureActive: false,
      }),
    ).toBe(false)
  })
})

describe('shouldFlushDeferredReload', () => {
  it('flushes deferred reload only when no blockers remain', () => {
    expect(
      shouldFlushDeferredReload({
        deferredReloadFlag: true,
        inFlightVoiceGesture: false,
        recovering: false,
        gestureActive: false,
      }),
    ).toBe(true)
    expect(
      shouldFlushDeferredReload({
        deferredReloadFlag: true,
        inFlightVoiceGesture: true,
        recovering: false,
        gestureActive: false,
      }),
    ).toBe(false)
  })
})
