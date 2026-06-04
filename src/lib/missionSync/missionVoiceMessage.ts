import {
  armRecognitionIgnoreUntil,
  setRecognitionOutputHold,
  speakHudPhrase,
} from '../../runtime/voiceAudioArbitration'
import { sanitizeBurstText } from './comms'

const CAPTURE_MAX_MS = 14_000
const TTS_RATE = 1.05

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
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Hold-to-talk capture — Web Speech API STT (sends as text over mesh, not audio). */
export async function captureMissionVoiceTranscript(
  maxMs = CAPTURE_MAX_MS,
): Promise<string | null> {
  const SR = getSpeechRecognition()
  if (!SR) return null

  setRecognitionOutputHold(true)
  return new Promise((resolve) => {
    let settled = false
    const finals: string[] = []
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.maxAlternatives = 1

    const finish = (text: string | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(capTimer)
      setRecognitionOutputHold(false)
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
      resolve(text)
    }

    const capTimer = window.setTimeout(() => finish(sanitizeBurstText(finals.join(' ')) || null), maxMs)

    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const r = ev.results[i]
        if (r?.isFinal && r[0]?.transcript) finals.push(r[0].transcript.trim())
      }
    }
    rec.onerror = () => finish(sanitizeBurstText(finals.join(' ')) || null)
    rec.onend = () => finish(sanitizeBurstText(finals.join(' ')) || null)

    try {
      rec.start()
    } catch {
      finish(null)
    }
  })
}

export async function speakMissionCommsPhrase(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  await speakHudPhrase(trimmed, TTS_RATE)
  if (typeof performance !== 'undefined') {
    armRecognitionIgnoreUntil(performance.now() + 1200)
  }
}

export async function speakSendingTo(targetLabel: string): Promise<void> {
  await speakMissionCommsPhrase(`Sending to ${targetLabel}.`)
}

export async function speakInboundTeamMessage(callsign: string, text: string): Promise<void> {
  const body = sanitizeBurstText(text)
  if (!body) return
  await speakMissionCommsPhrase(`Message from ${callsign}. ${body}`)
}
