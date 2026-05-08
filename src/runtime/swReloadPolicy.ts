export function shouldDeferReloadOnControllerChange(input: {
  inFlightVoiceGesture: boolean
  recovering: boolean
  gestureActive: boolean
}): boolean {
  return input.inFlightVoiceGesture || input.recovering || input.gestureActive
}

export function shouldFlushDeferredReload(input: {
  deferredReloadFlag: boolean
  inFlightVoiceGesture: boolean
  recovering: boolean
  gestureActive: boolean
}): boolean {
  if (!input.deferredReloadFlag) return false
  return !shouldDeferReloadOnControllerChange({
    inFlightVoiceGesture: input.inFlightVoiceGesture,
    recovering: input.recovering,
    gestureActive: input.gestureActive,
  })
}
