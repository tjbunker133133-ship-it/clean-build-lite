export type ActionTracePhase =
  | 'handler_enter'
  | 'guard_reject'
  | 'async_start'
  | 'async_complete'
  | 'state_result'
  | 'runtime_effect'
  | 'deferred_reload'
  | 'reload_requested'
  | 'failure'

const lastSigByAction = new Map<string, string>()

export function traceAction(
  actionId: string,
  phase: ActionTracePhase,
  details: Record<string, unknown> = {},
): void {
  if (!import.meta.env.DEV) return
  try {
    const sig = JSON.stringify({ phase, details })
    const key = actionId.trim().toLowerCase()
    if (lastSigByAction.get(key) === sig) return
    lastSigByAction.set(key, sig)
    console.info('[HUD ACTION]', {
      actionId: key,
      phase,
      ...details,
    })
  } catch {
    // never break runtime from diagnostics
  }
}

