import { isFieldSessionBackgrounded } from '../../runtime/fieldLifecycle'
import { getRuntimeActivityLevel } from '../../runtime/runtimeActivityPolicy'

/** Non-blocking gate — mission TTS/chirp respects background and battery saver. SOS paths unchanged. */
export function shouldPlayMissionCommsAudio(): boolean {
  if (isFieldSessionBackgrounded()) return false
  if (getRuntimeActivityLevel() === 'BACKGROUND') return false
  if (typeof document !== 'undefined' && document.hidden) return false
  try {
    if (typeof document !== 'undefined' && document.documentElement.dataset.cockpitScreenHue === 'low_light') {
      return false
    }
  } catch {
    /* ignore */
  }
  return true
}
