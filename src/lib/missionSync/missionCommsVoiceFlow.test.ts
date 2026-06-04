import { describe, expect, it } from 'vitest'
import {
  createIdleMissionCommsFlow,
  reduceMissionCommsFlow,
  parseMissionCommsStart,
} from './missionCommsVoiceFlow'
import type { ConnectedPeer } from './types'

const peers: ConnectedPeer[] = [
  {
    peerId: 'p1',
    deviceId: 'd1',
    callsign: 'UPEOPLE',
    connectedAt: 1,
    linkRole: 'member',
  },
]

describe('missionCommsVoiceFlow', () => {
  it('parses one-shot message to callsign', () => {
    const p = parseMissionCommsStart('message upeople hold at the gate', peers)
    expect(p?.target.label).toBe('UPEOPLE')
    expect(p && 'body' in p && p.body).toBe('hold at the gate')
  })

  it('walks target then body then confirm', () => {
    let s = createIdleMissionCommsFlow()
    let r = reduceMissionCommsFlow(s, 'team message', peers)
    expect(r.state.phase).toBe('await_target')

    r = reduceMissionCommsFlow(r.state, 'upeople', peers)
    expect(r.state.phase).toBe('await_body')

    r = reduceMissionCommsFlow(r.state, 'slow down', peers)
    expect(r.state.phase).toBe('confirm_send')
    expect(r.effects.some((e) => e.type === 'confirm_send')).toBe(false)

    r = reduceMissionCommsFlow(r.state, 'accept', peers)
    expect(r.effects.some((e) => e.type === 'confirm_send')).toBe(true)
    expect(r.effects.find((e) => e.type === 'confirm_send')).toMatchObject({
      body: 'slow down',
    })
  })
})
