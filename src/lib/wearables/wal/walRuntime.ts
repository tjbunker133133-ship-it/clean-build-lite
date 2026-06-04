/**
 * WAL runtime orchestrator — wires adapters → signals → interpretation → escalation → projections.
 * Phone remains system of record. Does NOT modify MissionSyncContext or Tier 1 SOSPanel.
 *
 * Production hardening: single listener guard, throttled ingest, lazy HC poll, debounced projections.
 */

import { recordEscalationAudit } from './escalationAudit'
import {
  applyEscalationResult,
  contextToSnapshot,
  createEscalationContext,
  EscalationActions,
  escalationReducer,
  tickEscalationCountdown,
  type EscalationContext,
} from './escalationStateMachine'
import { interpretWearableSignals } from './interpretationLayer'
import { buildEscalationProjection, createDefaultOutputChannels } from './outputChannels'
import {
  createTriggerCooldownState,
  type TriggerCooldownState,
} from './escalationTriggerRegistry'
import { evaluateEscalationPipeline } from './escalationPipeline'
import { DEFAULT_CONFIDENCE_GATE } from './confidenceGate'
import {
  createProjectionThrottleState,
  markProjected,
  shouldProjectEscalation,
  type ProjectionThrottleState,
} from './projectionThrottle'
import {
  createSignalThrottleState,
  shouldIngestSignal,
  type SignalThrottleState,
} from './signalIngestThrottle'
import type {
  EscalationSnapshot,
  InterpretationSnapshot,
  WearableAdapter,
  WearableCapability,
  WearableSignal,
} from './types'
import {
  getWalPresetConfig,
  loadWalUserMode,
  saveWalUserMode,
  type WalUserMode,
} from './userPresets'
import { createDefaultWalAdapterRegistry } from './walRegistry'
import {
  WAL_BACKGROUND_POLL_MS,
  WAL_ESCALATION_TICK_MS,
  WAL_HEALTH_POLL_MS,
} from './walRuntimeConfig'

export type WalSosDispatchHook = () => Promise<{ ok: boolean; reason?: string }>

export type WalRuntimeOptions = {
  adapters?: WearableAdapter[]
  sosDispatchHook?: WalSosDispatchHook
  tickIntervalMs?: number
  healthPollIntervalMs?: number
  /** Explicit opt-in to wire SOS — default false (no-op hook). */
  enableSosDispatch?: boolean
}

const SIGNAL_BUFFER_MAX = 32

export type InferredWearableType = 'watch' | 'ring' | 'glasses' | 'phone_only'

export type AttachDeviceInput = {
  type: InferredWearableType
  capabilities: WearableCapability[]
  mode: WalUserMode
  adapterIds?: string[]
}

export type AttachDeviceResult = {
  ok: boolean
  adapterIds: string[]
  type: InferredWearableType
}

export type AttachedWearableSummary = {
  type: InferredWearableType
  capabilities: WearableCapability[]
  adapterIds: readonly string[]
  signalsActive: boolean
  escalationArmed: boolean
}

export type WalRuntimeStatus = {
  running: boolean
  startedAdapterIds: readonly string[]
  foreground: boolean
  sosHookEnabled: boolean
  escalationArmed: boolean
  attached: AttachedWearableSummary | null
}

export type WalRuntime = {
  getEscalationSnapshot(): EscalationSnapshot
  getInterpretation(): InterpretationSnapshot
  getRecentSignals(): readonly WearableSignal[]
  getUserMode(): WalUserMode
  getStatus(): WalRuntimeStatus
  getAttachedDevice(): AttachedWearableSummary | null
  setUserMode(mode: WalUserMode): void
  ingestSignal(signal: WearableSignal): void
  submitUserEmergency(sourceDevice?: string): void
  userCancel(reason?: string): void
  userConfirm(reason?: string): void
  attachDevice(input: AttachDeviceInput): Promise<AttachDeviceResult>
  stabilizeConnection(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
}

async function noopSosHook(): Promise<{ ok: boolean; reason: string }> {
  return { ok: false, reason: 'wal_sos_hook_not_wired' }
}

function isForeground(): boolean {
  if (typeof document === 'undefined') return true
  return document.visibilityState !== 'hidden'
}

function scheduleInterval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
  const g = globalThis as typeof globalThis & {
    setInterval?: (f: () => void, ms: number) => ReturnType<typeof setInterval>
  }
  return g.setInterval?.(fn, ms) ?? (0 as unknown as ReturnType<typeof setInterval>)
}

function clearSchedule(id: ReturnType<typeof setInterval> | null): void {
  if (id == null) return
  const g = globalThis as typeof globalThis & {
    clearInterval?: (id: ReturnType<typeof setInterval>) => void
  }
  g.clearInterval?.(id)
}

export function createWalRuntime(options: WalRuntimeOptions = {}): WalRuntime {
  const adapters = options.adapters ?? createDefaultWalAdapterRegistry()
  const sosHook = options.enableSosDispatch ? (options.sosDispatchHook ?? noopSosHook) : noopSosHook
  const tickMs = options.tickIntervalMs ?? WAL_ESCALATION_TICK_MS
  const healthPollMs = options.healthPollIntervalMs ?? WAL_HEALTH_POLL_MS

  let mode = loadWalUserMode()
  let ctx: EscalationContext = createEscalationContext()
  let interpretation: InterpretationSnapshot = { readiness: [], suggestions: [], affirmations: [] }
  let signals: WearableSignal[] = []
  let cooldownState: TriggerCooldownState = createTriggerCooldownState()
  let signalThrottle: SignalThrottleState = createSignalThrottleState()
  let projectionThrottle: ProjectionThrottleState = createProjectionThrottleState()

  let running = false
  let escalationArmed = false
  let attached: AttachedWearableSummary | null = null
  const startedAdapterIds = new Set<string>()
  let tickId: ReturnType<typeof setInterval> | null = null
  let pollId: ReturnType<typeof setInterval> | null = null
  let visibilityHandler: (() => void) | null = null

  const outputChannels = createDefaultOutputChannels()

  const preset = () => getWalPresetConfig(mode)

  const snapshot = () => contextToSnapshot(ctx)

  const projectState = async (force = false) => {
    const snap = snapshot()
    if (
      !force &&
      !shouldProjectEscalation(snap.state, snap.timerRemainingMs, projectionThrottle)
    ) {
      return
    }

    const projection = buildEscalationProjection(snap, preset())
    if (!projection) return

    projectionThrottle = markProjected(snap.state, snap.timerRemainingMs, projectionThrottle)

    /* Phone channel handles watch mirror — avoid duplicate notifications. */
    const phoneChannel = outputChannels.find((c) => c.kind === 'phone')
    if (phoneChannel) {
      await phoneChannel.project(projection)
    }
  }

  const dispatchEvent = async (event: ReturnType<(typeof EscalationActions)[keyof typeof EscalationActions]>) => {
    ctx.countdownMs = preset().defaultEscalationTimerMs
    const result = escalationReducer(ctx, event)
    ctx = applyEscalationResult(ctx, result)

    if (result.shouldRequestSosDispatch) {
      const dispatch = await sosHook()
      recordEscalationAudit({
        event: dispatch.ok ? 'sos_dispatch_completed' : 'sos_dispatch_requested',
        state: ctx.state,
        detail: dispatch.reason,
      })
      if (dispatch.ok) {
        const sosResult = escalationReducer(ctx, EscalationActions.sosDispatched(dispatch.reason))
        ctx = applyEscalationResult(ctx, sosResult)
        const resetResult = escalationReducer(ctx, EscalationActions.reset('post_dispatch_reset'))
        ctx = applyEscalationResult(ctx, resetResult)
      }
    }

    if (result.state === 'user_cancelled') {
      const resetResult = escalationReducer(ctx, EscalationActions.reset('cancelled_to_normal'))
      ctx = applyEscalationResult(ctx, resetResult)
    }

    await projectState(true)
  }

  const ingestSignal = (signal: WearableSignal) => {
    if (!shouldIngestSignal(signal, signalThrottle)) return

    signals = [...signals, signal].slice(-SIGNAL_BUFFER_MAX)
    interpretation = interpretWearableSignals(signals, preset())
    recordEscalationAudit({
      event: 'signal_ingested',
      state: ctx.state,
      signalType: signal.type,
      sourceDevice: signal.sourceDevice,
    })

    if (!escalationArmed) return

    const pipeline = evaluateEscalationPipeline({
      signal,
      mode,
      confidenceGate: DEFAULT_CONFIDENCE_GATE,
      cooldownState,
    })
    cooldownState = pipeline.cooldownState

    if (pipeline.decision.action === 'ignore') return

    ctx.lastRisk = pipeline.decision.risk

    if (pipeline.decision.action === 'advisory') {
      void dispatchEvent(EscalationActions.riskDetected(undefined, 'advisory_risk'))
      return
    }

    void dispatchEvent(EscalationActions.start(`trigger=${pipeline.decision.risk.trigger}`))
  }

  const onAdapterSignal = (signal: WearableSignal) => ingestSignal(signal)

  const startAdapter = async (adapter: WearableAdapter): Promise<boolean> => {
    const id = adapter.capabilities.identity.adapterId
    if (startedAdapterIds.has(id)) return true
    try {
      const authed = await adapter.authenticate()
      if (!authed && id !== 'generic_fallback' && id !== 'notification_mirror') {
        return false
      }
      await adapter.startStreaming(onAdapterSignal)
      startedAdapterIds.add(id)
      return true
    } catch {
      recordEscalationAudit({
        event: 'adapter_disconnect',
        state: ctx.state,
        detail: id,
      })
      return false
    }
  }

  const ensureRuntimeShell = (opts?: { enableEscalationTick?: boolean }) => {
    if (running) return
    running = true
    ctx.countdownMs = preset().defaultEscalationTimerMs
    if (opts?.enableEscalationTick !== false) {
      scheduleEscalationTick()
    }
    if (typeof document !== 'undefined' && !visibilityHandler) {
      visibilityHandler = () => {
        schedulePoll()
        if (isForeground() && running) void pollAdapters()
      }
      document.addEventListener('visibilitychange', visibilityHandler)
    }
  }

  const pollAdapters = async () => {
    if (!running || !isForeground()) return
    for (const adapter of adapters) {
      if (!startedAdapterIds.has(adapter.capabilities.identity.adapterId)) continue
      if (!adapter.pollSignals) continue
      try {
        const polled = await adapter.pollSignals()
        for (const s of polled) onAdapterSignal(s)
      } catch {
        recordEscalationAudit({
          event: 'adapter_disconnect',
          state: ctx.state,
          detail: adapter.capabilities.identity.adapterId,
        })
      }
    }
  }

  const schedulePoll = () => {
    if (pollId != null) clearSchedule(pollId)
    const interval = isForeground() ? healthPollMs : WAL_BACKGROUND_POLL_MS
    if (interval <= 0 || !running) return
    pollId = scheduleInterval(() => void pollAdapters(), interval)
  }

  const scheduleEscalationTick = () => {
    if (tickId != null) clearSchedule(tickId)
    if (!running) return
    tickId = scheduleInterval(() => {
      if (ctx.state !== 'escalation_pending') return
      const expired = tickEscalationCountdown(ctx)
      if (expired) void dispatchEvent(expired)
    }, tickMs)
  }

  const applyStabilizeConnection = async () => {
    scheduleEscalationTick()
    schedulePoll()
    void pollAdapters()
    escalationArmed = true
    if (attached) {
      attached = { ...attached, escalationArmed: true }
    }
  }

  return {
    getEscalationSnapshot: snapshot,
    getInterpretation: () => interpretation,
    getRecentSignals: () => signals,
    getUserMode: () => mode,
    getStatus: () => ({
      running,
      startedAdapterIds: [...startedAdapterIds],
      foreground: isForeground(),
      sosHookEnabled: options.enableSosDispatch === true,
      escalationArmed,
      attached,
    }),
    getAttachedDevice: () => attached,
    setUserMode(m) {
      mode = m
      saveWalUserMode(m)
      ctx.countdownMs = preset().defaultEscalationTimerMs
      interpretation = interpretWearableSignals(signals, preset())
    },
    ingestSignal,
    submitUserEmergency(sourceDevice = 'phone_manual_operator') {
      ingestSignal({
        type: 'user_emergency',
        value: { manual: true },
        timestamp: Date.now(),
        sourceDevice,
        confidence: 1,
      })
    },
    userCancel(reason) {
      void dispatchEvent(EscalationActions.cancel(reason))
    },
    userConfirm(reason) {
      void dispatchEvent(EscalationActions.confirm(reason))
    },
    async attachDevice(input) {
      escalationArmed = false
      mode = input.mode
      saveWalUserMode(input.mode)
      ctx.countdownMs = preset().defaultEscalationTimerMs

      const targetIds =
        input.adapterIds && input.adapterIds.length > 0
          ? input.adapterIds
          : adaptersForType(input.type, adapters)

      ensureRuntimeShell({ enableEscalationTick: false })

      const started: string[] = []
      for (const adapter of adapters) {
        const id = adapter.capabilities.identity.adapterId
        if (!targetIds.includes(id)) continue
        if (await startAdapter(adapter)) started.push(id)
      }

      if (started.length === 0 && input.type !== 'phone_only') {
        const fallback = adapters.find((a) => a.capabilities.identity.adapterId === 'generic_fallback')
        if (fallback && (await startAdapter(fallback))) started.push(fallback.capabilities.identity.adapterId)
      }

      attached = {
        type: input.type,
        capabilities: input.capabilities,
        adapterIds: started,
        signalsActive: started.some((id) => id !== 'generic_fallback'),
        escalationArmed: false,
      }

      return {
        ok: started.length > 0 || input.type === 'phone_only',
        adapterIds: started,
        type: input.type,
      }
    },
    async stabilizeConnection() {
      await applyStabilizeConnection()
    },
    async start() {
      if (running) return

      escalationArmed = false
      ensureRuntimeShell({ enableEscalationTick: false })

      for (const adapter of adapters) {
        await startAdapter(adapter)
      }

      await applyStabilizeConnection()
    },
    async stop() {
      if (!running && startedAdapterIds.size === 0) return

      running = false
      escalationArmed = false
      attached = null
      if (tickId != null) {
        clearSchedule(tickId)
        tickId = null
      }
      if (pollId != null) {
        clearSchedule(pollId)
        pollId = null
      }
      if (visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandler)
        visibilityHandler = null
      }

      for (const adapter of adapters) {
        const id = adapter.capabilities.identity.adapterId
        if (!startedAdapterIds.has(id)) continue
        await adapter.stopStreaming()
        startedAdapterIds.delete(id)
      }
    },
  }
}

/**
 * Tier 1 integration point — wire ONLY after explicit approval.
 * Expected consumer: SOSPanel or shared rescue coordinator (not WAL itself).
 */
export const WAL_SOS_INTEGRATION_DOC =
  'On escalation_confirmed, invoke existing buildRescuePacket + postRescue pipeline — never bypass SOSPanel hold/confirm invariants without product sign-off. Set enableSosDispatch:true only after product sign-off.'

function adaptersForType(type: InferredWearableType, adapters: WearableAdapter[]): string[] {
  const ids = adapters.map((a) => a.capabilities.identity.adapterId)
  switch (type) {
    case 'watch':
      return ids.filter((id) =>
        adapters.some(
          (a) =>
            a.capabilities.identity.adapterId === id &&
            (a.capabilities.identity.kind === 'android_health_connect' ||
              a.capabilities.identity.kind === 'ios_healthkit' ||
              a.capabilities.identity.kind.includes('notification')),
        ),
      )
    case 'ring':
      return ids.filter((id) =>
        adapters.some(
          (a) =>
            a.capabilities.identity.adapterId === id &&
            (a.capabilities.identity.kind === 'smart_ring' ||
              a.capabilities.identity.kind === 'android_health_connect' ||
              a.capabilities.identity.kind === 'ios_healthkit'),
        ),
      )
    case 'glasses':
      return ids.filter((id) =>
        adapters.some(
          (a) =>
            a.capabilities.identity.adapterId === id &&
            a.capabilities.identity.kind === 'smart_glasses',
        ),
      )
    default:
      return ids.filter((id) => id === 'generic_fallback' || id === 'notification_mirror')
  }
}
