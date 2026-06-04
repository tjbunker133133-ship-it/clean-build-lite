import { describe, expect, it, beforeEach } from 'vitest'
import { _resetEscalationAuditForTests, getEscalationAuditLog } from './escalationAudit'
import { evaluateConfidenceGate, DEFAULT_CONFIDENCE_GATE } from './confidenceGate'
import {
  createEscalationSnapshot,
  createEscalationContext,
  reduceEscalationMachine,
  escalationReducer,
  EscalationActions,
  applyEscalationResult,
  tickEscalationCountdown,
} from './escalationStateMachine'
import {
  createTriggerCooldownState,
  isTriggerOnCooldown,
  markTriggerCooldown,
  resolveTriggersFromSignal,
} from './escalationTriggerRegistry'
import { evaluateEscalationPipeline } from './escalationPipeline'
import { interpretWearableSignals } from './interpretationLayer'
import { presetAllowsAutoEscalation, WAL_PRESET_DEFAULTS } from './userPresets'
import { createWalRuntime } from './walRuntime'

describe('escalationStateMachine', () => {
  beforeEach(() => _resetEscalationAuditForTests())

  it('requires timer before sos dispatch request', () => {
    const timerMs = 30_000
    const risk = {
      trigger: 'fall_detected' as const,
      at: Date.now(),
      sourceDevice: 'test',
    }
    const enter = reduceEscalationMachine(createEscalationSnapshot(), { type: 'RISK_QUALIFIED', risk }, { timerMs })
    expect(enter.snapshot.state).toBe('escalation_pending')
    expect(enter.shouldRequestSosDispatch).toBe(false)

    const tick = reduceEscalationMachine(
      enter.snapshot,
      { type: 'TICK', nowMs: enter.snapshot.enteredAt + timerMs + 1 },
      { timerMs },
    )
    expect(tick.snapshot.state).toBe('escalation_confirmed')
    expect(tick.shouldRequestSosDispatch).toBe(true)
  })

  it('risk_detected has no active timer', () => {
    const adv = reduceEscalationMachine(
      createEscalationSnapshot(),
      {
        type: 'ADVISORY_RISK',
        risk: { trigger: 'fall_detected', at: Date.now(), sourceDevice: 'ring' },
      },
      { timerMs: 45_000 },
    )
    expect(adv.snapshot.state).toBe('risk_detected')
    expect(adv.snapshot.timerRemainingMs).toBeNull()
    const tick = reduceEscalationMachine(adv.snapshot, { type: 'TICK', nowMs: Date.now() + 60_000 }, { timerMs: 45_000 })
    expect(tick.snapshot.state).toBe('risk_detected')
    expect(tick.shouldRequestSosDispatch).toBe(false)
  })

  it('user confirm only from escalation_pending', () => {
    const adv = reduceEscalationMachine(
      createEscalationSnapshot(),
      {
        type: 'ADVISORY_RISK',
        risk: { trigger: 'fall_detected', at: Date.now(), sourceDevice: 'ring' },
      },
      { timerMs: 45_000 },
    )
    const confirm = reduceEscalationMachine(adv.snapshot, { type: 'USER_CONFIRM' }, { timerMs: 45_000 })
    expect(confirm.shouldRequestSosDispatch).toBe(false)
    expect(confirm.snapshot.state).toBe('risk_detected')
  })

  it('allows user cancel during pending', () => {
    const timerMs = 45_000
    const enter = reduceEscalationMachine(
      createEscalationSnapshot(),
      {
        type: 'RISK_QUALIFIED',
        risk: { trigger: 'user_emergency_button', at: Date.now(), sourceDevice: 'watch' },
      },
      { timerMs },
    )
    const cancel = reduceEscalationMachine(enter.snapshot, { type: 'USER_CANCEL' }, { timerMs })
    expect(cancel.snapshot.state).toBe('normal')
    expect(cancel.shouldRequestSosDispatch).toBe(false)
  })

  it('user confirm from pending requests dispatch', () => {
    const enter = reduceEscalationMachine(
      createEscalationSnapshot(),
      {
        type: 'RISK_QUALIFIED',
        risk: { trigger: 'manual_operator', at: Date.now(), sourceDevice: 'phone_manual_operator' },
      },
      { timerMs: 60_000 },
    )
    const confirm = reduceEscalationMachine(enter.snapshot, { type: 'USER_CONFIRM' }, { timerMs: 60_000 })
    expect(confirm.shouldRequestSosDispatch).toBe(true)
  })

  it('audits escalation lifecycle', () => {
    reduceEscalationMachine(
      createEscalationSnapshot(),
      {
        type: 'RISK_QUALIFIED',
        risk: { trigger: 'fall_detected', at: 1, sourceDevice: 'ring' },
      },
      { timerMs: 10_000 },
    )
    expect(getEscalationAuditLog().some((e) => e.event === 'escalation_entered')).toBe(true)
  })
})

describe('escalationReducer', () => {
  beforeEach(() => _resetEscalationAuditForTests())

  it('SOS_DISPATCHED only from escalation_confirmed', () => {
    let dispatched = false
    let ctx = createEscalationContext({
      dispatchSos: () => {
        dispatched = true
      },
    })
    ctx = applyEscalationResult(ctx, escalationReducer(ctx, EscalationActions.sosDispatched()))
    expect(dispatched).toBe(false)

    ctx.lastRisk = { trigger: 'fall_detected', at: Date.now(), sourceDevice: 'ring' }
    ctx = applyEscalationResult(ctx, escalationReducer(ctx, EscalationActions.start()))
    ctx = applyEscalationResult(ctx, escalationReducer(ctx, EscalationActions.confirm()))
    ctx = applyEscalationResult(ctx, escalationReducer(ctx, EscalationActions.sosDispatched()))
    expect(dispatched).toBe(true)
    expect(ctx.state).toBe('sos_dispatched')
    expect(ctx.sosLocked).toBe(true)
  })

  it('RISK_DETECTED never starts timer', () => {
    let ctx = createEscalationContext()
    ctx = applyEscalationResult(ctx, escalationReducer(ctx, EscalationActions.riskDetected()))
    expect(ctx.state).toBe('risk_detected')
    expect(tickEscalationCountdown(ctx)).toBeNull()
  })

  it('START_ESCALATION is only countdown entry', () => {
    let ctx = createEscalationContext({ countdownMs: 30_000 })
    const ts = Date.now()
    ctx = applyEscalationResult(
      ctx,
      escalationReducer(ctx, { ...EscalationActions.start(), timestamp: ts }),
    )
    expect(ctx.state).toBe('escalation_pending')
    expect(ctx.startedAt).toBe(ts)
  })
})

describe('confidenceGate', () => {
  it('defers low confidence to require_confirmation', () => {
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

  it('ignores when configured', () => {
    const r = evaluateConfidenceGate(
      {
        type: 'fall',
        value: 1,
        timestamp: Date.now(),
        sourceDevice: 'ring',
        confidence: 0.2,
      },
      { minConfidenceToTrigger: 0.7, degradeBehavior: 'ignore' },
    )
    expect(r.outcome).toBe('ignore')
  })
})

describe('escalationTriggerRegistry', () => {
  it('respects cooldown', () => {
    let state = createTriggerCooldownState()
    state = markTriggerCooldown('fall', state, 1000)
    expect(isTriggerOnCooldown('fall', state, 1000 + 60_000)).toBe(true)
    expect(isTriggerOnCooldown('fall', state, 1000 + 130_000)).toBe(false)
  })

  it('ignores stress signals', () => {
    expect(
      resolveTriggersFromSignal({
        type: 'stress',
        value: 90,
        timestamp: Date.now(),
        sourceDevice: 'ring',
        confidence: 0.95,
      }),
    ).toHaveLength(0)
  })
})

describe('escalationPipeline', () => {
  it('advises when preset blocks auto escalation', () => {
    const out = evaluateEscalationPipeline({
      signal: {
        type: 'fall',
        value: 1,
        timestamp: Date.now(),
        sourceDevice: 'ring',
        confidence: 0.9,
      },
      mode: 'minimal_field',
      cooldownState: createTriggerCooldownState(),
    })
    expect(out.decision.action).toBe('advisory')
  })

  it('escalates fall in balanced mode', () => {
    const out = evaluateEscalationPipeline({
      signal: {
        type: 'fall',
        value: 1,
        timestamp: Date.now(),
        sourceDevice: 'ring',
        confidence: 0.85,
      },
      mode: 'balanced',
      cooldownState: createTriggerCooldownState(),
    })
    expect(out.decision.action).toBe('escalate')
  })
})

describe('interpretationLayer', () => {
  it('produces readiness in balanced mode', () => {
    const r = interpretWearableSignals(
      [
        {
          type: 'heart_rate',
          value: 72,
          timestamp: Date.now(),
          sourceDevice: 'hc',
          confidence: 0.9,
        },
      ],
      WAL_PRESET_DEFAULTS.balanced,
    )
    expect(r.readiness.some((x) => x.id === 'hr-ok')).toBe(true)
  })
})

describe('userPresets', () => {
  it('minimal field mode only auto-escalates manual triggers', () => {
    expect(presetAllowsAutoEscalation('fall_detected', 'minimal_field')).toBe(false)
    expect(presetAllowsAutoEscalation('user_emergency_button', 'minimal_field')).toBe(true)
  })
})

describe('walRuntime', () => {
  beforeEach(() => _resetEscalationAuditForTests())

  it('enters escalation_pending for emergency button signal', async () => {
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
  })

  it('calls sos hook only after confirm', async () => {
    let called = false
    const wal = createWalRuntime({
      enableSosDispatch: true,
      sosDispatchHook: async () => {
        called = true
        return { ok: true, reason: 'test' }
      },
    })
    wal.setUserMode('balanced')
    await wal.stabilizeConnection()
    wal.submitUserEmergency()
    wal.userConfirm('test')
    await new Promise((r) => setTimeout(r, 10))
    expect(called).toBe(true)
    expect(wal.getEscalationSnapshot().state).toBe('normal')
  })
})
