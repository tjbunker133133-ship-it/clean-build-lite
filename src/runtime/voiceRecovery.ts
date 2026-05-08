export function shouldTreatOnEndAsLifecycleSuspend(input: {
  armed: boolean
  visibilityState: DocumentVisibilityState | 'visible' | 'hidden'
}): boolean {
  return input.armed && input.visibilityState === 'hidden'
}

export function shouldAttemptVoiceRecovery(input: {
  armed: boolean
  suspendedByLifecycle: boolean
  recoveryAttempted: boolean
}): boolean {
  return input.armed && input.suspendedByLifecycle && !input.recoveryAttempted
}
