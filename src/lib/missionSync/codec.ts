import type { MissionAnswerPacket, MissionOfferPacket } from './types'
import { MISSION_SYNC_PROTOCOL_VERSION } from './types'

const PACKET_PREFIX = 'HUDMS1:'

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(b64: string): Uint8Array {
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/') + pad
  const binary = atob(norm)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

export function encodeMissionPacket(packet: MissionOfferPacket | MissionAnswerPacket): string {
  const json = JSON.stringify(packet)
  const bytes = new TextEncoder().encode(json)
  return PACKET_PREFIX + bytesToBase64Url(bytes)
}

export function decodeMissionPacket(
  raw: string,
): MissionOfferPacket | MissionAnswerPacket | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith(PACKET_PREFIX)) return null
  try {
    const bytes = base64UrlToBytes(trimmed.slice(PACKET_PREFIX.length))
    const json = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(json) as Record<string, unknown>
    if (parsed.v !== MISSION_SYNC_PROTOCOL_VERSION) return null
    if (parsed.t === 'mission-offer' && typeof parsed.sdp === 'object') {
      return parsed as MissionOfferPacket
    }
    if (parsed.t === 'mission-answer' && typeof parsed.sdp === 'object') {
      return parsed as MissionAnswerPacket
    }
    return null
  } catch {
    return null
  }
}

/** QR works reliably under ~1.8k chars on field tablets. */
export function packetFitsCompactQr(encoded: string): boolean {
  return encoded.length > 0 && encoded.length <= 1800
}
