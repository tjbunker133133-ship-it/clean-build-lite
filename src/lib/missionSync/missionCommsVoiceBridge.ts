export type MissionCommsVoiceHandleResult = {
  handled: boolean
  ok: boolean
  feedback: string
}

type Handler = (phrase: string) => Promise<MissionCommsVoiceHandleResult>

let handler: Handler | null = null
let lastHandledPhrase = ''
let lastHandledAt = 0
const PHRASE_DEDUPE_MS = 1_800

export function setMissionCommsVoiceHandler(fn: Handler | null): void {
  handler = fn
}

export async function tryHandleMissionCommsVoice(
  phrase: string,
): Promise<MissionCommsVoiceHandleResult | null> {
  if (!handler) return null
  const trimmed = phrase.trim()
  if (!trimmed) return null
  const now = Date.now()
  if (
    trimmed.toLowerCase() === lastHandledPhrase.toLowerCase() &&
    now - lastHandledAt < PHRASE_DEDUPE_MS
  ) {
    return { handled: true, ok: true, feedback: 'OK.' }
  }
  const res = await handler(trimmed)
  if (res.handled) {
    lastHandledPhrase = trimmed
    lastHandledAt = now
  }
  return res.handled ? res : null
}
