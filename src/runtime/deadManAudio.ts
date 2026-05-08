/**
 * DEAD-MAN AUDIO GATE — temporary, non-destructive suppression flag.
 *
 * This module is the SINGLE SOURCE OF TRUTH for whether the dead-man
 * subsystem is allowed to play audible alerts (SpeechSynthesis utterances
 * announcing escalations / expiry).
 *
 * IMPORTANT — this gate suppresses ONLY the audible playback layer.
 * Every other dead-man behavior must continue to operate identically:
 *   - countdown timer (useDeadMan)
 *   - timer persistence (localStorage `trailmap_deadman_v1`)
 *   - reset / +1 hour extend / activate / deactivate
 *   - duration window selection
 *   - warning / critical / expired thresholds
 *   - 60-second renew window
 *   - rescue payload dispatch (sendDeadmanRescue)
 *   - visual UI alerts (status text, color/pulse, progress bar)
 *   - runtime state reporting
 *
 * To re-enable audio later, flip `DEAD_MAN_AUDIO_ENABLED` to `true`. No
 * other code change is required. The audio call sites still exist and
 * are reachable; the helper that wraps them simply becomes a no-op log
 * line while this flag is `false`.
 *
 * Re-enable steps (when ready):
 *   1. Set `DEAD_MAN_AUDIO_ENABLED = true` below.
 *   2. (optional) Remove the `[DEADMAN] audioSuppressed=true` log lines
 *      if they become noisy.
 *   3. Run `tsc --noEmit && npm run build`.
 */

export const DEAD_MAN_AUDIO_ENABLED = true

export function isDeadManAudioEnabled(): boolean {
  return DEAD_MAN_AUDIO_ENABLED
}
