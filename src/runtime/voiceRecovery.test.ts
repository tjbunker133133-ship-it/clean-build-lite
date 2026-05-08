import { describe, expect, it } from 'vitest'
import { shouldAttemptVoiceRecovery, shouldTreatOnEndAsLifecycleSuspend } from './voiceRecovery'

describe('shouldTreatOnEndAsLifecycleSuspend', () => {
  it('treats hidden onend as lifecycle suspension when armed', () => {
    expect(shouldTreatOnEndAsLifecycleSuspend({ armed: true, visibilityState: 'hidden' })).toBe(true)
  })

  it('does not treat visible onend as suspension', () => {
    expect(shouldTreatOnEndAsLifecycleSuspend({ armed: true, visibilityState: 'visible' })).toBe(false)
  })
})

describe('shouldAttemptVoiceRecovery', () => {
  it('attempts recovery only once while armed and suspended', () => {
    expect(
      shouldAttemptVoiceRecovery({
        armed: true,
        suspendedByLifecycle: true,
        recoveryAttempted: false,
      }),
    ).toBe(true)
    expect(
      shouldAttemptVoiceRecovery({
        armed: true,
        suspendedByLifecycle: true,
        recoveryAttempted: true,
      }),
    ).toBe(false)
  })
})
