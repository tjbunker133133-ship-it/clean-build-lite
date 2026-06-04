import { describe, expect, it } from 'vitest'
import { buildBurst } from './comms'
import {
  burstTargetsLocalDevice,
  buildTeammateMessageCommandSpecs,
  listLinkedFieldCallsigns,
  listMessageableTeammates,
  normalizeCallsignKey,
  parseTeamMessageVoice,
  resolveDirectedMessageRest,
  resolveFieldPeerByCallsign,
} from './teamComms'
import type { ConnectedPeer } from './types'

const peers: ConnectedPeer[] = [
  {
    peerId: 'p1',
    deviceId: 'd1',
    callsign: 'Bravo-2',
    connectedAt: 1,
    linkRole: 'member',
  },
  {
    peerId: 'p2',
    deviceId: 'd2',
    callsign: 'Alpha',
    connectedAt: 2,
    linkRole: 'observer',
  },
  {
    peerId: 'p3',
    deviceId: 'd3',
    callsign: 'Good Cit',
    connectedAt: 3,
    linkRole: 'member',
  },
]

describe('teamComms', () => {
  it('resolves field peer by callsign', () => {
    expect(resolveFieldPeerByCallsign(peers, 'bravo')?.peerId).toBe('p1')
    expect(resolveFieldPeerByCallsign(peers, 'alpha')).toBeNull()
  })

  it('parses voice team messages', () => {
    expect(parseTeamMessageVoice('message bravo hold north', 'HUD message bravo hold north')).toEqual({
      callsign: 'bravo',
      text: 'hold north',
    })
    expect(parseTeamMessageVoice('team message all clear', 'team message all clear')).toEqual({
      text: 'all clear',
    })
    expect(
      parseTeamMessageVoice('message good cit hold up', 'message good cit hold up', peers),
    ).toEqual({
      callsign: 'Good Cit',
      text: 'hold up',
    })
  })

  it('resolves multi-word callsign prefix', () => {
    expect(resolveDirectedMessageRest('good cit regroup here', peers)).toEqual({
      callsign: 'Good Cit',
      text: 'regroup here',
    })
  })

  it('builds per-teammate command specs', () => {
    const specs = buildTeammateMessageCommandSpecs(peers, 'self')
    expect(specs.some((s) => s.callsign === 'Good Cit')).toBe(true)
    expect(specs.some((s) => s.callsign === 'Bravo-2')).toBe(true)
    expect(specs.some((s) => s.callsign === 'Alpha')).toBe(false)
  })

  it('lists linked field callsigns excluding self', () => {
    expect(listLinkedFieldCallsigns(peers, 'd1')).toEqual(['Good Cit'])
    expect(listLinkedFieldCallsigns(peers, 'self')).toEqual(['Bravo-2', 'Good Cit'])
  })

  it('directed burst targets local device', () => {
    const b = buildBurst('a', 'Me', 'hi', {
      scope: 'direct',
      peerId: 'p',
      deviceId: 'target',
      callsign: 'X',
    })!
    expect(burstTargetsLocalDevice(b, 'target')).toBe(true)
    expect(burstTargetsLocalDevice(b, 'other')).toBe(false)
    expect(burstTargetsLocalDevice(buildBurst('a', 'Me', 'hi')!, 'other')).toBe(true)
  })

  it('normalizes callsign keys', () => {
    expect(normalizeCallsignKey('Bravo-2')).toBe('bravo2')
  })

  it('merges mesh peers and map presence for messaging list', () => {
    const list = listMessageableTeammates(
      peers,
      [
        {
          deviceId: 'd9',
          callsign: 'Charlie',
          lat: 1,
          lng: 2,
          accuracy: 5,
          updatedAt: Date.now(),
        },
      ],
      'self',
    )
    expect(list.some((t) => t.callsign === 'Bravo-2' && t.meshLinked)).toBe(true)
    expect(list.some((t) => t.callsign === 'Charlie' && t.onMap && !t.meshLinked)).toBe(true)
  })
})
