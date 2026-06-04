export type MissionCommsVoiceHandleResult = {
  handled: boolean
  ok: boolean
  feedback: string
}

type Handler = (phrase: string) => Promise<MissionCommsVoiceHandleResult>

let handler: Handler | null = null

export function setMissionCommsVoiceHandler(fn: Handler | null): void {
  handler = fn
}

export async function tryHandleMissionCommsVoice(
  phrase: string,
): Promise<MissionCommsVoiceHandleResult | null> {
  if (!handler) return null
  const trimmed = phrase.trim()
  if (!trimmed) return null
  const res = await handler(trimmed)
  return res.handled ? res : null
}
