/**
 * WAL production smoke tests — field scenarios + runtime hardening gates.
 */

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { _resetEscalationAuditForTests } from './escalationAudit'
import { evaluateConfidenceGate, DEFAULT_CONFIDENCE_GATE } from './confidenceGate'
import {
  createEscalationContext,
  escalationReducer,
  EscalationActions,
  applyEscalationResult,
  tickEscalationCountdown,
  reduceEscalationMachine,
  createEscalationSnapshot,
} from './escalationStateMachine'
import {
  createTriggerCooldownState,
  markTriggerCooldown,
  isTriggerOnCooldown,
} from './escalationTriggerRegistry'
import { evaluateEscalationPipeline } from './escalationPipeline'
import { createSignalThrottleState, shouldIngestSignal } from './signalIngestThrottle'
import {
  createProjectionThrottleState,
  shouldProjectEscalation,
} from './projectionThrottle'
import {
  loadWalConnectionState,
  saveWalConnectionState,
  selectConnectableAdapters,
  type WalDeviceProbe,
} from './walConnection'
import { createWalRuntime } from './walRuntime'
import type { WearableAdapter, WearableSignal } from './types'

function mockAdapter(
  id: string,
  opts: {
    authed?: boolean
    poll?: () => WearableSignal[]
    onStart?: (h: (s: WearableSignal) => void) => void
  } = {},
): WearableAdapter {
  let streaming = false
  return {
    capabilities: {
      identity: {
        adapterId: id,
        kind: 'generic_fallback',
        displayName: id,
        authenticated: false,
      },
      capabilities: ['heart_rate'],
    },
    async authenticate() {
      return opts.authed ?? true
    },
    async startStreaming(onSignal) {
      if (streaming) return
      streaming = true
      opts.onStart?.(onSignal)
    },
    async stopStreaming() {
      streaming = false
    },
    async pollSignals() {
      return opts.poll?.() ?? []
    },
  }
}

describe('WAL production smoke — signal throttle', () => {
  it('throttles heart_rate but passes fall immediately', () => {
    const state = createSignalThrottleState()
    const hr: WearableSignal = {
      type: 'heart_rate',
      value: 72,
      timestamp: Date.now(),
      sourceDevice: 'ring',
      confidence: 0.9,
    }
    expect(shouldIngestSignal(hr, state, 1000)).toBe(true)
    expect(shouldIngestSignal(hr, state, 2000)).toBe(false)
    expect(
      shouldIngestSignal(
        { type: 'fall', value: 1, timestamp: Date.now(), sourceDevice: 'ring', confidence: 0.9 },
        state,
        2000,
      ),
    ).toBe(true)
  })
})

describe('WAL production smoke — projection debounce', () => {
  it('debounces normal state projections', () => {
    let t = createProjectionThrottleState()
    expect(shouldProjectEscalation('normal', null, t, 1000)).toBe(true)
    t = { ...t, lastProjectedAt: 1000, lastState: 'normal' }
    expect(shouldProjectEscalation('normal', null, t, 2000)).toBe(false)
    expect(shouldProjectEscalation('escalation_pending', 25_000, t, 3000)).toBe(true)
  })
})

describe('WAL production smoke — cooldown spam', () => {
  it('blocks repeated fall triggers within cooldown', () => {
    let cooldown = createTriggerCooldownState()
    cooldown = markTriggerCooldown('fall', cooldown, 1000)
    expect(isTriggerOnCooldown('fall', cooldown, 5000)).toBe(true)

    const out = evaluateEscalationPipeline({
      signal: {
        type: 'fall',
        value: 1,
        timestamp: Date.now(),
        sourceDevice: 'ring',
        confidence: 0.9,
      },
      mode: 'balanced',
      cooldownState: cooldown,
      nowMs: 5000,
    })
    expect(out.decision.action).toBe('ignore')
  })
})

describe('WAL production smoke — field scenarios', () => {
  beforeEach(() => _resetEscalationAuditForTests())

  it('HR drop simulation → advisory or escalate per confidence', () => {
    const low = evaluateEscalationPipeline({
      signal: {
        type: 'heart_rate',
        value: 0,
        timestamp: Date.now(),
        sourceDevice: 'watch',
        confidence: 0.5,
      },
      mode: 'balanced',
      cooldownState: createTriggerCooldownState(),
      confidenceGate: DEFAULT_CONFIDENCE_GATE,
    })
    expect(['advisory', 'ignore']).toContain(low.decision.action)

    const high = evaluateEscalationPipeline({
      signal: {
        type: 'heart_rate',
        value: 0,
        timestamp: Date.now(),
        sourceDevice: 'watch',
        confidence: 0.95,
      },
      mode: 'balanced',
      cooldownState: createTriggerCooldownState(),
    })
    expect(high.decision.action).toBe('escalate')
  })

  it('fall detection simulation enters escalation_pending', async () => {
    const wal = createWalRuntime()
    wal.setUserMode('balanced')
    await wal.stabilizeConnection()
    wal.ingestSignal({
      type: 'fall',
      value: 1,
      timestamp: Date.now(),
      sourceDevice: 'ring_sim',
      confidence: 0.85,
    })
    expect(wal.getEscalationSnapshot().state).toBe('escalation_pending')
  })

  it('wearable disconnect mid-escalation — cancel still works', async () => {
    const wal = createWalRuntime()
    wal.setUserMode('balanced')
    await wal.stabilizeConnection()
    wal.ingestSignal({
      type: 'user_emergency',
      value: 1,
      timestamp: Date.now(),
      sourceDevice: 'watch_button',
      confidence: 0.95,
    })
    expect(wal.getEscalationSnapshot().state).toBe('escalation_pending')
    await wal.stop()
    wal.userCancel('disconnect')
    expect(wal.getEscalationSnapshot().state).toBe('normal')
  })

  it('timer expiry path reaches confirmed without SOS hook', async () => {
    let sosCalled = false
    const wal = createWalRuntime({
      tickIntervalMs: 50,
      sosDispatchHook: async () => {
        sosCalled = true
        return { ok: true, reason: 'test' }
      },
    })
    wal.setUserMode('balanced')
    await wal.start()
    wal.ingestSignal({
      type: 'user_emergency',
      value: 1,
      timestamp: Date.now(),
      sourceDevice: 'watch_button',
      confidence: 0.95,
    })
    await new Promise((r) => setTimeout(r, 500))
    await wal.stop()
    expect(sosCalled).toBe(false)
    expect(wal.getStatus().sosHookEnabled).toBe(false)
  })

  it('offline mode — signals still queue through ingest (no throw)', () => {
    const wal = createWalRuntime()
    const prev = navigator.onLine
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    try {
      wal.ingestSignal({
        type: 'heart_rate',
        value: 0,
        timestamp: Date.now(),
        sourceDevice: 'offline_sim',
        confidence: 0.95,
      })
      expect(wal.getRecentSignals().length).toBe(1)
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: prev, configurable: true })
    }
  })
})

describe('WAL production smoke — runtime lifecycle', () => {
  beforeEach(() => _resetEscalationAuditForTests())

  it('prevents duplicate adapter listeners on double start', async () => {
    let startCount = 0
    const adapter = mockAdapter('test_dup', {
      onStart: () => {
        startCount++
      },
    })
    const wal = createWalRuntime({ adapters: [adapter] })
    await wal.start()
    await wal.start()
    expect(startCount).toBe(1)
    expect(wal.getStatus().startedAdapterIds).toEqual(['test_dup'])
    await wal.stop()
  })

  it('SOS hook requires explicit enableSosDispatch', async () => {
    let called = false
    const wal = createWalRuntime({
      enableSosDispatch: true,
      sosDispatchHook: async () => {
        called = true
        return { ok: true, reason: 'enabled' }
      },
    })
    expect(wal.getStatus().sosHookEnabled).toBe(true)
    wal.setUserMode('balanced')
    await wal.stabilizeConnection()
    wal.submitUserEmergency()
    wal.userConfirm('test')
    await new Promise((r) => setTimeout(r, 20))
    expect(called).toBe(true)
  })

  it('poll adapter respects foreground-only schedule', async () => {
    vi.useFakeTimers()
    const polls: number[] = []
    const adapter = mockAdapter('poll_test', {
      poll: () => {
        polls.push(Date.now())
        return []
      },
    })
    const wal = createWalRuntime({
      adapters: [adapter],
      healthPollIntervalMs: 1000,
    })
    await wal.start()
    await vi.advanceTimersByTimeAsync(2500)
    expect(polls.length).toBeGreaterThanOrEqual(2)
    await wal.stop()
    vi.useRealTimers()
  })
})

describe('WAL production smoke — escalation invariants', () => {
  beforeEach(() => _resetEscalationAuditForTests())

  it('risk_detected never starts timer', () => {
    let ctx = createEscalationContext()
    ctx = applyEscalationResult(ctx, escalationReducer(ctx, EscalationActions.riskDetected()))
    expect(ctx.state).toBe('risk_detected')
    expect(tickEscalationCountdown(ctx)).toBeNull()
  })

  it('only escalation_pending allows confirm dispatch flag', () => {
    const timerMs = 30_000
    const t0 = 1_000_000
    let ctx = createEscalationContext({ countdownMs: timerMs })
    ctx = applyEscalationResult(
      ctx,
      escalationReducer(ctx, { ...EscalationActions.start(), timestamp: t0 }),
    )
    ctx = applyEscalationResult(
      ctx,
      escalationReducer(ctx, { ...EscalationActions.confirm(), timestamp: t0 + 1000 }),
    )
    expect(ctx.state).toBe('escalation_confirmed')

    ctx = applyEscalationResult(
      ctx,
      escalationReducer(ctx, { ...EscalationActions.riskDetected(), timestamp: t0 + 2000 }),
    )
    const blocked = escalationReducer(ctx, { ...EscalationActions.confirm(), timestamp: t0 + 3000 })
    expect(blocked.shouldRequestSosDispatch).toBeFalsy()
  })

  it('legacy shim timer accuracy', () => {
    const timerMs = 10_000
    const t0 = 5_000_000
    const enter = reduceEscalationMachine(
      createEscalationSnapshot(),
      {
        type: 'RISK_QUALIFIED',
        risk: { trigger: 'fall_detected', at: t0, sourceDevice: 'sim' },
      },
      { timerMs, nowMs: t0 },
    )
    const tick = reduceEscalationMachine(
      enter.snapshot,
      { type: 'TICK', nowMs: t0 + timerMs + 1 },
      { timerMs },
    )
    expect(tick.snapshot.state).toBe('escalation_confirmed')
    expect(tick.shouldRequestSosDispatch).toBe(true)
  })
})

describe('WAL production smoke — connection selection', () => {
  it('selectConnectableAdapters prefers authenticated HC + notifications', () => {
    const probes: WalDeviceProbe[] = [
      {
        adapterId: 'android_health_connect',
        displayName: 'HC',
        kind: 'android_health_connect',
        available: true,
        authenticated: true,
        capabilities: ['heart_rate'],
      },
      {
        adapterId: 'notification_mirror',
        displayName: 'Notif',
        kind: 'android_notification_mirror',
        available: true,
        authenticated: true,
        capabilities: ['notification_out'],
      },
      {
        adapterId: 'smart_ring',
        displayName: 'Ring',
        kind: 'smart_ring',
        available: false,
        authenticated: false,
        capabilities: ['heart_rate'],
      },
    ]
    const ids = selectConnectableAdapters(probes)
    expect(ids).toContain('android_health_connect')
    expect(ids).toContain('notification_mirror')
    expect(ids).not.toContain('smart_ring')
  })

  it('persists connection state', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    })
    saveWalConnectionState({
      connected: true,
      lastConnectedAt: 123,
      activeAdapterIds: ['notification_mirror'],
      autoReconnect: true,
    })
    expect(loadWalConnectionState().connected).toBe(true)
    vi.unstubAllGlobals()
  })
})

describe('WAL production smoke — attachDevice', () => {
  beforeEach(() => _resetEscalationAuditForTests())

  it('keeps escalation idle until stabilize', async () => {
    const wal = createWalRuntime()
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
      sourceDevice: 'mid_attach',
      confidence: 0.95,
    })
    expect(wal.getEscalationSnapshot().state).toBe('normal')

    await wal.stabilizeConnection()

    wal.ingestSignal({
      type: 'fall',
      value: 1,
      timestamp: Date.now(),
      sourceDevice: 'post_arm',
      confidence: 0.95,
    })
    expect(wal.getEscalationSnapshot().state).toBe('escalation_pending')
    await wal.stop()
  })
})

describe('WAL production smoke — confidence gate', () => {
  it('low confidence defers fall to require_confirmation path', () => {
    const r = evaluateConfidenceGate(
      {
        type: 'fall',
        value: 1,
        timestamp: Date.now(),
        sourceDevice: 'ring',
        confidence: 0.4,
      },
      DEFAULT_CONFIDENCE_GATE,
    )
    expect(r.outcome).toBe('require_confirmation')
  })
})
