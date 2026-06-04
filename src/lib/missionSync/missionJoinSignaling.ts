import {
  MissionJoinCodeChannel,
  isJoinCodeSignalingAvailable,
  type JoinCodeAnswerMessage,
  type JoinCodeOfferMessage,
} from './missionJoinCodeChannel'
import { formatJoinCode, normalizeJoinCodeInput } from './joinCode'

export { isJoinCodeSignalingAvailable }

export async function publishJoinCodeOffer(args: {
  code: string
  encoded: string
  missionId: string
  fromDeviceId: string
}): Promise<boolean> {
  if (!isJoinCodeSignalingAvailable()) return false
  const normalized = normalizeJoinCodeInput(args.code)
  if (normalized.length !== 6) return false
  const ch = new MissionJoinCodeChannel(normalized)
  try {
    const msg: JoinCodeOfferMessage = {
      kind: 'offer',
      encoded: args.encoded,
      missionId: args.missionId,
      fromDeviceId: args.fromDeviceId,
      at: Date.now(),
    }
    return await ch.publish(msg)
  } finally {
    ch.dispose()
  }
}

export async function publishJoinCodeAnswer(args: {
  code: string
  encoded: string
  fromDeviceId: string
}): Promise<boolean> {
  if (!isJoinCodeSignalingAvailable()) return false
  const normalized = normalizeJoinCodeInput(args.code)
  if (normalized.length !== 6) return false
  const ch = new MissionJoinCodeChannel(normalized)
  try {
    const msg: JoinCodeAnswerMessage = {
      kind: 'answer',
      encoded: args.encoded,
      fromDeviceId: args.fromDeviceId,
      at: Date.now(),
    }
    return await ch.publish(msg)
  } finally {
    ch.dispose()
  }
}

export function subscribeJoinCodeRoom(
  codeInput: string,
  handlers: {
    onOffer?: (msg: JoinCodeOfferMessage) => void
    onAnswer?: (msg: JoinCodeAnswerMessage) => void
  },
): () => void {
  if (!isJoinCodeSignalingAvailable()) return () => {}
  const normalized = normalizeJoinCodeInput(codeInput)
  if (normalized.length !== 6) return () => {}
  const ch = new MissionJoinCodeChannel(normalized)
  return ch.connect(handlers)
}

export function joinCodeSignalingHint(codeInput: string): string {
  const label = formatJoinCode(codeInput)
  return `Mission code ${label} — linking over Wi‑Fi (no paste). Code must match the host screen exactly.`
}
