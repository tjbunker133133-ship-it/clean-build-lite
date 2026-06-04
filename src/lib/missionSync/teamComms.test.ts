import { describe, expect, it } from 'vitest'
import { buildBurst } from './comms'
import {
  burstTargetsLocalDevice,
  listMessageableTeammates,
  normalizeCallsignKey,
  parseTeamMessageVoice,
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
