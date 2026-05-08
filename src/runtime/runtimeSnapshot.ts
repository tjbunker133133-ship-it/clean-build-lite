/**
 * RUNTIME TRUTH BEACON.
 *
 * Single global object that always answers:
 *   - what build is running?
 *   - what device am I on?
 *   - is the SW active and what is its version?
 *   - is the voice subsystem actually armed or silently dead?
 *   - what permissions has the user granted?
 *   - what interaction controller is currently mounted?
 *
 * Read it via `getRuntimeSnapshot()` or, in the browser, `window.__hudRuntime`.
 * Subscribe via `subscribeRuntimeSnapshot(fn)` for reactive consumers like the
 * `RuntimeDebugOverlay`.
 *
 * This module owns NO behavior. It only stores a structured truth record that
 * is updated by other modules at well-defined lifecycle events.
 */

import {
  getDeviceProfile,
  getSessionLockedInteractionMode,
  subscribeDeviceProfile,
  type DeviceProfile,
} from './deviceProfile'
import { VOICE_STATE_DEFAULT, type VoiceStateSnapshot, type VoiceRuntimeState } from './voiceState'
import { logInfo, logWarn } from './logger'
import {
  EMPTY_VOICE_REGISTRY_REPORT,
  formatVoiceParserLine,
  type VoiceParserEvent,
  type VoiceRegistryReport,
} from './voiceRegistry'
import { isDeadManAudioEnabled } from './deadManAudio'
import {
  emitHaptic,
  getHapticsSnapshot,
  setHapticsStateListener,
  type HapticsSnapshot,
} from './haptics'
import {
  getInstallMode,
  installPwaWatcher,
  setInstallModeListener,
  type InstallMode,
} from './pwa'
import {
  COMMAND_EXECUTION_DEFAULT,
  formatExecLine,
  formatFailLine,
  formatOkLine,
  formatTimeoutLine,
  type CommandExecutionEntry,
  type CommandExecutionSnapshot,
  type CommandExecutionStatus,
  type CommandFailureReason,
  type CommandSourceKind,
  type CommandVerificationState,
} from './commandExecution'
import {
  getCurrentPolicyMode,
  reportPolicyAttempt,
  subscribePolicyViolation,
  type PolicyMode,
  type PolicyViolation,
} from './devicePolicy'

export type ServiceWorkerStatus =
  | 'unsupported'
  | 'unregistered'
  | 'installing'
  | 'installed'
  | 'activating'
  | 'activated'
  | 'controlling'
  | 'redundant'
  | 'error'

export interface ServiceWorkerSnapshot {
  status: ServiceWorkerStatus
  controllerScriptUrl: string | null
  scope: string | null
  /** Best-effort SW version: build id of the running document; equal between SW and page when in sync. */
  buildVersion: string
  needsRefresh: boolean
  lastTransitionAt: number
}

export type RuntimeSeverity = 'INFO' | 'WARN' | 'DEGRADED' | 'CRITICAL'

export interface RollingEvent {
  ts: number
  category: 'runtime' | 'voice' | 'sw' | 'network'
  severity: RuntimeSeverity
  msg: string
  data?: unknown
}

export interface NetworkSnapshot {
  online: boolean
  lastOnlineAt: number | null
  lastOfflineAt: number | null
  transitions: Array<{ ts: number; online: boolean }>
}

export type PermissionStateLike = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported'

export interface PermissionSnapshot {
  geolocation: PermissionStateLike
  microphone: PermissionStateLike
  notifications: PermissionStateLike
  orientation: PermissionStateLike
  motion: PermissionStateLike
}

export const PERMISSION_DEFAULT: PermissionSnapshot = {
  geolocation: 'unknown',
  microphone: 'unknown',
  notifications: 'unknown',
  orientation: 'unknown',
  motion: 'unknown',
}

export interface CommandTraceEntry {
  cmd: string
  source: 'voice' | 'ui' | 'kbd'
  ok: boolean
  message: string
  ts: number
}

export interface PolicySnapshot {
  /** The mode the engine is currently enforcing. */
  mode: PolicyMode
  /** Cumulative count of attempted violations since boot. */
  violationCount: number
  /** Last 10 violations (FIFO, capped). */
  recentViolations: PolicyViolation[]
}

export type AppLifecycleState = 'foreground' | 'background' | 'hidden' | 'suspended' | 'resuming'
export type VoiceRecoveryState = 'idle' | 'suspended' | 'recovering' | 'resumed' | 'failed'
export type GpsRecoveryState = 'healthy' | 'stale' | 'recovering' | 'denied' | 'suspended'
export type PersistenceHealth = 'healthy' | 'recovering' | 'corrupt_recovered' | 'error'
export type RecoveryCoordinatorState = 'idle' | 'background' | 'resuming' | 'recovering' | 'stable'

export interface RuntimeContinuitySnapshot {
  interactionModeLocked: DeviceProfile['interactionMode']
  appLifecycleState: AppLifecycleState
  voiceRecoveryState: VoiceRecoveryState
  gpsRecoveryState: GpsRecoveryState
  persistenceHealth: PersistenceHealth
  lastKnownGoodSnapshotTime: number
  pendingSWUpdate: boolean
  gestureActive: boolean
  recoveryCoordinatorState: RecoveryCoordinatorState
}

export interface DeploymentIntegritySnapshot {
  currentBuildId: string
  latestBuildId: string | null
  swState: ServiceWorkerStatus
  cacheGeneration: string
  cacheCount: number
  cacheEntryCount: number
  lastNetworkValidationAt: number | null
  lastNetworkValidationOk: boolean
  staleStatus: 'unknown' | 'fresh' | 'stale_detected' | 'recovering'
  updatePending: boolean
  recoveryInFlight: boolean
  reloadAttempted: boolean
}

/** Basemap / vector cache heuristic for offline field use (not map engine state). */
export type OfflineMapTileReadiness = 'unknown' | 'sufficient' | 'low' | 'empty'

export interface OfflineReadinessSnapshot {
  assessedAt: number | null
  assessed: boolean
  /** Unique cached URLs that look like MapTiler / OSM map traffic. */
  mapRelatedCacheEntryCount: number
  /** Heuristic: any precache entry looks like the HTML app shell. */
  appShellLikelyCached: boolean
  mapTileReadiness: OfflineMapTileReadiness
  /** Operator-facing banner copy; null when nothing to surface. */
  bannerMessage: string | null
  /** True while navigator reports offline (informational). */
  navigatorOffline: boolean
}

export interface RuntimeSnapshot {
  buildId: string
  /** Alias for external consumers that expect buildHash naming. */
  buildHash: string
  startedAt: number
  device: DeviceProfile
  /** Flattened aliases for quick integrations / health checks. */
  deviceType: DeviceProfile['type']
  interactionMode: DeviceProfile['interactionMode']
  viewport: { width: number; height: number; orientation: DeviceProfile['orientation'] }
  serviceWorker: ServiceWorkerSnapshot
  /** Alias for consumers expecting swVersion naming. */
  swVersion: string
  voice: VoiceStateSnapshot
  /** Alias for consumers expecting a flat voiceState field. */
  voiceState: VoiceRuntimeState
  permissions: PermissionSnapshot
  /** Which interaction controller class the panel system has mounted. */
  activeController: 'desktop' | 'mobile' | 'unknown'
  /** Last 10 dispatched commands (FIFO, capped). */
  commandTrace: CommandTraceEntry[]
  /** Device Experience Policy Engine state. */
  policy: PolicySnapshot
  /** Alias count for quick alerting integrations. */
  policyViolations: number
  runtimeContinuity: RuntimeContinuitySnapshot
  network: NetworkSnapshot
  voiceEvents: RollingEvent[]
  runtimeEvents: RollingEvent[]
  swEvents: RollingEvent[]
  /** Live voice command registry validation report. Populated by the voice
   *  layer on registry/directory changes. Source of truth for ghost UI items,
   *  alias conflicts, and dispatch-reachability. */
  voiceRegistry: VoiceRegistryReport
  /** Last 20 structured voice parser events (FIFO, capped). */
  voiceParserEvents: VoiceParserEvent[]
  /** Dead-man subsystem state mirror. Audio playback is centrally gated by
   *  `runtime/deadManAudio.ts` — `audioEnabled` here reflects that gate.
   *  Timer logic, persistence, escalation, and rescue dispatch are NOT
   *  affected by `audioEnabled`. */
  deadMan: DeadManSnapshot
  /** Command execution truth: distinguishes "parser matched" from
   *  "action actually completed". See `runtime/commandExecution.ts`. */
  commandExecution: CommandExecutionSnapshot
  /** Last time the HUD wake-word gate passed (`parseAndRun` after "HUD").
   *  Drives a single shell-level acknowledgement pulse — see CockpitHudShell. */
  wakeWordDetectedAt: number | null
  /** Centralized haptic broker mirror. Owned by `runtime/haptics.ts`. */
  haptics: HapticsSnapshot
  /** PWA install-mode mirror. Owned by `runtime/pwa.ts`. Tells consumers
   *  whether the app is running standalone vs. browser-tab and whether
   *  install is currently eligible. Updated on `beforeinstallprompt`,
   *  `appinstalled`, and `display-mode: standalone` matchMedia changes. */
  installMode: InstallMode
  deploymentIntegrity: DeploymentIntegritySnapshot
  offlineReadiness: OfflineReadinessSnapshot
}

export type DeadManTimerState =
  | 'standby'
  | 'nominal'
  | 'warning'
  | 'critical'
  | 'expired'
  | 'renew_window'

export type DeadManEscalationLevel =
  | 'none'
  | '1h'
  | '30m'
  | '15m'
  | '5m'
  | 'expired'

export interface DeadManSnapshot {
  timerState: DeadManTimerState
  escalationLevel: DeadManEscalationLevel
  audioEnabled: boolean
  /** Active flag mirrors `useDeadMan().isActive`. */
  active: boolean
  /** Remaining ms snapshot (sampled by panel). */
  remainingMs: number
  /** Total configured duration. */
  durationMs: number
  /** Last escalation event timestamp, or 0 if none. */
  lastEscalationAt: number
  /** Optional last escalation label (e.g. "30 MIN LEFT"). */
  lastEscalationLabel: string | null
}

export const DEAD_MAN_DEFAULT: DeadManSnapshot = {
  timerState: 'standby',
  escalationLevel: 'none',
  audioEnabled: isDeadManAudioEnabled(),
  active: false,
  remainingMs: 0,
  durationMs: 0,
  lastEscalationAt: 0,
  lastEscalationLabel: null,
}

type Listener = (s: RuntimeSnapshot) => void

const listeners = new Set<Listener>()

const initialBuildId =
  typeof __BUILD_ID__ === 'string' && __BUILD_ID__.length > 0 ? __BUILD_ID__ : 'unknown'

const snapshot: RuntimeSnapshot = {
  buildId: initialBuildId,
  buildHash: initialBuildId,
  startedAt: Date.now(),
  device: getDeviceProfile(),
  deviceType: getDeviceProfile().type,
  interactionMode: getDeviceProfile().interactionMode,
  viewport: {
    width: getDeviceProfile().width,
    height: getDeviceProfile().height,
    orientation: getDeviceProfile().orientation,
  },
  serviceWorker: {
    status: 'unregistered',
    controllerScriptUrl: null,
    scope: null,
    buildVersion: initialBuildId,
    needsRefresh: false,
    lastTransitionAt: Date.now(),
  },
  swVersion: initialBuildId,
  voice: { ...VOICE_STATE_DEFAULT },
  voiceState: VOICE_STATE_DEFAULT.state,
  permissions: { ...PERMISSION_DEFAULT },
  activeController: 'unknown',
  commandTrace: [],
  policy: {
    mode: getCurrentPolicyMode(),
    violationCount: 0,
    recentViolations: [],
  },
  policyViolations: 0,
  runtimeContinuity: {
    interactionModeLocked: getSessionLockedInteractionMode(),
    appLifecycleState: 'foreground',
    voiceRecoveryState: 'idle',
    gpsRecoveryState: 'healthy',
    persistenceHealth: 'healthy',
    lastKnownGoodSnapshotTime: Date.now(),
    pendingSWUpdate: false,
    gestureActive: false,
    recoveryCoordinatorState: 'idle',
  },
  network: {
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    lastOnlineAt: typeof navigator !== 'undefined' && navigator.onLine ? Date.now() : null,
    lastOfflineAt: typeof navigator !== 'undefined' && !navigator.onLine ? Date.now() : null,
    transitions: [],
  },
  voiceEvents: [],
  runtimeEvents: [],
  swEvents: [],
  voiceRegistry: { ...EMPTY_VOICE_REGISTRY_REPORT },
  voiceParserEvents: [],
  deadMan: { ...DEAD_MAN_DEFAULT },
  commandExecution: {
    last: COMMAND_EXECUTION_DEFAULT.last,
    history: [...COMMAND_EXECUTION_DEFAULT.history],
    counts: { ...COMMAND_EXECUTION_DEFAULT.counts },
  },
  wakeWordDetectedAt: null,
  haptics: getHapticsSnapshot(),
  installMode: getInstallMode(),
  deploymentIntegrity: {
    currentBuildId: initialBuildId,
    latestBuildId: null,
    swState: 'unregistered',
    cacheGeneration: '',
    cacheCount: 0,
    cacheEntryCount: 0,
    lastNetworkValidationAt: null,
    lastNetworkValidationOk: false,
    staleStatus: 'unknown',
    updatePending: false,
    recoveryInFlight: false,
    reloadAttempted: false,
  },
  offlineReadiness: {
    assessedAt: null,
    assessed: false,
    mapRelatedCacheEntryCount: 0,
    appShellLikelyCached: false,
    mapTileReadiness: 'unknown',
    bannerMessage: null,
    navigatorOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  },
}

function pushRolling<T>(arr: T[], item: T, max: number): T[] {
  const next = [...arr, item]
  while (next.length > max) next.shift()
  return next
}

function recordEvent(category: RollingEvent['category'], severity: RuntimeSeverity, msg: string, data?: unknown) {
  const e: RollingEvent = { ts: Date.now(), category, severity, msg, data }
  if (category === 'voice') snapshot.voiceEvents = pushRolling(snapshot.voiceEvents, e, 20)
  else if (category === 'sw') snapshot.swEvents = pushRolling(snapshot.swEvents, e, 10)
  else snapshot.runtimeEvents = pushRolling(snapshot.runtimeEvents, e, 20)
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn(snapshot)
    } catch {
      /* listener errors must never disturb runtime */
    }
  }
}

export function getRuntimeSnapshot(): RuntimeSnapshot {
  return snapshot
}

export function subscribeRuntimeSnapshot(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Called only when the wake-word gate passes (VoicePanel `parseAndRun`). */
export function recordWakeWordGatePassed(): void {
  const ts = Date.now()
  snapshot.wakeWordDetectedAt = ts
  logInfo('VOICE', 'wake-word gate passed', { wakeWordDetectedAt: ts })
  recordEvent('voice', 'INFO', 'wake-word acknowledged', { wakeWordDetectedAt: ts })
  // Centralized haptic broker — capability/throttle/cooldown checks live in haptics.ts.
  emitHaptic('wakeWord', 'wake-word.gate-passed')
  notify()
}

// ---------- update channels ----------

export function updateDeviceSnapshot(d: DeviceProfile): void {
  const prev = snapshot.device
  snapshot.device = d
  snapshot.deviceType = d.type
  snapshot.interactionMode = snapshot.runtimeContinuity.interactionModeLocked
  snapshot.viewport = { width: d.width, height: d.height, orientation: d.orientation }
  if (
    prev.interactionMode !== d.interactionMode ||
    prev.type !== d.type ||
    prev.orientation !== d.orientation
  ) {
    logInfo('DEVICE', 'profile change', {
      type: d.type,
      mode: d.interactionMode,
      orientation: d.orientation,
      w: d.width,
      h: d.height,
    })
    recordEvent('runtime', 'INFO', 'device profile changed', {
      type: d.type,
      mode: d.interactionMode,
      orientation: d.orientation,
      w: d.width,
      h: d.height,
    })
  }
  notify()
}

export function updateServiceWorker(patch: Partial<ServiceWorkerSnapshot>): void {
  const prev = snapshot.serviceWorker.status
  snapshot.serviceWorker = {
    ...snapshot.serviceWorker,
    ...patch,
    lastTransitionAt: Date.now(),
  }
  snapshot.swVersion = snapshot.serviceWorker.buildVersion
  if (typeof patch.needsRefresh === 'boolean') {
    snapshot.runtimeContinuity = {
      ...snapshot.runtimeContinuity,
      pendingSWUpdate: patch.needsRefresh,
    }
  }
  if (patch.status && patch.status !== prev) {
    logInfo('SW', `${prev} -> ${patch.status}`, {
      controller: snapshot.serviceWorker.controllerScriptUrl,
      build: snapshot.serviceWorker.buildVersion,
    })
    recordEvent('sw', 'INFO', `sw ${prev} -> ${patch.status}`, {
      controller: snapshot.serviceWorker.controllerScriptUrl,
      build: snapshot.serviceWorker.buildVersion,
    })
  }
  notify()
}

export function updateVoiceState(
  next: VoiceRuntimeState,
  extras: Partial<VoiceStateSnapshot> = {},
): void {
  const prev = snapshot.voice.state
  snapshot.voice = {
    ...snapshot.voice,
    state: next,
    ...extras,
    lastTransitionAt: Date.now(),
  }
  snapshot.voiceState = snapshot.voice.state
  if (prev !== next) {
    logInfo('VOICE', `${prev} -> ${next}`, extras)
    if (next === 'dead' || next === 'degraded' || next === 'blocked') {
      logWarn('VOICE', `entered ${next} state`, snapshot.voice)
      recordEvent('voice', next === 'dead' ? 'CRITICAL' : 'DEGRADED', `voice ${prev} -> ${next}`, extras)
      // Critical SR transitions (dead = silent dead-state, blocked = permission/OS refusal)
      // surface a single haptic confirmation to the operator. `degraded` is not haptic-worthy
      // (already in bounded recovery; would risk repeated buzzing).
      if (next === 'dead' || next === 'blocked') {
        emitHaptic('commandFailure', `voice.state=${next}`)
      }
    } else {
      recordEvent('voice', 'INFO', `voice ${prev} -> ${next}`, extras)
    }
  }
  notify()
}

export function updateVoiceArmed(armed: boolean): void {
  if (snapshot.voice.armed === armed) return
  snapshot.voice = { ...snapshot.voice, armed, lastTransitionAt: Date.now() }
  snapshot.voiceState = snapshot.voice.state
  notify()
}

export function updateVoiceMeta(meta: Partial<VoiceStateSnapshot>): void {
  snapshot.voice = { ...snapshot.voice, ...meta }
  snapshot.voiceState = snapshot.voice.state
  notify()
}

export function updatePermission(
  key: keyof PermissionSnapshot,
  value: PermissionStateLike,
): void {
  if (snapshot.permissions[key] === value) return
  snapshot.permissions = { ...snapshot.permissions, [key]: value }
  logInfo('PERMISSION', `${key} -> ${value}`)
  notify()
}

export function updateActiveController(mode: 'desktop' | 'mobile'): void {
  if (snapshot.activeController === mode) return
  const prev = snapshot.activeController
  snapshot.activeController = mode
  logInfo('RUNTIME', `active controller ${prev} -> ${mode}`)

  // Cross-device validation: controller should match deviceProfile.interactionMode.
  if (snapshot.runtimeContinuity.interactionModeLocked !== mode) {
    logWarn('RUNTIME', 'controller/device mode mismatch', {
      controller: mode,
      deviceMode: snapshot.runtimeContinuity.interactionModeLocked,
      type: snapshot.device.type,
    })
  }
  notify()
}

export function updateRuntimeLifecycle(state: AppLifecycleState): void {
  if (snapshot.runtimeContinuity.appLifecycleState === state) return
  const coordinatorState: RecoveryCoordinatorState =
    state === 'foreground'
      ? 'stable'
      : state === 'resuming'
        ? 'resuming'
        : state === 'background' || state === 'hidden' || state === 'suspended'
          ? 'background'
          : 'idle'
  snapshot.runtimeContinuity = {
    ...snapshot.runtimeContinuity,
    appLifecycleState: state,
    recoveryCoordinatorState: coordinatorState,
  }
  recordEvent('runtime', 'INFO', `lifecycle -> ${state}`)
  notify()
}

export function updateVoiceRecoveryState(state: VoiceRecoveryState): void {
  if (snapshot.runtimeContinuity.voiceRecoveryState === state) return
  snapshot.runtimeContinuity = {
    ...snapshot.runtimeContinuity,
    voiceRecoveryState: state,
    recoveryCoordinatorState: state === 'recovering' ? 'recovering' : snapshot.runtimeContinuity.recoveryCoordinatorState,
  }
  recordEvent('voice', state === 'failed' ? 'DEGRADED' : 'WARN', `voice recovery -> ${state}`)
  notify()
}

export function updateGpsRecoveryState(state: GpsRecoveryState): void {
  if (snapshot.runtimeContinuity.gpsRecoveryState === state) return
  snapshot.runtimeContinuity = {
    ...snapshot.runtimeContinuity,
    gpsRecoveryState: state,
    recoveryCoordinatorState: state === 'recovering' ? 'recovering' : snapshot.runtimeContinuity.recoveryCoordinatorState,
  }
  recordEvent('runtime', state === 'stale' ? 'WARN' : state === 'denied' ? 'CRITICAL' : 'INFO', `gps -> ${state}`)
  notify()
}

export function updatePersistenceHealth(state: PersistenceHealth): void {
  if (snapshot.runtimeContinuity.persistenceHealth === state) return
  snapshot.runtimeContinuity = { ...snapshot.runtimeContinuity, persistenceHealth: state }
  recordEvent(
    'runtime',
    state === 'error' ? 'CRITICAL' : state === 'corrupt_recovered' ? 'DEGRADED' : 'INFO',
    `persistence -> ${state}`,
  )
  notify()
}

export function markLastKnownGoodSnapshotTime(ts: number = Date.now()): void {
  snapshot.runtimeContinuity = {
    ...snapshot.runtimeContinuity,
    lastKnownGoodSnapshotTime: ts,
    persistenceHealth: snapshot.runtimeContinuity.persistenceHealth === 'error' ? 'recovering' : snapshot.runtimeContinuity.persistenceHealth,
  }
  notify()
}

export function updatePendingSwUpdate(v: boolean): void {
  if (snapshot.runtimeContinuity.pendingSWUpdate === v) return
  snapshot.runtimeContinuity = { ...snapshot.runtimeContinuity, pendingSWUpdate: v }
  snapshot.deploymentIntegrity = {
    ...snapshot.deploymentIntegrity,
    updatePending: v,
  }
  notify()
}

export function updateDeploymentIntegrity(
  patch: Partial<DeploymentIntegritySnapshot>,
): void {
  snapshot.deploymentIntegrity = {
    ...snapshot.deploymentIntegrity,
    ...patch,
  }
  notify()
}

export function updateOfflineReadiness(patch: Partial<OfflineReadinessSnapshot>): void {
  snapshot.offlineReadiness = {
    ...snapshot.offlineReadiness,
    ...patch,
  }
  notify()
}

export function updateGestureActive(v: boolean): void {
  if (snapshot.runtimeContinuity.gestureActive === v) return
  snapshot.runtimeContinuity = { ...snapshot.runtimeContinuity, gestureActive: v }
  notify()
}

export function recordPolicyViolation(v: PolicyViolation): void {
  const next = [...snapshot.policy.recentViolations, v]
  while (next.length > 10) next.shift()
  snapshot.policy = {
    mode: snapshot.policy.mode,
    violationCount: snapshot.policy.violationCount + 1,
    recentViolations: next,
  }
  snapshot.policyViolations = snapshot.policy.violationCount
  logWarn('RUNTIME', `policy violation ${v.behavior} expected=${v.expected} attempted=${v.attempted}`, {
    mode: v.mode,
    context: v.context,
  })
  recordEvent('runtime', 'WARN', `policy violation ${v.behavior}`, {
    expected: v.expected,
    attempted: v.attempted,
    context: v.context,
  })
  notify()
}

export function refreshPolicyMode(): void {
  const mode = getCurrentPolicyMode()
  if (snapshot.policy.mode === mode) return
  snapshot.policy = { ...snapshot.policy, mode }
  snapshot.policyViolations = snapshot.policy.violationCount
  notify()
}

export function updateVoiceRegistryReport(report: VoiceRegistryReport): void {
  snapshot.voiceRegistry = report
  // Surface ghost / duplicate findings into the runtime events stream so
  // operators can see them in the overlay without opening devtools.
  if (report.ghostDirectoryItems.length > 0) {
    recordEvent('runtime', 'WARN', `voice directory has ${report.ghostDirectoryItems.length} ghost item(s)`, {
      ghosts: report.ghostDirectoryItems.map((g) => g.cmd),
    })
  }
  if (report.duplicateAliases.length > 0) {
    recordEvent('runtime', 'WARN', `voice registry has ${report.duplicateAliases.length} duplicate alias(es)`, {
      duplicates: report.duplicateAliases.map((d) => d.phrase),
    })
  }
  notify()
}

export function recordVoiceParserEvent(input: Omit<VoiceParserEvent, 'ts'> | VoiceParserEvent): void {
  const ev: VoiceParserEvent =
    'ts' in input && typeof input.ts === 'number' ? (input as VoiceParserEvent) : { ts: Date.now(), ...input }
  const next = [...snapshot.voiceParserEvents, ev]
  while (next.length > 20) next.shift()
  snapshot.voiceParserEvents = next

  // Single grep-friendly `[VOICE]` line; warns on rejection so PROD
  // bundles still surface the rejection reason.
  const line = formatVoiceParserLine(ev)
  if (ev.result === 'rejected') logWarn('VOICE', line, ev.message)
  else logInfo('VOICE', line)

  // Mirror into the rolling voice events feed so the overlay surfaces both
  // lifecycle transitions and parser hits in one chronological view.
  const sev: RuntimeSeverity = ev.result === 'executed' ? 'INFO' : 'WARN'
  recordEvent(
    'voice',
    sev,
    `parser ${ev.result === 'executed' ? 'executed' : `rejected:${ev.reason}`} ${ev.commandId ?? ev.normalized.slice(0, 30)}`,
  )
  notify()
}

export function updateDeadManTimer(patch: Partial<DeadManSnapshot>): void {
  const next: DeadManSnapshot = {
    ...snapshot.deadMan,
    ...patch,
    audioEnabled: isDeadManAudioEnabled(),
  }
  // Skip notify if nothing meaningful changed (avoid render churn).
  const prev = snapshot.deadMan
  if (
    prev.timerState === next.timerState &&
    prev.escalationLevel === next.escalationLevel &&
    prev.active === next.active &&
    prev.remainingMs === next.remainingMs &&
    prev.durationMs === next.durationMs &&
    prev.audioEnabled === next.audioEnabled &&
    prev.lastEscalationAt === next.lastEscalationAt &&
    prev.lastEscalationLabel === next.lastEscalationLabel
  ) {
    return
  }
  snapshot.deadMan = next
  notify()
}

export function recordDeadManEscalation(
  level: DeadManEscalationLevel,
  label: string,
): void {
  const ts = Date.now()
  snapshot.deadMan = {
    ...snapshot.deadMan,
    escalationLevel: level,
    lastEscalationAt: ts,
    lastEscalationLabel: label,
    audioEnabled: isDeadManAudioEnabled(),
  }
  recordEvent('runtime', level === 'expired' ? 'CRITICAL' : 'WARN', `deadman escalation -> ${level}`, {
    label,
    audioEnabled: snapshot.deadMan.audioEnabled,
  })
  notify()
}

// ---------- command execution verification ----------

const EXEC_HISTORY_MAX = 25
let nextExecutionId = 1

function execLog(category: 'COMMAND_EXEC' | 'COMMAND_OK' | 'COMMAND_FAIL' | 'COMMAND_TIMEOUT', line: string): void {
  // Ok/exec at INFO (silenced in PROD); fail/timeout at WARN so they survive PROD console.
  if (category === 'COMMAND_FAIL' || category === 'COMMAND_TIMEOUT') {
    logWarn(category, line)
  } else {
    logInfo(category, line)
  }
}

function commitExecutionEntry(entry: CommandExecutionEntry): void {
  const next = [...snapshot.commandExecution.history, entry]
  while (next.length > EXEC_HISTORY_MAX) next.shift()
  const counts = { ...snapshot.commandExecution.counts }
  switch (entry.status) {
    case 'requested':
      counts.requested += 1
      break
    case 'success':
      counts.success += 1
      break
    case 'failed':
      counts.failed += 1
      break
    case 'timeout':
      counts.timeout += 1
      break
    case 'rejected':
      counts.rejected += 1
      break
    case 'deferred':
      counts.deferred += 1
      break
    default:
      break
  }
  snapshot.commandExecution = { last: entry, history: next, counts }
  notify()
}

function updateExecutionEntry(
  id: number,
  patch: Partial<CommandExecutionEntry>,
  countsPatch?: Partial<typeof snapshot.commandExecution.counts>,
): CommandExecutionEntry | null {
  const idx = snapshot.commandExecution.history.findIndex((e) => e.id === id)
  if (idx < 0) return null
  const prev = snapshot.commandExecution.history[idx]
  const updated: CommandExecutionEntry = { ...prev, ...patch }
  const history = snapshot.commandExecution.history.slice()
  history[idx] = updated
  const counts = countsPatch
    ? {
        requested: snapshot.commandExecution.counts.requested + (countsPatch.requested ?? 0),
        success: snapshot.commandExecution.counts.success + (countsPatch.success ?? 0),
        failed: snapshot.commandExecution.counts.failed + (countsPatch.failed ?? 0),
        timeout: snapshot.commandExecution.counts.timeout + (countsPatch.timeout ?? 0),
        rejected: snapshot.commandExecution.counts.rejected + (countsPatch.rejected ?? 0),
        deferred: snapshot.commandExecution.counts.deferred + (countsPatch.deferred ?? 0),
      }
    : snapshot.commandExecution.counts
  // `last` always points at the most recent in chronological order.
  const last = history[history.length - 1] ?? null
  snapshot.commandExecution = { last, history, counts }
  notify()
  return updated
}

export interface ReportCommandStartedInput {
  source: CommandSourceKind
  transcript: string
  normalized: string
}

export function reportCommandStarted(input: ReportCommandStartedInput): number {
  const id = nextExecutionId++
  const ts = Date.now()
  const entry: CommandExecutionEntry = {
    id,
    commandId: null,
    source: input.source,
    transcript: input.transcript,
    normalized: input.normalized,
    requestedAt: ts,
    startedAt: null,
    completedAt: null,
    status: 'requested',
    verification: 'pending',
    failureReason: null,
    message: null,
    durationMs: null,
  }
  commitExecutionEntry(entry)
  execLog('COMMAND_EXEC', formatExecLine(entry))
  return id
}

export function markCommandResolving(
  id: number,
  commandId: string,
  startedAt: number = Date.now(),
): void {
  const next: CommandExecutionStatus = 'executing'
  updateExecutionEntry(id, { commandId, startedAt, status: next })
}

/** Once an entry has resolved, subsequent `report*` calls are no-ops.
 *  This prevents double-counting if a verifier resolves after a timeout
 *  (or vice versa) due to slow async tasks. */
function isExecutionTerminal(entry: CommandExecutionEntry): boolean {
  return (
    entry.status === 'success' ||
    entry.status === 'failed' ||
    entry.status === 'timeout' ||
    entry.status === 'rejected' ||
    entry.status === 'deferred'
  )
}

export function reportCommandSuccess(
  id: number,
  opts: { verification: CommandVerificationState; message?: string },
): void {
  const ts = Date.now()
  const prev = snapshot.commandExecution.history.find((e) => e.id === id)
  if (!prev || isExecutionTerminal(prev)) return
  const durationMs = prev.startedAt != null ? ts - prev.startedAt : ts - prev.requestedAt
  const updated = updateExecutionEntry(
    id,
    {
      status: 'success',
      verification: opts.verification,
      completedAt: ts,
      durationMs,
      message: opts.message ?? prev.message ?? null,
      failureReason: null,
    },
    { success: 1 },
  )
  if (updated) {
    execLog('COMMAND_OK', formatOkLine(updated))
    // Phase-1 haptic: verified executions only. `unverified_ok` is best-effort
    // and would create haptic noise on chatty commands (status, route stats…).
    if (updated.verification === 'verified') {
      emitHaptic('commandSuccess', `cmd=${updated.commandId ?? '∅'}`)
    }
  }
}

export function reportCommandFailure(
  id: number,
  reason: CommandFailureReason,
  message?: string,
): void {
  const ts = Date.now()
  const prev = snapshot.commandExecution.history.find((e) => e.id === id)
  if (!prev || isExecutionTerminal(prev)) return
  const durationMs = prev.startedAt != null ? ts - prev.startedAt : ts - prev.requestedAt
  const updated = updateExecutionEntry(
    id,
    {
      status: 'failed',
      verification: 'skipped',
      completedAt: ts,
      durationMs,
      failureReason: reason,
      message: message ?? prev.message ?? null,
    },
    { failed: 1 },
  )
  if (updated) {
    execLog('COMMAND_FAIL', formatFailLine(updated))
    if (isCriticalFailureReason(reason)) {
      emitHaptic('commandFailure', `cmd=${updated.commandId ?? '∅'} reason=${reason}`)
    }
  }
}

export function reportCommandRejected(
  id: number,
  reason: CommandFailureReason,
  message?: string,
): void {
  const ts = Date.now()
  const prev = snapshot.commandExecution.history.find((e) => e.id === id)
  if (!prev || isExecutionTerminal(prev)) return
  const durationMs = prev.startedAt != null ? ts - prev.startedAt : ts - prev.requestedAt
  const updated = updateExecutionEntry(
    id,
    {
      status: 'rejected',
      verification: 'skipped',
      completedAt: ts,
      durationMs,
      failureReason: reason,
      message: message ?? prev.message ?? null,
    },
    { rejected: 1 },
  )
  if (updated) {
    execLog('COMMAND_FAIL', formatFailLine(updated))
    if (isCriticalFailureReason(reason)) {
      emitHaptic('commandFailure', `cmd=${updated.commandId ?? '∅'} reason=${reason}`)
    }
  }
}

/** Phase-1 critical-failure taxonomy for haptic emission. Excludes
 *  `missing_handler` (unknown command) and `invalid_state` (often
 *  user-recoverable) to prevent haptic noise on rejected free-text. */
function isCriticalFailureReason(r: CommandFailureReason): boolean {
  return (
    r === 'unavailable' ||
    r === 'denied' ||
    r === 'unsupported' ||
    r === 'verification_failed' ||
    r === 'timeout'
  )
}

export function reportCommandDeferred(id: number, message?: string): void {
  const prev = snapshot.commandExecution.history.find((e) => e.id === id)
  if (!prev || isExecutionTerminal(prev)) return
  const updated = updateExecutionEntry(
    id,
    { status: 'deferred', message: message ?? prev.message ?? null },
    { deferred: 1 },
  )
  if (updated) execLog('COMMAND_EXEC', `deferred ${formatExecLine(updated)}`)
}

export function reportCommandTimeout(id: number): void {
  const ts = Date.now()
  const prev = snapshot.commandExecution.history.find((e) => e.id === id)
  if (!prev || isExecutionTerminal(prev)) return
  const durationMs = prev.startedAt != null ? ts - prev.startedAt : ts - prev.requestedAt
  const updated = updateExecutionEntry(
    id,
    {
      status: 'timeout',
      verification: 'verification_failed',
      completedAt: ts,
      durationMs,
      failureReason: 'timeout',
      message: prev.message ?? 'no verification confirmation',
    },
    { timeout: 1 },
  )
  if (updated) {
    execLog('COMMAND_TIMEOUT', formatTimeoutLine(updated))
    emitHaptic('commandFailure', `cmd=${updated.commandId ?? '∅'} reason=timeout`)
  }
}

export function recordCommandDispatch(entry: CommandTraceEntry): void {
  const next = [...snapshot.commandTrace, entry]
  while (next.length > 10) next.shift()
  snapshot.commandTrace = next
  logInfo('COMMAND', `${entry.source} ${entry.cmd} -> ${entry.ok ? 'ok' : 'fail'}`, {
    msg: entry.message,
  })
  notify()
}

// ---------- bootstrap ----------

let installed = false

/** True after `installRuntimeSnapshot()` completed in a browser context. Replaces ad-hoc `window` boot flags for UI. */
export function isRuntimeSnapshotInstalled(): boolean {
  return installed
}

/**
 * Wire the snapshot to the device profile and expose globals.
 * Idempotent and safe to call multiple times.
 */
export function installRuntimeSnapshot(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  subscribeDeviceProfile((d) => {
    updateDeviceSnapshot(d)
    refreshPolicyMode()
    reportPolicyAttempt('controller.sessionLockedInteractionMode', 'enable', 'device-profile-update')
    if (d.interactionMode !== snapshot.runtimeContinuity.interactionModeLocked) {
      reportPolicyAttempt(
        'controller.sessionLockedInteractionMode',
        'disable',
        `session-lock mismatch: locked=${snapshot.runtimeContinuity.interactionModeLocked} live=${d.interactionMode}`,
      )
    }
  })

  // Funnel every DEPE violation into the snapshot + log channel.
  subscribePolicyViolation(recordPolicyViolation)

  const w = window as Window & { __hudRuntime?: RuntimeSnapshot; __hudRuntimeGet?: () => RuntimeSnapshot }
  w.__hudRuntime = snapshot
  w.__hudRuntimeGet = () => snapshot

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      updateRuntimeLifecycle('resuming')
      if (snapshot.runtimeContinuity.gpsRecoveryState === 'suspended') {
        updateGpsRecoveryState('recovering')
      }
    } else {
      updateRuntimeLifecycle('hidden')
      updateGpsRecoveryState('suspended')
    }
  }
  const onPageHide = () => {
    updateRuntimeLifecycle('suspended')
    updateGpsRecoveryState('suspended')
  }
  const onPageShow = () => {
    updateRuntimeLifecycle('resuming')
    if (snapshot.runtimeContinuity.gpsRecoveryState === 'suspended') {
      updateGpsRecoveryState('recovering')
    }
  }
  const onFocus = () => updateRuntimeLifecycle('foreground')
  const onBlur = () => updateRuntimeLifecycle('background')
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  reportPolicyAttempt('runtime.recoveryCoordinatorActive', 'enable', 'installRuntimeSnapshot')

  // Mirror haptic broker state into the snapshot. The broker is the source
  // of truth; this listener simply funnels each state change into the
  // existing notify() pipeline so subscribers (overlay, observers) update.
  setHapticsStateListener((s) => {
    snapshot.haptics = s
    notify()
  })

  // Mirror PWA install-mode broker state. The broker owns the
  // `beforeinstallprompt` capture, `appinstalled`, and matchMedia
  // listeners; we only mirror state here and surface lifecycle hits
  // through the existing rolling-event feed.
  setInstallModeListener((m) => {
    const prev = snapshot.installMode
    snapshot.installMode = m
    if (
      prev.standalone !== m.standalone ||
      prev.eligible !== m.eligible ||
      prev.promptAvailable !== m.promptAvailable
    ) {
      recordEvent(
        'runtime',
        'INFO',
        `pwa standalone=${m.standalone} eligible=${m.eligible} prompt=${m.promptAvailable}`,
        { platform: m.platform },
      )
    }
    notify()
  })
  // Wire the watcher AFTER the listener so the initial notify reaches it.
  installPwaWatcher()

  const onOnline = () => {
    snapshot.network = {
      ...snapshot.network,
      online: true,
      lastOnlineAt: Date.now(),
      transitions: pushRolling(snapshot.network.transitions, { ts: Date.now(), online: true }, 10),
    }
    recordEvent('network', 'INFO', 'network -> online')
    notify()
  }
  const onOffline = () => {
    snapshot.network = {
      ...snapshot.network,
      online: false,
      lastOfflineAt: Date.now(),
      transitions: pushRolling(snapshot.network.transitions, { ts: Date.now(), online: false }, 10),
    }
    recordEvent('network', 'WARN', 'network -> offline')
    notify()
  }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)

  // Cross-device validation: periodic consistency checks (battery-conscious on mobile).
  const VALIDATE_INTERVAL_MS = 30_000
  window.setInterval(() => {
    const v = snapshot.voice
    if (
      v.armed &&
      v.state !== 'listening' &&
      v.state !== 'processing' &&
      v.state !== 'arming' &&
      Date.now() - v.lastTransitionAt > 4000
    ) {
      logWarn('VOICE', 'armed but recognizer not listening', {
        state: v.state,
        sinceMs: Date.now() - v.lastTransitionAt,
      })
    }
    if (
      snapshot.activeController !== 'unknown' &&
      snapshot.activeController !== snapshot.runtimeContinuity.interactionModeLocked
    ) {
      logWarn('RUNTIME', 'persistent controller/device mode mismatch', {
        controller: snapshot.activeController,
        device: snapshot.runtimeContinuity.interactionModeLocked,
      })
    }

    // DEPE: ensure required behaviors haven't been silently turned off.
    // Mobile mode REQUIRES the mobile interaction controller to be mounted.
    // If activeController disagrees, raise a violation through the engine.
    if (
      snapshot.policy.mode === 'mobile' &&
      snapshot.activeController === 'desktop'
    ) {
      reportPolicyAttempt(
        'controller.mobileInteractionModel',
        'disable',
        'periodic-validator: desktop controller mounted in mobile mode',
      )
    }
  }, VALIDATE_INTERVAL_MS)

  logInfo('RUNTIME', 'snapshot installed', {
    build: snapshot.buildId,
    device: snapshot.device.type,
    mode: snapshot.device.interactionMode,
  })
  recordEvent('runtime', 'INFO', 'snapshot installed', { build: snapshot.buildId })
}
