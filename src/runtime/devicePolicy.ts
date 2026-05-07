/**
 * DEVICE EXPERIENCE POLICY ENGINE (DEPE)
 *
 * Declarative table of allowed / forbidden / required behaviors per
 * interaction mode, plus runtime guards that subsystems call before performing
 * a mode-sensitive action. The engine has three responsibilities:
 *
 *   1. SINGLE SOURCE OF TRUTH for what each mode is allowed to do.
 *   2. RUNTIME GUARDS that block a forbidden behavior soft-fashion (returns
 *      false, structured warn log) — never throws in production, never
 *      crashes a field session.
 *   3. TELEMETRY into the runtime snapshot so the overlay + console can
 *      surface attempted violations.
 *
 * Tablet contract: tablets are a SCALED mobile environment. They have NO
 * separate policy row. The engine reads `interactionMode` (binary), so both
 * tablets and phones inherit the `mobile` row identically. Visual scaling
 * differences (panel sizes, density) are handled in the preset layer in
 * `CockpitContext`, not in DEPE.
 *
 * Design constraints:
 * - Policy verdicts are intentionally declarative; subsystems must not embed
 *   their own conditionals beyond querying this table. Drift is the enemy.
 * - Engine code paths are zero-allocation in the hot path (lookup is a
 *   property access on a static record).
 */

import { getDeviceProfile, type InteractionMode } from './deviceProfile'

/**
 * The engine is keyed by interaction mode (binary). Device `type` is for
 * visual scaling only and never appears in the policy table — that is how
 * tablet → mobile parity is enforced at the type level.
 */
export type PolicyMode = InteractionMode // 'desktop' | 'mobile'

/**
 * Behavior keys are namespaced by subsystem. New keys MUST be added to the
 * `POLICY` table in every mode row, otherwise the type guard at the bottom
 * of this file fails the build.
 */
export type PolicyBehavior =
  // Panel / layout subsystem
  | 'panel.userDrag'
  | 'panel.minimizeToDock'
  | 'panel.autoDockOnFirstLaunch'
  | 'panel.autoRearrangeOnViewportChange'
  | 'panel.autoClampOnRotation'
  | 'panel.maximizeFullscreen'
  | 'panel.crossModePersistence'
  // Interaction controller subsystem
  | 'controller.mobileInteractionModel'
  | 'controller.desktopInteractionModel'
  | 'controller.sessionLockedInteractionMode'
  // Voice subsystem
  | 'voice.wakeWordRequired'
  | 'voice.continuousListening'
  | 'voice.backgroundListenerWhenDisarmed'
  | 'voice.silentDeadState'
  | 'voice.autoRestartOnEnd'
  | 'voice.recoveryLoopBounded'
  | 'voice.hiddenDeadState'
  // Storage subsystem
  | 'storage.scope.mobile'
  | 'storage.scope.desktop'
  | 'storage.legacyKeyWrite'
  // Service worker
  | 'sw.unconditionalReloadOnControllerchange'
  | 'sw.deferReloadDuringVoiceGesture'
  | 'runtime.recoveryCoordinatorActive'
  | 'persistence.transactionalWrite'
  | 'runtime.offlineContinuity'
  | 'runtime.backgroundRestore'
  | 'map.forcedRecentering'
  | 'runtime.unboundedWatcherGrowth'

export type PolicyVerdict = 'allowed' | 'forbidden' | 'required'

type PolicyTable = Record<PolicyMode, Record<PolicyBehavior, PolicyVerdict>>

/**
 * Mode contracts.
 *
 *   desktop = configuration + planning workspace (free-form floating panels,
 *            viewport-clamp ok, single legacy storage key)
 *   mobile  = field execution HUD (manual placement is law, dock-on-first-
 *            launch, scoped storage, no auto-rearrange).
 *            **Tablets share this row identically** — they are a scaled
 *            mobile environment, never a hybrid.
 *
 * `'required'` means the mode REQUIRES the behavior to be active. Calling
 * `requirePolicy(b)` in that mode succeeds; in modes where it is forbidden
 * the call surfaces a violation.
 */
const POLICY: PolicyTable = {
  desktop: {
    'panel.userDrag': 'allowed',
    'panel.minimizeToDock': 'allowed',
    'panel.autoDockOnFirstLaunch': 'allowed',
    'panel.autoRearrangeOnViewportChange': 'allowed',
    'panel.autoClampOnRotation': 'allowed',
    'panel.maximizeFullscreen': 'forbidden',
    'panel.crossModePersistence': 'forbidden',
    'controller.mobileInteractionModel': 'forbidden',
    'controller.desktopInteractionModel': 'required',
    'controller.sessionLockedInteractionMode': 'required',
    'voice.wakeWordRequired': 'required',
    'voice.continuousListening': 'allowed',
    'voice.backgroundListenerWhenDisarmed': 'forbidden',
    'voice.silentDeadState': 'forbidden',
    'voice.autoRestartOnEnd': 'allowed',
    'voice.recoveryLoopBounded': 'required',
    'voice.hiddenDeadState': 'forbidden',
    'storage.scope.mobile': 'forbidden',
    'storage.scope.desktop': 'required',
    'storage.legacyKeyWrite': 'allowed',
    'sw.unconditionalReloadOnControllerchange': 'forbidden',
    'sw.deferReloadDuringVoiceGesture': 'allowed',
    'runtime.recoveryCoordinatorActive': 'required',
    'persistence.transactionalWrite': 'required',
    'runtime.offlineContinuity': 'allowed',
    'runtime.backgroundRestore': 'allowed',
    'map.forcedRecentering': 'forbidden',
    'runtime.unboundedWatcherGrowth': 'forbidden',
  },
  mobile: {
    'panel.userDrag': 'allowed',
    'panel.minimizeToDock': 'allowed',
    'panel.autoDockOnFirstLaunch': 'required',
    'panel.autoRearrangeOnViewportChange': 'forbidden',
    'panel.autoClampOnRotation': 'forbidden',
    'panel.maximizeFullscreen': 'allowed',
    'panel.crossModePersistence': 'forbidden',
    'controller.mobileInteractionModel': 'required',
    'controller.desktopInteractionModel': 'forbidden',
    'controller.sessionLockedInteractionMode': 'required',
    'voice.wakeWordRequired': 'required',
    'voice.continuousListening': 'allowed',
    'voice.backgroundListenerWhenDisarmed': 'forbidden',
    'voice.silentDeadState': 'forbidden',
    'voice.autoRestartOnEnd': 'allowed',
    'voice.recoveryLoopBounded': 'required',
    'voice.hiddenDeadState': 'forbidden',
    'storage.scope.mobile': 'required',
    'storage.scope.desktop': 'forbidden',
    'storage.legacyKeyWrite': 'forbidden',
    'sw.unconditionalReloadOnControllerchange': 'forbidden',
    'sw.deferReloadDuringVoiceGesture': 'allowed',
    'runtime.recoveryCoordinatorActive': 'required',
    'persistence.transactionalWrite': 'required',
    'runtime.offlineContinuity': 'required',
    'runtime.backgroundRestore': 'required',
    'map.forcedRecentering': 'forbidden',
    'runtime.unboundedWatcherGrowth': 'forbidden',
  },
}

/**
 * Critical invariants where DEPE is allowed to actively block/correct behavior.
 * Non-critical behaviors remain observability-only.
 */
const CRITICAL_BEHAVIORS = new Set<PolicyBehavior>([
  'voice.backgroundListenerWhenDisarmed',
  'storage.scope.mobile',
  'storage.scope.desktop',
  'controller.mobileInteractionModel',
  'controller.desktopInteractionModel',
  'controller.sessionLockedInteractionMode',
  'sw.unconditionalReloadOnControllerchange',
  'voice.wakeWordRequired',
  'persistence.transactionalWrite',
  'voice.recoveryLoopBounded',
])

// ---------- public API ----------

export interface PolicyViolation {
  behavior: PolicyBehavior
  expected: PolicyVerdict
  /** What the subsystem actually attempted: 'enable' or 'disable' (active or inactive). */
  attempted: 'enable' | 'disable'
  mode: PolicyMode
  context?: string
  ts: number
}

type ViolationListener = (v: PolicyViolation) => void
const violationListeners = new Set<ViolationListener>()

export function subscribePolicyViolation(fn: ViolationListener): () => void {
  violationListeners.add(fn)
  return () => {
    violationListeners.delete(fn)
  }
}

export function getCurrentPolicyMode(): PolicyMode {
  // Always derive from `interactionMode` — never from `type`. This is what
  // enforces the tablet→mobile contract: tablet's interactionMode is forced
  // to 'mobile' upstream in deviceProfile.ts, so the engine never sees a
  // separate 'tablet' policy mode.
  return getDeviceProfile().interactionMode
}

export function getPolicy(mode: PolicyMode = getCurrentPolicyMode()): Record<PolicyBehavior, PolicyVerdict> {
  return POLICY[mode]
}

export function getVerdict(behavior: PolicyBehavior, mode: PolicyMode = getCurrentPolicyMode()): PolicyVerdict {
  return POLICY[mode][behavior]
}

/** True iff the behavior is `'allowed'` or `'required'` in the current mode. */
export function isAllowed(behavior: PolicyBehavior, mode: PolicyMode = getCurrentPolicyMode()): boolean {
  const v = POLICY[mode][behavior]
  return v === 'allowed' || v === 'required'
}

/** True iff the behavior is `'required'` in the current mode. */
export function isRequired(behavior: PolicyBehavior, mode: PolicyMode = getCurrentPolicyMode()): boolean {
  return POLICY[mode][behavior] === 'required'
}

/** True iff the behavior is `'forbidden'` in the current mode. */
export function isForbidden(behavior: PolicyBehavior, mode: PolicyMode = getCurrentPolicyMode()): boolean {
  return POLICY[mode][behavior] === 'forbidden'
}

function notify(v: PolicyViolation): void {
  for (const fn of violationListeners) {
    try {
      fn(v)
    } catch {
      /* listener errors must never disturb runtime */
    }
  }
}

/**
 * Subsystem reports an attempted state for a behavior.
 *
 * `attempted = 'enable'` means the subsystem just turned the behavior ON
 * (or wants to). `'disable'` means it turned it off. The engine cross-checks
 * against the policy and emits a violation if mismatched:
 *   - attempted enable + verdict forbidden  → violation
 *   - attempted disable + verdict required  → violation
 * Everything else is consistent.
 *
 * Returns `true` if the attempt is policy-consistent, `false` if a violation
 * was reported. Subsystems can use the boolean to decide whether to abort.
 */
export function reportPolicyAttempt(
  behavior: PolicyBehavior,
  attempted: 'enable' | 'disable',
  context?: string,
): boolean {
  const mode = getCurrentPolicyMode()
  const expected = POLICY[mode][behavior]
  const ok =
    (attempted === 'enable' && expected !== 'forbidden') ||
    (attempted === 'disable' && expected !== 'required')
  if (!ok) {
    notify({ behavior, expected, attempted, mode, context, ts: Date.now() })
    return false
  }
  return true
}

export function isCriticalBehavior(behavior: PolicyBehavior): boolean {
  return CRITICAL_BEHAVIORS.has(behavior)
}

/**
 * Critical-path helper: emits policy telemetry and, on violation, optionally
 * runs a caller-provided corrective action.
 */
export function enforcePolicyAttempt(
  behavior: PolicyBehavior,
  attempted: 'enable' | 'disable',
  context?: string,
  onViolation?: () => void,
): boolean {
  const ok = reportPolicyAttempt(behavior, attempted, context)
  if (!ok && isCriticalBehavior(behavior)) {
    try {
      onViolation?.()
    } catch {
      /* corrective action must never crash runtime */
    }
  }
  return ok
}

/**
 * Hard guard for code paths that must not execute outside their permitted
 * mode. Returns true when the behavior is allowed/required and the call may
 * proceed. Returns false when forbidden — caller is expected to abort
 * gracefully.
 */
export function assertPolicy(behavior: PolicyBehavior, context?: string): boolean {
  const mode = getCurrentPolicyMode()
  const expected = POLICY[mode][behavior]
  if (expected === 'forbidden') {
    notify({ behavior, expected, attempted: 'enable', mode, context, ts: Date.now() })
    return false
  }
  return true
}

/**
 * Convenience: required-behavior assertion. If the behavior is required in
 * the current mode but the caller is signalling it is NOT active, a violation
 * is reported.
 */
export function assertRequired(behavior: PolicyBehavior, active: boolean, context?: string): boolean {
  const mode = getCurrentPolicyMode()
  const expected = POLICY[mode][behavior]
  if (expected === 'required' && !active) {
    notify({ behavior, expected, attempted: 'disable', mode, context, ts: Date.now() })
    return false
  }
  return true
}
