export type {
  WearableDeviceType,
  WearableChannelRole,
  WearableProjectionKind,
  WearableDeviceContract,
  WcelVerdict,
  WcelViolation,
  WcelViolationCode,
  WcelValidationResult,
  WcelEnforcementRecord,
  WcelDiagnostics,
} from './types'

export {
  PHONE_CONTRACT,
  WATCH_CONTRACT,
  RING_CONTRACT,
  GLASSES_CONTRACT,
  WEARABLE_DEVICE_CONTRACTS,
  contractForDevice,
  FORBIDDEN_HUD_PROJECTION_PATTERNS,
  GLASSES_HINT_PATTERN,
} from './contracts'

export {
  validateEscalationProjection,
  validateWearableSignalIngress,
  channelToDevice,
  inferProjectionKind,
  inferDeviceTypeFromSource,
} from './validate'

export {
  enforceEscalationProjection,
  enforceChannelProjection,
  auditWearableSignalIngress,
} from './enforce'

export {
  getWcelDiagnostics,
  subscribeWcelDiagnostics,
  recordWcelEnforcement,
  installWcelDiagnostics,
  _resetWcelDiagnosticsForTests,
} from './store'
