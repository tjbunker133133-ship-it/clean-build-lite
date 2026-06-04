import { decodeMissionPacket, packetFitsCompactQr } from './codec'
import { isObserverOffer } from './linkRole'

const MAX_URL_BUNDLE_LEN = 1900

export type PendingMonitorJoin =
  | { kind: 'bundle'; encoded: string }
  | { kind: 'token'; missionId: string; token: string; missionName?: string }

export function buildWatchMeUrl(args: {
  encodedOffer?: string | null
  missionId?: string
  observerToken?: string
  missionName?: string
}): string {
  if (typeof window === 'undefined') return '/'
  const url = new URL(window.location.origin)
  url.pathname = '/'

  const encoded = args.encodedOffer?.trim()
  if (encoded && encoded.length <= MAX_URL_BUNDLE_LEN) {
    url.searchParams.set('watch', encoded)
    return url.toString()
  }

  const missionId = args.missionId?.trim()
  const token = args.observerToken?.trim()
  if (missionId && token) {
    url.searchParams.set('mission', missionId)
    url.searchParams.set('token', token)
    if (args.missionName?.trim()) {
      url.searchParams.set('name', args.missionName.trim().slice(0, 48))
    }
    return url.toString()
  }

  if (encoded) {
    const packet = decodeMissionPacket(encoded)
    if (packet && packet.t === 'mission-offer' && isObserverOffer(packet)) {
      url.searchParams.set('mission', packet.missionId)
      if (packet.observerToken) url.searchParams.set('token', packet.observerToken)
      if (packet.missionName) url.searchParams.set('name', packet.missionName.slice(0, 48))
      return url.toString()
    }
  }

  return url.toString()
}

export function buildWatchMeInviteText(args: {
  operatorLabel: string
  url: string
}): string {
  const who = args.operatorLabel.trim() || 'Your teammate'
  return [
    `${who} shared their live map on Signal One.`,
    '',
    'Tap the link on your phone — the app opens and follows their GPS (read-only).',
    args.url,
    '',
    'No copy/paste needed. Keep the HUD open while you watch.',
  ].join('\n')
}

export function parseWatchMeLocation(search: string): PendingMonitorJoin | null {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`)
  const watch = params.get('watch')?.trim()
  if (watch && watch.startsWith('HUDMS1:')) {
    const packet = decodeMissionPacket(watch)
    if (packet && packet.t === 'mission-offer' && isObserverOffer(packet)) {
      return { kind: 'bundle', encoded: watch }
    }
  }

  const missionId = params.get('mission')?.trim()
  const token = params.get('token')?.trim()
  if (missionId && token && token.length >= 8) {
    return {
      kind: 'token',
      missionId,
      token,
      missionName: params.get('name')?.trim() || undefined,
    }
  }

  return null
}

export function watchOfferFitsShareUrl(encoded: string): boolean {
  return encoded.length > 0 && encoded.length <= MAX_URL_BUNDLE_LEN
}

export function watchOfferFitsQr(encoded: string): boolean {
  return packetFitsCompactQr(encoded)
}
