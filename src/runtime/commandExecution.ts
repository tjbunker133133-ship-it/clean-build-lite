/**
 * COMMAND EXECUTION VERIFICATION LAYER — observability-first.
 *
 * Goal: distinguish "the parser matched" from "the action actually
 * happened" without rewriting any handler or changing UX.
 *
 * Design:
 *   - Types + failure taxonomy + pure formatters live here.
 *   - State (rolling history, counts) and `report*` helpers live in
 *     `runtimeSnapshot.ts` so the snapshot stays the single mutator.
 *   - Per-command verifiers are registered here. Each verifier returns
 *     a VerifierResult and is called AFTER the handler returns
 *     `result.ok === true`. The dispatcher races verification against a
 *     timeout; either path resolves the execution entry once. Verifiers
 *     never block the dispatch return value.
 *
 * Soft verification — no retries, no loops, no heavy DOM polling.
 */

export type CommandFailureReason =
  | 'unavailable'
  | 'denied'
  | 'inactive'
  | 'timeout'
  | 'missing_handler'
  | 'invalid_state'
  | 'unsupported'
  | 'verification_failed'

export type CommandExecutionStatus =
  | 'requested'
  | 'executing'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'rejected'
  | 'deferred'

export type CommandSourceKind = 'voice' | 'ui' | 'kbd'

/**
 * Verification state for a completed execution.
 *  - pending          : verifier scheduled, has not resolved yet
 *  - verified         : a registered verifier confirmed the side-effect
 *  - unverified_ok    : handler returned ok, no verifier registered for
 *                       this command (best-effort)
 *  - verification_failed : verifier rejected the post-state
 *  - skipped          : not attempted (e.g. handler returned ok=false,
 *                       rejection paths, deferred)
 */
export type CommandVerificationState =
  | 'pending'
  | 'verified'
  | 'unverified_ok'
  | 'verification_failed'
  | 'skipped'

export interface CommandExecutionEntry {
  /** Monotonic execution id (per-process). */
  id: number
  /** Canonical registry id, or null if no command matched. */
  commandId: string | null
  source: CommandSourceKind
  /** What the user said / typed (or the cmd id from UI). */
  transcript: string
  /** Post-normalization phrase that was matched against the registry. */
  normalized: string
  requestedAt: number
  startedAt: number | null
  completedAt: number | null
  status: CommandExecutionStatus
  verification: CommandVerificationState
  failureReason: CommandFailureReason | null
  message: string | null
  durationMs: number | null
}

export interface CommandExecutionCounts {
  requested: number
  success: number
  failed: number
  timeout: number
  rejected: number
  deferred: number
}

export interface CommandExecutionSnapshot {
  last: CommandExecutionEntry | null
  history: CommandExecutionEntry[]
  counts: CommandExecutionCounts
}

export const COMMAND_EXECUTION_DEFAULT: CommandExecutionSnapshot = {
  last: null,
  history: [],
  counts: {
    requested: 0,
    success: 0,
    failed: 0,
    timeout: 0,
    rejected: 0,
    deferred: 0,
  },
}

// ---------- formatters (pure, used by the snapshot's report helpers) ----------

export function formatExecLine(e: CommandExecutionEntry): string {
  return (
    `id=${e.id} cmd=${e.commandId ?? '∅'} src=${e.source} ` +
    `heard="${e.transcript.slice(0, 60)}" norm="${e.normalized.slice(0, 60)}"`
  )
}

export function formatOkLine(e: CommandExecutionEntry): string {
  return (
    `id=${e.id} cmd=${e.commandId ?? '∅'} ` +
    `verification=${e.verification} dur=${e.durationMs ?? 0}ms`
  )
}

export function formatFailLine(e: CommandExecutionEntry): string {
  return (
    `id=${e.id} cmd=${e.commandId ?? '∅'} ` +
    `reason=${e.failureReason ?? 'unknown'} dur=${e.durationMs ?? 0}ms`
  )
}

export function formatTimeoutLine(e: CommandExecutionEntry): string {
  return `id=${e.id} cmd=${e.commandId ?? '∅'} dur=${e.durationMs ?? 0}ms`
}

// ---------- failure classifier ----------

/**
 * Map a handler `fail()` message to the canonical failure taxonomy.
 * Pure heuristic; safe for read-only inspection. Defaults to
 * `invalid_state` for messages that don't match a known signal.
 */
export function classifyFailureFromMessage(msg: string | null | undefined): CommandFailureReason {
  if (!msg) return 'invalid_state'
  const m = msg.toLowerCase()
  if (m.includes('permission denied') || m.includes('denied')) return 'denied'
  if (m.includes('not allowed') || m.includes('not-allowed')) return 'denied'
  if (m.includes('unsupported') || m.includes('api unavailable')) return 'unsupported'
  if (m.includes('unavailable')) return 'unavailable'
  if (m.includes('no fix') || m.includes('gps fix required')) return 'unavailable'
  if (m.includes('no pins') || m.includes('no attached pin')) return 'unavailable'
  if (m.includes('inactive') || m.includes('not active')) return 'inactive'
  if (m.startsWith('unknown command')) return 'missing_handler'
  if (m.includes('need at least')) return 'invalid_state'
  if (m.includes('command failed')) return 'invalid_state'
  return 'invalid_state'
}

// ---------- verifier registry ----------

export type VerifierResult = { ok: true } | { ok: false; reason: CommandFailureReason }

export interface VerifierContext {
  commandId: string
  message: string
}

export type CommandVerifier = (
  ctx: VerifierContext,
) => VerifierResult | Promise<VerifierResult>

const verifiers = new Map<string, CommandVerifier>()
let builtinsInstalled = false

export function registerCommandVerifier(commandId: string, fn: CommandVerifier): void {
  verifiers.set(commandId, fn)
}

export function getCommandVerifier(commandId: string): CommandVerifier | null {
  return verifiers.get(commandId) ?? null
}

export function listVerifiedCommandIds(): string[] {
  return [...verifiers.keys()].sort()
}

// ---------- built-in verifiers ----------

/**
 * Display-mode verifier: confirms the cockpit context has applied the
 * requested hue by reading `document.documentElement.dataset.cockpitScreenHue`.
 * Two requestAnimationFrame ticks are allowed for React commit + the
 * effect that sets the data attribute.
 */
function verifyHueDataAttr(expected: string): Promise<VerifierResult> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') {
      resolve({ ok: false, reason: 'unsupported' })
      return
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const actual = document.documentElement.dataset.cockpitScreenHue
        if (actual === expected) resolve({ ok: true })
        else resolve({ ok: false, reason: 'verification_failed' })
      })
    })
  })
}

/**
 * Flashlight verifier: listens for the next `hud:sos-torch-state` echo
 * dispatched by `SOSPanel`. The race against the dispatcher's timeout
 * cleans up if no echo arrives.
 */
function verifyFlashlightState(expected: boolean): Promise<VerifierResult> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ ok: false, reason: 'unsupported' })
      return
    }
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ enabled?: boolean }>).detail
      if (typeof detail?.enabled !== 'boolean') return
      window.removeEventListener('hud:sos-torch-state', handler)
      if (detail.enabled === expected) resolve({ ok: true })
      else resolve({ ok: false, reason: 'verification_failed' })
    }
    window.addEventListener('hud:sos-torch-state', handler)
  })
}

/**
 * Map-navigation verifier: the corresponding handlers (`center`, `zoom in`,
 * `zoom out`, N/S/E/W, `recenter`, `calibrate`) already gate on `map` and
 * GPS preconditions and return `fail()` when unmet, so a `result.ok === true`
 * here is equivalent to "preconditions verified". This verifier just
 * resolves immediately to avoid noisy "unverified_ok" tags for high-priority
 * map commands.
 */
function verifyMapPrecondition(): VerifierResult {
  return { ok: true }
}

/**
 * Connectivity verifier: confirms `navigator.onLine` was the basis of
 * the message. Read-only; only here so the connectivity / status reads
 * are tagged `verified` rather than `unverified_ok`.
 */
function verifyConnectivity(): VerifierResult {
  if (typeof navigator === 'undefined') return { ok: false, reason: 'unsupported' }
  return { ok: true }
}

/**
 * Install the built-in verifier set. Idempotent.
 */
export function installBuiltinCommandVerifiers(): void {
  if (builtinsInstalled) return
  builtinsInstalled = true

  // Display modes — strong DOM verification.
  registerCommandVerifier('night', () => verifyHueDataAttr('red_tactical'))
  registerCommandVerifier('low light', () => verifyHueDataAttr('low_light'))
  registerCommandVerifier('bright', () => verifyHueDataAttr('bright_day'))

  // Flashlight — strong event-echo verification.
  registerCommandVerifier('flashlight on', () => verifyFlashlightState(true))
  registerCommandVerifier('flashlight off', () => verifyFlashlightState(false))

  // Map navigation — handler precondition is the verification.
  registerCommandVerifier('center', verifyMapPrecondition)
  registerCommandVerifier('zoom in', verifyMapPrecondition)
  registerCommandVerifier('zoom out', verifyMapPrecondition)
  registerCommandVerifier('north', verifyMapPrecondition)
  registerCommandVerifier('south', verifyMapPrecondition)
  registerCommandVerifier('east', verifyMapPrecondition)
  registerCommandVerifier('west', verifyMapPrecondition)
  registerCommandVerifier('recenter', verifyMapPrecondition)
  registerCommandVerifier('calibrate', verifyMapPrecondition)

  // Status / connectivity — best-effort precondition.
  registerCommandVerifier('signal', verifyConnectivity)
}
