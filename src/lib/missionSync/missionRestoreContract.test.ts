import { describe, expect, it } from 'vitest'
import {
  evaluateMissionRestore,
  missionRestoreGuidance,
  MISSION_CONTINUITY_REQUIRES_REJOIN,
  MISSION_CONTINUITY_SURVIVES,
} from './missionRestoreContract'

describe('missionRestoreContract', () => {
  it('documents continuity expectations', () => {
    expect(MISSION_CONTINUITY_SURVIVES.refresh.length).toBeGreaterThan(0)
    expect(MISSION_CONTINUITY_REQUIRES_REJOIN.length).toBeGreaterThan(0)
  })

  it('restores host session', () => {
    const outcome = evaluateMissionRestore({
      session: {
        missionId: 'm1',
        missionName: 'Field',
        role: 'member',
        deviceId: 'dev_a',
        hostDeviceId: 'dev_a',
        joinToken: 'tok',
        updatedAt: Date.now(),
      },
      deviceId: 'dev_a',
      observerSignalingAvailable: false,
    })
    expect(outcome).toBe('host_restore')
    expect(missionRestoreGuidance(outcome)).toContain('join code')
  })

  it('detects device mismatch', () => {
    expect(
      evaluateMissionRestore({
        session: {
          missionId: 'm1',
          missionName: 'Field',
          role: 'member',
          deviceId: 'dev_other',
          joinToken: 'tok',
          updatedAt: Date.now(),
        },
        deviceId: 'dev_a',
        observerSignalingAvailable: false,
      }),
    ).toBe('device_mismatch')
  })

  it('routes observer wait mode when signaling available', () => {
    expect(
      evaluateMissionRestore({
        session: {
          missionId: 'm1',
          missionName: 'Field',
          role: 'observer',
          deviceId: 'dev_a',
          observerToken: 'obs',
          observerWaitMode: true,
          updatedAt: Date.now(),
        },
        deviceId: 'dev_a',
        observerSignalingAvailable: true,
      }),
    ).toBe('observer_wait')
  })
})
