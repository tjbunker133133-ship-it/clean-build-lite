import {
  resolveDirectedMessageRest,
  resolveMissionPeerByCallsign,
  formatMissionRosterForSpeech,
} from './teamComms'
import type { ConnectedPeer } from './types'
import { sanitizeBurstText } from './comms'

export type MissionCommsTarget = {
  callsign?: string
  label: string
}

export type MissionCommsFlowPhase =
  | 'idle'
  | 'await_target'
  | 'await_body'
  | 'confirm_send'

export type MissionCommsFlowState = {
  phase: MissionCommsFlowPhase
  target: MissionCommsTarget | null
  body: string
}

export type MissionCommsFlowEffect =
  | { type: 'speak'; text: string }
  | { type: 'confirm_send'; target: MissionCommsTarget; body: string }
  | { type: 'cancel' }

const WHOLE_LABEL = 'whole mission'

const TARGET_WORDS = new Set(['team', 'all', 'everyone', 'everybody', 'mission', 'everyone'])

const START_PREFIXES = [
  'send message ',
  'send team message ',
  'team message ',
  'message team ',
  'radio ',
  'message ',
]

const CONFIRM_SEND = new Set(['accept', 'send', 'yes', 'confirm', 'roger', 'okay', 'ok'])
const CANCEL = new Set(['cancel', 'no', 'abort', 'stop', 'nevermind', 'never mind'])

export function createIdleMissionCommsFlow(): MissionCommsFlowState {
  return { phase: 'idle', target: null, body: '' }
}

function wholeTarget(): MissionCommsTarget {
  return { label: WHOLE_LABEL }
}

function targetFromCallsign(
  peers: ConnectedPeer[],
  raw: string,
): { target: MissionCommsTarget; peer?: ConnectedPeer } | null {
  const q = raw.trim()
  if (!q) return null
  if (TARGET_WORDS.has(q.toLowerCase())) return { target: wholeTarget() }
  const peer = resolveMissionPeerByCallsign(peers, q)
  if (!peer) return null
  return {
    target: { callsign: peer.callsign, label: peer.callsign },
    peer,
  }
}

/** Parse "message bravo meet at ridge" or "send message to team hold up". */
export function parseMissionCommsStart(
  phrase: string,
  peers: ConnectedPeer[],
): { target: MissionCommsTarget; body: string } | { target: MissionCommsTarget; body?: undefined } | null {
  const n = phrase.trim().toLowerCase()
  if (!n) return null

  for (const prefix of START_PREFIXES) {
    if (!n.startsWith(prefix)) continue
    const rest = n.slice(prefix.length).trim()
    if (!rest) return null

    if (prefix === 'message team ' || prefix === 'team message ') {
      const body = sanitizeBurstText(rest)
      return body ? { target: wholeTarget(), body } : { target: wholeTarget() }
    }

    if (prefix === 'send message to ' || prefix === 'send team message to ') {
      const directed = resolveDirectedMessageRest(rest, peers)
      if (directed) {
        if (directed.callsign) {
          const t = targetFromCallsign(peers, directed.callsign)
          if (!t) return null
          const body = sanitizeBurstText(directed.text)
          return body ? { target: t.target, body } : { target: t.target }
        }
        const body = sanitizeBurstText(directed.text)
        return body ? { target: wholeTarget(), body } : { target: wholeTarget() }
      }
      const first = rest.indexOf(' ')
      if (first <= 0) {
        const t = targetFromCallsign(peers, rest)
        return t ? { target: t.target } : null
      }
      const who = rest.slice(0, first)
      const body = sanitizeBurstText(rest.slice(first + 1))
      const t = targetFromCallsign(peers, who)
      if (!t && !TARGET_WORDS.has(who)) return null
      const target = TARGET_WORDS.has(who) ? wholeTarget() : t!.target
      return body ? { target, body } : { target }
    }

    const directed = resolveDirectedMessageRest(rest, peers)
    if (directed) {
      if (directed.callsign) {
        const t = targetFromCallsign(peers, directed.callsign)
        if (!t) return null
        const body = sanitizeBurstText(directed.text)
        return body ? { target: t.target, body } : { target: t.target }
      }
      const body = sanitizeBurstText(directed.text)
      return body ? { target: wholeTarget(), body } : { target: wholeTarget() }
    }

    const first = rest.indexOf(' ')
    if (first <= 0) {
      const t = targetFromCallsign(peers, rest)
      return t ? { target: t.target } : null
    }
    const who = rest.slice(0, first)
    const body = sanitizeBurstText(rest.slice(first + 1))
    const t = targetFromCallsign(peers, who)
    if (!t && !TARGET_WORDS.has(who)) return null
    const target = TARGET_WORDS.has(who) ? wholeTarget() : t!.target
    return body ? { target, body } : { target }
  }
  return null
}

export function reduceMissionCommsFlow(
  state: MissionCommsFlowState,
  phrase: string,
  peers: ConnectedPeer[],
  selfDeviceId = '',
): { state: MissionCommsFlowState; effects: MissionCommsFlowEffect[] } {
  const p = phrase.trim().toLowerCase()
  const effects: MissionCommsFlowEffect[] = []

  if (CANCEL.has(p)) {
    effects.push({ type: 'speak', text: 'Message cancelled.' }, { type: 'cancel' })
    return { state: createIdleMissionCommsFlow(), effects }
  }

  if (state.phase === 'confirm_send' && state.target && state.body) {
    if (CONFIRM_SEND.has(p)) {
      effects.push({
        type: 'confirm_send',
        target: state.target,
        body: state.body,
      })
      return { state: createIdleMissionCommsFlow(), effects }
    }
    effects.push({
      type: 'speak',
      text: `Say accept to send to ${state.target.label}, or cancel.`,
    })
    return { state, effects }
  }

  if (state.phase === 'await_target') {
    const t = targetFromCallsign(peers, p)
    if (!t) {
      const roster = formatMissionRosterForSpeech(peers, selfDeviceId)
      effects.push({
        type: 'speak',
        text: `No match. ${roster} Say whole team, or a callsign from that list.`,
      })
      return { state, effects }
    }
    effects.push({ type: 'speak', text: `To ${t.target.label}. What is the message?` })
    return {
      state: { phase: 'await_body', target: t.target, body: '' },
      effects,
    }
  }

  if (state.phase === 'await_body' && state.target) {
    const body = sanitizeBurstText(phrase)
    if (!body) {
      effects.push({ type: 'speak', text: 'Say your message.' })
      return { state, effects }
    }
    effects.push({
      type: 'speak',
      text: `Send to ${state.target.label}: ${body}. Say accept or cancel.`,
    })
    return {
      state: { phase: 'confirm_send', target: state.target, body },
      effects,
    }
  }

  if (state.phase === 'idle') {
    const parsed = parseMissionCommsStart(p, peers)
    if (parsed) {
      const resolved = parsed.target.callsign
        ? targetFromCallsign(peers, parsed.target.callsign)
        : { target: wholeTarget() }
      if (parsed.target.callsign && !resolved) {
        effects.push({
          type: 'speak',
          text: `No linked member matches ${parsed.target.callsign}. ${formatMissionRosterForSpeech(peers, selfDeviceId)}`,
        })
        return { state, effects }
      }
      const target = resolved?.target ?? wholeTarget()
      if (parsed.body) {
        effects.push({
          type: 'speak',
          text: `Send to ${target.label}: ${parsed.body}. Say accept or cancel.`,
        })
        return {
          state: { phase: 'confirm_send', target, body: parsed.body },
          effects,
        }
      }
      effects.push({ type: 'speak', text: `To ${target.label}. What is the message?` })
      return {
        state: { phase: 'await_body', target, body: '' },
        effects,
      }
    }

    if (p === 'send message' || p === 'team message' || p === 'message team') {
      effects.push({ type: 'speak', text: 'Who should receive it? Say callsign or whole team.' })
      return { state: { phase: 'await_target', target: null, body: '' }, effects }
    }
  }

  return { state, effects: [] }
}

export function matchInboundHearConfirm(phrase: string): 'accept' | 'skip' | null {
  const p = phrase.trim().toLowerCase()
  if (CONFIRM_SEND.has(p) || p === 'hear' || p === 'play' || p === 'listen') return 'accept'
  if (p === 'skip' || p === 'ignore' || p === 'later') return 'skip'
  return null
}
