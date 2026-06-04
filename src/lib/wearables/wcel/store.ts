import type { OutputChannelKind } from '../wal/types'
import type { WcelDiagnostics, WcelEnforcementRecord, WcelValidationResult, WearableDeviceType } from './types'

const MAX_RECENT = 20

let diagnostics: WcelDiagnostics = {
  updatedAt: 0,
  totalAllowed: 0,
  totalBlocked: 0,
  lastBlocked: null,
  recent: [],
}

type Listener = (d: WcelDiagnostics) => void
const listeners = new Set<Listener>()

function notify(): void {
  for (const fn of listeners) {
    try {
      fn(diagnostics)
    } catch {
      /* ignore */
    }
  }
}

export function getWcelDiagnostics(): WcelDiagnostics {
  return diagnostics
}

export function subscribeWcelDiagnostics(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function recordWcelEnforcement(input: {
  device: WearableDeviceType
  channel: OutputChannelKind | null
  result: WcelValidationResult
}): void {
  const blocked = input.result.verdict === 'block'
  const record: WcelEnforcementRecord = {
    ts: Date.now(),
    device: input.device,
    channel: input.channel,
    verdict: input.result.verdict,
    violations: input.result.violations,
    blocked,
  }

  diagnostics = {
    updatedAt: record.ts,
    totalAllowed: diagnostics.totalAllowed + (blocked ? 0 : 1),
    totalBlocked: diagnostics.totalBlocked + (blocked ? 1 : 0),
    lastBlocked: blocked ? record : diagnostics.lastBlocked,
    recent: [...diagnostics.recent, record].slice(-MAX_RECENT),
  }
  notify()
}

let installed = false

export function installWcelDiagnostics(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const w = window as Window & {
    __hudWcel?: WcelDiagnostics
    __hudWcelGet?: () => WcelDiagnostics
  }
  w.__hudWcel = diagnostics
  w.__hudWcelGet = () => diagnostics
  subscribeWcelDiagnostics((d) => {
    w.__hudWcel = d
  })
}

export function _resetWcelDiagnosticsForTests(): void {
  diagnostics = {
    updatedAt: 0,
    totalAllowed: 0,
    totalBlocked: 0,
    lastBlocked: null,
    recent: [],
  }
  notify()
}
