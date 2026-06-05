export type {
  DcrlDeviceType,
  DcrlDeviceRole,
  DcrlStaticCapability,
  DcrlNotificationPermission,
  DcrlDynamicState,
  DcrlStaticProfile,
  DcrlDeviceRecord,
  DcrlEffectiveCapability,
  DcrlWcelThrottleVerdict,
  DcrlWcelThrottleDirective,
  DcrlThrottleRecord,
  DcrlDiagnostics,
  DcrlThrottleContext,
} from './types'

export {
  PHONE_STATIC_PROFILE,
  WATCH_STATIC_PROFILE,
  RING_STATIC_PROFILE,
  GLASSES_STATIC_PROFILE,
  DCRL_STATIC_REGISTRY,
  staticProfileFor,
  defaultDynamicState,
} from './registry'

export {
  getDcrlDiagnostics,
  subscribeDcrlDiagnostics,
  listDcrlDevices,
  getDcrlDevice,
  getDcrlDeviceByType,
  upsertDcrlDevice,
  patchDcrlDynamic,
  patchDcrlDynamicByType,
  recordDcrlThrottle,
  seedPhoneHostDevice,
  ensureDcrlDeviceSlot,
  installDcrlDiagnostics,
  _resetDcrlStoreForTests,
  PHONE_DEVICE_ID,
} from './store'

export {
  resolveEffectiveCapability,
  channelOwnerDevice,
  resolveWcelThrottleDirective,
  filterChannelsByDcrl,
  dcrlAllowsChannelProjection,
} from './throttle'

export {
  gateChannelProjectionWithDcrl,
  gateEscalationProjectionWithDcrl,
} from './gate'

export {
  runDcrlDynamicSync,
  startDcrlDynamicSync,
  stopDcrlDynamicSync,
  ingestDcrlBatteryPct,
  _resetDcrlDynamicSyncForTests,
} from './sync'

export {
  getDeviceCapability,
  getDeviceCapabilityForChannel,
  resolveDeviceIdForChannel,
  createWatchRestrictedFallbackProfile,
} from './capability'
export type { DeviceCapabilityProfile, DeviceCapabilityDerived } from './capability'

export {
  safeProjectToWearable,
  safeProjectEscalationToChannel,
  escalationToWearablePayload,
  throttleWearablePayload,
  applyDcrlShaping,
  enforceWearableProjection,
  wearablePayloadToProjection,
  isWcelEnforcementAvailable,
  _setSendToDeviceHandlerForTests,
  _setWcelEnforcementAvailableForTests,
  _resetSafeProjectForTests,
} from './safeProject'
export type {
  WearableOutboundPayload,
  SafeProjectResult,
  SendToDeviceHandler,
} from './safeProject'
