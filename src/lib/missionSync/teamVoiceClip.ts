/**
 * Inbound mission voice clip playback (legacy mesh transport).
 *
 * Outbound clip recording/streaming was removed 2026-05-28 — primary comms model is
 * STT → transcript → confirm → sendTeamBurst (text) → remote TTS.
 */
import type { MissionVoiceClip } from './types'

export const VOICE_CLIP_MIME = 'audio/webm'

export function voiceClipTargetsLocalDevice(clip: MissionVoiceClip, localDeviceId: string): boolean {
  if (!clip.toDeviceId) return true
  return clip.toDeviceId === localDeviceId
}

export function playVoiceClip(clip: MissionVoiceClip): void {
  try {
    const src = `data:${clip.mime};base64,${clip.audioB64}`
    const audio = new Audio(src)
    audio.volume = 0.9
    void audio.play()
  } catch {
    // playback optional
  }
}
