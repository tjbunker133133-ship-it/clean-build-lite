/**
 * WAL lifecycle boundary audit tests — stability gate only.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { _resetEscalationAuditForTests } from './escalationAudit'
import { createWalRuntime } from './walRuntime'
import { runConnectWearableFlow, silentReconnectWearable } from './walDeviceConnect'
import { loadWalConnectionState, saveWalConnectionState } from './walConnection'
import type { WearableAdapter, WearableSignal } from './types'

function mockAdapter(id: string): WearableAdapter {
  return {
    capabilities: {
      identity: { adapterId: id, kind: 'generic_fallback', displayName: id, authenticated: true },
      capabilities: ['heart_rate'],
    },
    async authenticate() {
      return true
    },
    async startStreaming() {},
    async stopStreaming() {},
    async pollSignals() {
      return []
    },
  }
}

describe('WAL lifecycle boundaries', () => {
  beforeEach(() => _resetEscalationAuditForTests())

  it('createWalRuntime starts with escalation disarmed', () => {
    const wal = createWalRuntime()
    expect(wal.getStatus().escalationArmed).toBe(false)
  })

  it('attachDevice blocks auto-escalation until stabilize', async () => {
    const wal = createWalRuntime({ adapters: [mockAdapter('notification_mirror')] })
    await wal.attachDevice({
      type: 'watch',
      capabilities: ['notification_out'],
      mode: 'balanced',
      adapterIds: ['notification_mirror'],
    })
    expect(wal.getStatus().escalationArmed).toBe(false)

    wal.ingestSignal({
      type: 'fall',
      value: 1,
      timestamp: Date.now(),
      sourceDevice: 'during_attach',
      confidence: 0.95,
    })
    expect(wal.getEscalationSnapshot().state).toBe('normal')

    await wal.stabilizeConnection()
    expect(wal.getStatus().escalationArmed).toBe(true)

    wal.ingestSignal({
      type: 'fall',
      value: 1,
      timestamp: Date.now(),
      sourceDevice: 'after_stabilize',
      confidence: 0.95,
    })
    expect(wal.getEscalationSnapshot().state).toBe('escalation_pending')
    await wal.stop()
  })

  it('stabilizeConnection is the only arming point after attach', async () => {
    const wal = createWalRuntime({ adapters: [mockAdapter('a1')] })
    await wal.attachDevice({
      type: 'ring',
      capabilities: ['heart_rate'],
      mode: 'balanced',
      adapterIds: ['a1'],
    })
    expect(wal.getStatus().escalationArmed).toBe(false)
    await wal.stabilizeConnection()
    expect(wal.getStatus().escalationArmed).toBe(true)
    await wal.stop()
  })

  it('stop clears armed state and adapters', async () => {
    const wal = createWalRuntime({ adapters: [mockAdapter('a1')] })
    await wal.attachDevice({
      type: 'watch',
      capabilities: ['heart_rate'],
      mode: 'balanced',
      adapterIds: ['a1'],
    })
    await wal.stabilizeConnection()
    await wal.stop()
    expect(wal.getStatus().running).toBe(false)
    expect(wal.getStatus().escalationArmed).toBe(false)
    expect(wal.getAttachedDevice()).toBeNull()
  })

  it('double start does not duplicate adapter streaming', async () => {
    let streams = 0
    const adapter: WearableAdapter = {
      ...mockAdapter('dup'),
      async startStreaming() {
        streams++
      },
    }
    const wal = createWalRuntime({ adapters: [adapter] })
    await wal.start()
    await wal.start()
    expect(streams).toBe(1)
    await wal.stop()
  })

  it('silentReconnectWearable skips discover and arms after stabilize', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    })
    saveWalConnectionState({
      connected: true,
      lastConnectedAt: Date.now(),
      activeAdapterIds: ['notification_mirror'],
      autoReconnect: true,
    })

    const wal = createWalRuntime({ adapters: [mockAdapter('notification_mirror')] })
    const ok = await silentReconnectWearable(wal)
    expect(ok).toBe(true)
    expect(wal.getStatus().escalationArmed).toBe(true)
    expect(wal.getStatus().running).toBe(true)
    vi.unstubAllGlobals()
    await wal.stop()
  })
})

describe('WAL SOS hook gate', () => {
  beforeEach(() => _resetEscalationAuditForTests())

  it('default runtime never enables SOS hook', async () => {
    const wal = createWalRuntime()
    expect(wal.getStatus().sosHookEnabled).toBe(false)
    await wal.stabilizeConnection()
    wal.submitUserEmergency()
    wal.userConfirm('test')
    await new Promise((r) => setTimeout(r, 10))
    expect(wal.getEscalationSnapshot().state).toBe('escalation_confirmed')
  })
})
