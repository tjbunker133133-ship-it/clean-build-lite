import type { MissionVoiceClip } from './types'
import type { TeamBurstTarget } from './teamComms'

export const VOICE_CLIP_MAX_MS = 12_000
export const VOICE_CLIP_MIN_INTERVAL_MS = 5_000
export const VOICE_CLIP_MAX_B64_LEN = 52_000
export const VOICE_CLIP_MIME = 'audio/webm'

export function buildVoiceClip(
  deviceId: string,
  callsign: string,
  audioB64: string,
  durationMs: number,
  target?: TeamBurstTarget,
): MissionVoiceClip | null {
  if (!audioB64 || audioB64.length > VOICE_CLIP_MAX_B64_LEN) return null
  if (durationMs < 300 || durationMs > VOICE_CLIP_MAX_MS) return null
  const clip: MissionVoiceClip = {
    deviceId,
    callsign,
    sentAt: Date.now(),
    durationMs: Math.round(durationMs),
    mime: VOICE_CLIP_MIME,
    audioB64,
  }
  if (target?.scope === 'direct') {
    clip.toDeviceId = target.deviceId
    clip.toCallsign = target.callsign
  }
  return clip
}

export function voiceClipTargetsLocalDevice(clip: MissionVoiceClip, localDeviceId: string): boolean {
  if (!clip.toDeviceId) return true
  return clip.toDeviceId === localDeviceId
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const data = reader.result
      if (typeof data !== 'string') {
        reject(new Error('read failed'))
        return
      }
      const comma = data.indexOf(',')
      resolve(comma >= 0 ? data.slice(comma + 1) : data)
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
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

export type VoiceRecordResult = {
  blob: Blob
  durationMs: number
  mime: string
}

export type VoiceRecorderSession = {
  stop: () => Promise<VoiceRecordResult | null>
  cancel: () => void
}

/** Hold-to-record — call stop() on pointer up (auto-stops at maxMs). */
export async function startVoiceRecorder(maxMs = VOICE_CLIP_MAX_MS): Promise<VoiceRecorderSession | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mime = MediaRecorder.isTypeSupported(VOICE_CLIP_MIME)
    ? VOICE_CLIP_MIME
    : 'audio/mp4'
  const recorder = new MediaRecorder(stream, { mimeType: mime })
  const chunks: Blob[] = []
  const started = Date.now()
  let settled = false
  const capTimer = window.setTimeout(() => {
    if (recorder.state === 'recording') recorder.stop()
  }, maxMs)

  const teardown = () => {
    window.clearTimeout(capTimer)
    stream.getTracks().forEach((t) => t.stop())
  }

  return new Promise((resolve) => {
    const finish = (blob: Blob | null): VoiceRecordResult | null => {
      if (settled) return null
      settled = true
      teardown()
      if (!blob) return null
      return { blob, durationMs: Date.now() - started, mime }
    }

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data)
    }
    recorder.onstop = () => {
      /* handled in stop() */
    }
    recorder.onerror = () => {
      settled = true
      teardown()
    }
    recorder.start(200)

    resolve({
      stop: () =>
        new Promise((res) => {
          if (settled) {
            res(null)
            return
          }
          recorder.onstop = () => {
            res(finish(chunks.length > 0 ? new Blob(chunks, { type: mime }) : null))
          }
          if (recorder.state === 'recording') recorder.stop()
          else res(finish(null))
        }),
      cancel: () => {
        settled = true
        teardown()
        try {
          if (recorder.state === 'recording') recorder.stop()
        } catch {
          /* ignore */
        }
      },
    })
  })
}

const VOICE_PREFIXES = [
  'voice message ',
  'send voice ',
  'voice to ',
  'radio ',
]

export function parseVoiceMessageCommand(
  normalized: string,
  raw: string,
): { callsign?: string } | null {
  const n = normalized.trim()
  for (const prefix of VOICE_PREFIXES) {
    if (!n.startsWith(prefix)) continue
    const rest = n.slice(prefix.length).trim()
    if (!rest || ['team', 'all', 'everyone'].includes(rest)) return {}
    return { callsign: rest.split(/\s+/)[0] }
  }
  const hud = raw.toLowerCase().replace(/^hud\s+/i, '').trim()
  for (const prefix of VOICE_PREFIXES) {
    if (!hud.startsWith(prefix)) continue
    const rest = hud.slice(prefix.length).trim()
    if (!rest || ['team', 'all'].includes(rest)) return {}
    return { callsign: rest.split(/\s+/)[0] }
  }
  return null
}
