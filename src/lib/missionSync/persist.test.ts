import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadMissionSession,
  loadOrCreateDeviceId,
  saveMissionSession,
} from './persist'

describe('mission persist', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        store = {}
      },
    })
  })

  it('creates stable device id', () => {
    const a = loadOrCreateDeviceId()
    const b = loadOrCreateDeviceId()
    expect(a).toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(8)
  })

  it('round-trips mission session', () => {
    saveMissionSession({
      missionId: 'm1',
      missionName: 'Test',
      role: 'member',
      deviceId: 'dev_abc',
      joinToken: 'tok',
      observerToken: 'obs',
      hostDeviceId: 'dev_abc',
      updatedAt: Date.now(),
    })
    const loaded = loadMissionSession()
    expect(loaded?.missionId).toBe('m1')
    expect(loaded?.role).toBe('member')
    expect(loaded?.joinToken).toBe('tok')
  })

  it('clears session on null save', () => {
    saveMissionSession({
      missionId: 'm1',
      missionName: 'Test',
      role: 'member',
      deviceId: 'dev_abc',
      updatedAt: Date.now(),
    })
    saveMissionSession(null)
    expect(loadMissionSession()).toBeNull()
  })

  it('rejects corrupt session json', () => {
    store['hud_mission_sync_session_v1'] = '{bad'
    expect(loadMissionSession()).toBeNull()
  })
})
