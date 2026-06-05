import {
  armRecognitionIgnoreUntil,
  setRecognitionOutputHold,
} from '../../runtime/voiceAudioArbitration'
import { getRuntimeActivityLevel } from '../../runtime/runtimeActivityPolicy'
import { isFieldSessionBackgrounded } from '../../runtime/fieldLifecycle'
import { sanitizeBurstText } from './comms'
import { shouldPlayMissionCommsAudio } from './missionCommsAudio'
// C2 FIX: Mission voice MUST use authority controller — no direct TTS bypass
import {
  startSpeech,
  VOICE_PRIORITY,
} from '../../lib/voice/voiceAuthorityController'

const CAPTURE_MAX_MS = 14_000
const TTS_RATE = 1.05
const MIN_CAPTURE_GAP_MS = 1_800

type BrowserSpeechRecognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onresult: ((ev: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; 0?: { transcript: string } } } }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort?: () => void
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition

let activeCaptureRec: BrowserSpeechRecognition | null = null
let captureSessionActive = false
let lastCaptureEndedMs = 0
let lastDeliveredTranscript = ''
let lastDeliveredAt = 0

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Stop hold-to-talk capture when user releases the mic button. */
export function stopMissionVoiceCapture(): void {
  try {
    activeCaptureRec?.stop()
  } catch {
    /* ignore */
  }
}

function pickBestFinalTranscript(finals: string[]): string {
  if (finals.length === 0) return ''
  return finals.reduce((best, cur) => (cur.length > best.length ? cur : best), '')
}

function shouldAllowMissionVoiceCapture(): boolean {
  if (isFieldSessionBackgrounded()) return false
  if (getRuntimeActivityLevel() === 'BACKGROUND') return false
  if (typeof document !== 'undefined' && document.hidden) return false
  return true
}

/** Hold-to-talk capture — single final phrase only; no partial echo spam. */
export async function captureMissionVoiceTranscript(
  maxMs = CAPTURE_MAX_MS,
): Promise<string | null> {
  const SR = getSpeechRecognition()
  if (!SR || !shouldAllowMissionVoiceCapture()) return null

  const now = Date.now()
  if (captureSessionActive || now - lastCaptureEndedMs < MIN_CAPTURE_GAP_MS) {
    return null
  }

  captureSessionActive = true
  setRecognitionOutputHold(true)
  return new Promise((resolve) => {
    let settled = false
    const finals: string[] = []
    const rec = new SR()
    activeCaptureRec = rec
    rec.continuous = false
    rec.interimResults = false
    rec.lang = 'en-US'
    rec.maxAlternatives = 1

    const finish = (text: string | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(capTimer)
      activeCaptureRec = null
      captureSessionActive = false
      lastCaptureEndedMs = Date.now()
      setRecognitionOutputHold(false)
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
      const clean = text ? sanitizeBurstText(text) : null
      if (clean && clean === lastDeliveredTranscript && Date.now() - lastDeliveredAt < MIN_CAPTURE_GAP_MS) {
        resolve(null)
        return
      }
      if (clean) {
        lastDeliveredTranscript = clean
        lastDeliveredAt = Date.now()
      }
      resolve(clean)
    }

    const capTimer = window.setTimeout(
      () => finish(pickBestFinalTranscript(finals) || null),
      maxMs,
    )

    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const r = ev.results[i]
        if (r?.isFinal && r[0]?.transcript) {
          const t = r[0].transcript.trim()
          if (t) finals.push(t)
        }
      }
    }
    rec.onerror = () => finish(pickBestFinalTranscript(finals) || null)
    rec.onend = () => finish(pickBestFinalTranscript(finals) || null)

    try {
      rec.start()
    } catch {
      finish(null)
    }
  })
}

export function _resetMissionVoiceCaptureForTests(): void {
  activeCaptureRec = null
  captureSessionActive = false
  lastCaptureEndedMs = 0
  lastDeliveredTranscript = ''
  lastDeliveredAt = 0
}

// C2 FIX: All mission voice now routes through authority controller
// This ensures safety alerts can interrupt mission voice immediately

export async function speakMissionCommsPhrase(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed || !shouldPlayMissionCommsAudio()) return

  // C2 FIX: Use authority controller with USER_COMMAND priority
  // SAFETY (100) > USER_COMMAND (80) — safety alerts will interrupt
  startSpeech(trimmed, VOICE_PRIORITY.USER_COMMAND, 'mission-voice')

  if (typeof performance !== 'undefined') {
    armRecognitionIgnoreUntil(performance.now() + 1200)
  }
}

export async function speakSendingTo(targetLabel: string): Promise<void> {
  await speakMissionCommsPhrase(`Sending to ${targetLabel}.`)
}

export async function speakInboundTeamMessage(
  callsign: string,
  text: string,
  onComplete?: () => void,
): Promise<void> {
  const body = sanitizeBurstText(text)
  if (!body || !shouldPlayMissionCommsAudio()) {
    // If not playing audio, still invoke completion so UI can auto-dismiss
    onComplete?.()
    return
  }
  const phrase = `${callsign} says: ${body}`

  setRecognitionOutputHold(true)
  // C2 FIX: Route through authority controller instead of direct TTS
  // Pass completion callback for auto-dismiss after successful playback
  const result = startSpeech(phrase, VOICE_PRIORITY.USER_COMMAND, 'mission-voice-inbound', onComplete)
  setRecognitionOutputHold(false)

  // If speech was blocked (priority, etc), still call completion so UI clears
  if (!result.started) {
    onComplete?.()
  }

  if (typeof performance !== 'undefined') {
    armRecognitionIgnoreUntil(performance.now() + 2_800)
  }
}
