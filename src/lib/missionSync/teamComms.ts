import { filterTeammatePresence } from './presence'
import type { ConnectedPeer, TeamPresence } from './types'
import type { MissionBurst } from './types'

export type MessageableTeammate = {
  deviceId: string
  callsign: string
  peerId?: string
  onMap: boolean
  meshLinked: boolean
  linkRole?: ConnectedPeer['linkRole']
}

/** Optional directed target — omitted means whole field team (+ relay to watchers). */
export type TeamBurstTarget =
  | { scope: 'team' }
  | { scope: 'direct'; peerId: string; deviceId: string; callsign: string }

/** Resolve any connected mission peer (field or watcher) by callsign. */
export function resolveMissionPeerByCallsign(
  peers: ConnectedPeer[],
  callsignQuery: string,
): ConnectedPeer | null {
  const q = normalizeCallsignKey(callsignQuery)
  if (!q) return null
  const exact = peers.filter((p) => normalizeCallsignKey(p.callsign) === q)
  if (exact.length === 1) return exact[0]!
  if (exact.length > 1) return null
  const partial = peers.filter(
    (p) =>
      normalizeCallsignKey(p.callsign).startsWith(q) ||
      q.startsWith(normalizeCallsignKey(p.callsign)),
  )
  if (partial.length === 1) return partial[0]!
  return null
}

/** Teammates you can address — mesh link and/or live map presence. */
export function listMessageableTeammates(
  peers: ConnectedPeer[],
  presence: TeamPresence[],
  selfDeviceId: string,
): MessageableTeammate[] {
  const onMap = filterTeammatePresence(presence, selfDeviceId)
  const byDevice = new Map<string, MessageableTeammate>()
  for (const p of peers) {
    const label =
      p.linkRole === 'observer' ? p.callsign?.trim() || 'Watcher' : p.callsign?.trim() || 'Teammate'
    byDevice.set(p.deviceId, {
      deviceId: p.deviceId,
      callsign: label,
      peerId: p.peerId,
      onMap: false,
      meshLinked: true,
      linkRole: p.linkRole,
    })
  }
  for (const t of onMap) {
    const cur = byDevice.get(t.deviceId)
    if (cur) {
      cur.onMap = true
      if (t.callsign?.trim()) cur.callsign = t.callsign.trim()
    } else {
      byDevice.set(t.deviceId, {
        deviceId: t.deviceId,
        callsign: t.callsign?.trim() || 'Teammate',
        onMap: true,
        meshLinked: false,
      })
    }
  }
  return [...byDevice.values()].sort((a, b) => a.callsign.localeCompare(b.callsign))
}

export const TEAM_QUICK_MESSAGES = [
  'Hold up',
  'On my way',
  'Need assist',
  'All clear',
  'Regroup here',
  'Slow down',
  'Off trail',
  'At the summit',
] as const

export function normalizeCallsignKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function resolveFieldPeerByCallsign(
  peers: ConnectedPeer[],
  callsignQuery: string,
): ConnectedPeer | null {
  const match = resolveMissionPeerByCallsign(
    peers.filter((p) => p.linkRole === 'member'),
    callsignQuery,
  )
  return match
}

export function burstTargetsLocalDevice(burst: MissionBurst, localDeviceId: string): boolean {
  if (!burst.toDeviceId) return true
  return burst.toDeviceId === localDeviceId
}

export function formatBurstTargetLabel(burst: MissionBurst): string | null {
  if (!burst.toCallsign && !burst.toDeviceId) return null
  return burst.toCallsign ? `→ ${burst.toCallsign}` : '→ teammate'
}

export function formatBurstLine(burst: MissionBurst, localDeviceId: string): string {
  const mine = burst.deviceId === localDeviceId
  const who = mine ? 'You' : burst.callsign
  const arrow = formatBurstTargetLabel(burst)
  const body = burst.text
  return arrow ? `${who} ${arrow}: ${body}` : `${who}: ${body}`
}

const MESSAGE_PREFIXES = [
  'team message ',
  'message team ',
  'send team message ',
  'message ',
  'tell team ',
  'tell ',
]

/**
 * Voice/text: "message bravo hold at gate" or "team message hold at gate".
 */
export function parseTeamMessageVoice(
  normalized: string,
  raw: string,
): { text: string; callsign?: string } | null {
  const n = normalized.trim()
  if (!n) return null

  for (const prefix of MESSAGE_PREFIXES) {
    if (!n.startsWith(prefix)) continue
    const rest = n.slice(prefix.length).trim()
    if (!rest) return null
    if (prefix === 'message team ' || prefix === 'team message ' || prefix === 'tell team ') {
      return { text: rest }
    }
    const firstSpace = rest.indexOf(' ')
    if (firstSpace <= 0) return null
    const maybeCallsign = rest.slice(0, firstSpace).trim()
    const text = rest.slice(firstSpace + 1).trim()
    if (!text) return null
    if (
      maybeCallsign === 'team' ||
      maybeCallsign === 'all' ||
      maybeCallsign === 'everyone' ||
      maybeCallsign === 'everybody'
    ) {
      return { text }
    }
    return { text, callsign: maybeCallsign }
  }

  const rawLower = raw.toLowerCase()
  const hudStrip = rawLower.replace(/^hud\s+/i, '').trim()
  for (const prefix of MESSAGE_PREFIXES) {
    if (!hudStrip.startsWith(prefix)) continue
    const rest = hudStrip.slice(prefix.length).trim()
    if (!rest) return null
    if (prefix === 'message team ' || prefix === 'team message ') return { text: rest }
    const firstSpace = rest.indexOf(' ')
    if (firstSpace <= 0) return null
    const maybeCallsign = rest.slice(0, firstSpace).trim()
    const text = rest.slice(firstSpace + 1).trim()
    if (!text) return null
    if (['team', 'all', 'everyone', 'everybody'].includes(maybeCallsign)) return { text }
    return { text, callsign: maybeCallsign }
  }

  return null
}
