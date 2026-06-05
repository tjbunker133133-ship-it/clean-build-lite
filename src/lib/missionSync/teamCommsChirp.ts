/** Short operational chirp — no dependency on VoicePanel / SOS audio paths. */
import { shouldPlayMissionCommsAudio } from './missionCommsAudio'

export function playTeamCommsChirp(directed = false): void {
  if (!shouldPlayMissionCommsAudio()) return
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const playTone = (freq: number, start: number, duration: number, gainPeak: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(gainPeak, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + duration + 0.02)
    }
    const t0 = ctx.currentTime
    if (directed) {
      playTone(620, t0, 0.09, 0.06)
      playTone(880, t0 + 0.11, 0.11, 0.07)
    } else {
      playTone(740, t0, 0.12, 0.06)
    }
    window.setTimeout(() => void ctx.close(), directed ? 320 : 220)
  } catch {
    // audio optional in field
  }
}
