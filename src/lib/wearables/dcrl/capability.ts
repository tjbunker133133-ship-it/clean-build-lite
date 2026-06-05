import type { OutputChannelKind } from '../wal/types'
import type { DcrlDeviceType, DcrlDynamicState } from './types'
import { getDcrlDevice, getDcrlDeviceByType, PHONE_DEVICE_ID } from './store'
import { channelOwnerDevice, resolveEffectiveCapability, resolveWcelThrottleDirective } from './throttle'

export type DeviceCapabilityDerived = {
  isUnavailable: boolean
  isThrottled: boolean
}

export type DeviceCapabilityProfile = {
  deviceId: string
  deviceType: DcrlDeviceType
  state: DcrlDynamicState
  derived: DeviceCapabilityDerived
  /** True when synthesized because registry lookup failed. */
  fallbackMode: boolean
}

function buildDerived(type: DcrlDeviceType, state: DcrlDynamicState): DeviceCapabilityDerived {
  const effective = resolveEffectiveCapability(type)
  const throttle = resolveWcelThrottleDirective(
    type === 'watch'
      ? 'watch_notification'
      : type === 'glasses'
        ? 'glasses_display'
        : type === 'ring'
          ? 'ring_passive'
          : 'phone',
  )

  const isUnavailable =
    !state.present ||
    !state.reachable ||
    state.degraded ||
    (!state.connected && type !== 'phone') ||
    (type === 'watch' && state.notificationPermission === 'denied')

  const isThrottled =
    state.batteryLow ||
    state.degraded ||
    throttle.verdict === 'restrict' ||
    (type === 'watch' && state.notificationPermission === 'default')

  return { isUnavailable, isThrottled }
}

function watchRestrictedFallback(deviceId: string): DeviceCapabilityProfile {
  return {
    deviceId,
    deviceType: 'watch',
    state: {
      present: true,
      connected: true,
      authenticated: false,
      reachable: true,
      notificationPermission: 'default',
      batteryPct: null,
      batteryLow: false,
      foreground: true,
      degraded: true,
      streaming: false,
      lastSeenAt: null,
    },
    derived: { isUnavailable: true, isThrottled: true },
    fallbackMode: true,
  }
}

/** Lookup device capability profile for projection pipeline. */
export function getDeviceCapability(deviceId: string): DeviceCapabilityProfile | null {
  const record = getDcrlDevice(deviceId)
  if (!record) {
    const byType = getDcrlDeviceByType(deviceId as DcrlDeviceType)
    if (byType) {
      return {
        deviceId: byType.deviceId,
        deviceType: byType.type,
        state: byType.dynamic,
        derived: buildDerived(byType.type, byType.dynamic),
        fallbackMode: false,
      }
    }
    return null
  }
  return {
    deviceId: record.deviceId,
    deviceType: record.type,
    state: record.dynamic,
    derived: buildDerived(record.type, record.dynamic),
    fallbackMode: false,
  }
}

export function resolveDeviceIdForChannel(channel: OutputChannelKind): string {
  const type = channelOwnerDevice(channel)
  if (type === 'phone') return PHONE_DEVICE_ID
  return getDcrlDeviceByType(type)?.deviceId ?? `slot-${type}`
}

export function getDeviceCapabilityForChannel(
  channel: OutputChannelKind,
): DeviceCapabilityProfile | null {
  return getDeviceCapability(resolveDeviceIdForChannel(channel))
}

export function createWatchRestrictedFallbackProfile(deviceId: string): DeviceCapabilityProfile {
  return watchRestrictedFallback(deviceId)
}
