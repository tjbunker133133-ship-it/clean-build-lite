export type {
  WearableSignal,
  WearableSignalType,
  WearableAdapter,
  WearableAdapterKind,
  WearableCapability,
  EscalationState,
  EscalationSnapshot,
  EscalationRiskEvent,
  EscalationTriggerKind,
  InterpretationSnapshot,
  ReadinessIndicator,
  OutputChannelKind,
  EscalationProjection,
} from './types'

export {
  createEscalationSnapshot,
  createEscalationContext,
  reduceEscalationMachine,
  escalationReducer,
  EscalationActions,
  applyEscalationResult,
  contextToSnapshot,
  getCountdownRemainingMs,
  tickEscalationCountdown,
  mapTriggerKindToType,
  mapSignalToTrigger,
} from './escalationStateMachine'
export type {
  EscalationMachineAction,
  EscalationMachineConfig,
  EscalationContext,
  EscalationEvent,
  EscalationResult,
  EscalationTrigger,
} from './escalationStateMachine'

export { interpretWearableSignals } from './interpretationLayer'

export {
  ESCALATION_TRIGGER_REGISTRY,
  resolveTriggersFromSignal,
  createTriggerCooldownState,
  isTriggerOnCooldown,
} from './escalationTriggerRegistry'
export type {
  EscalationTriggerDef,
  EscalationTriggerType,
  EscalationTriggerSeverity,
  TriggerCooldownState,
} from './escalationTriggerRegistry'

export { evaluateConfidenceGate, DEFAULT_CONFIDENCE_GATE } from './confidenceGate'
export type { SignalConfidenceGateConfig, ConfidenceDegradeBehavior } from './confidenceGate'

export { evaluateEscalationPipeline } from './escalationPipeline'
export type { EscalationPipelineAction } from './escalationPipeline'
export {
  buildEscalationProjection,
  createDefaultOutputChannels,
  projectToWatchNotification,
  WAL_ESCALATION_NOTIFICATION_TAG,
} from './outputChannels'

export {
  WAL_PRESET_DEFAULTS,
  loadWalUserMode,
  saveWalUserMode,
  getWalPresetConfig,
  presetAllowsAutoEscalation,
} from './userPresets'
export type { WalUserMode, WalPresetConfig } from './userPresets'

export { recordEscalationAudit, getEscalationAuditLog, _resetEscalationAuditForTests } from './escalationAudit'
export type { EscalationAuditEntry } from './escalationAudit'

export { createDefaultWalAdapterRegistry, listAdapterCapabilities } from './walRegistry'
export { androidHealthConnectAdapter } from './adapters/androidHealthConnectAdapter'
export { notificationMirrorAdapter } from './adapters/notificationMirrorAdapter'

export { createWalRuntime, WAL_SOS_INTEGRATION_DOC } from './walRuntime'
export type { WalRuntime, WalRuntimeOptions, WalSosDispatchHook, WalRuntimeStatus } from './walRuntime'
export type {
  InferredWearableType,
  AttachDeviceInput,
  AttachDeviceResult,
  AttachedWearableSummary,
} from './walRuntime'

export {
  connectWearables,
  disconnectWearables,
  probeWearableDevices,
  loadWalConnectionState,
  saveWalConnectionState,
  selectConnectableAdapters,
  connectionStatusLabel,
  listCapabilitiesSummary,
} from './walConnection'
export type { WalConnectionState, WalDeviceProbe, ConnectWearableResult } from './walConnection'

export {
  WAL_ESCALATION_TICK_MS,
  WAL_HEALTH_POLL_MS,
  WAL_UI_REFRESH_IDLE_MS,
  WAL_UI_REFRESH_PENDING_MS,
  WAL_CONNECTION_STORAGE_KEY,
} from './walRuntimeConfig'

export { shouldIngestSignal, createSignalThrottleState } from './signalIngestThrottle'
export {
  shouldProjectEscalation,
  createProjectionThrottleState,
} from './projectionThrottle'

export {
  runConnectWearableFlow,
  silentReconnectWearable,
  classifyWearables,
  buildReadyCard,
  CONNECT_WEARABLE_SEARCH_LABEL,
  CONNECT_WEARABLE_ERROR_LABEL,
} from './walDeviceConnect'
export type {
  ConnectWearableUiPhase,
  ConnectWearableReadyCard,
  ConnectWearableFlowResult,
  WearableClassification,
} from './walDeviceConnect'

export { WAL_TIER_MAPPING, WAL_REFACTOR_PLAN } from './tierMapping'
export type { WalTierEntry, WalTierSlot, WalRefactorPhase } from './tierMapping'

export {
  WEARABLE_DEVICE_CONTRACTS,
  enforceEscalationProjection,
  enforceChannelProjection,
  validateEscalationProjection,
  getWcelDiagnostics,
} from '../wcel'
export type { WearableDeviceType, WcelDiagnostics, WcelValidationResult } from '../wcel'

export {
  safeProjectToWearable,
  safeProjectEscalationToChannel,
  applyDcrlShaping,
  getDeviceCapability,
  getDcrlDiagnostics,
} from '../dcrl'
export type { DcrlDeviceType, DcrlDiagnostics, WearableOutboundPayload } from '../dcrl'
