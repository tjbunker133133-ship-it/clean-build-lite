import { GEO_EXTERNAL_GRANT_EVENT } from './geoExternalGrant'

export type PermissionStateLike = PermissionState | 'unsupported' | 'unknown'

async function queryPermission(name: PermissionName): Promise<PermissionStateLike> {
  if (!navigator.permissions?.query) return 'unknown'
  try {
    const result = await navigator.permissions.query({ name })
    return result.state
  } catch {
    return 'unknown'
  }
}

export async function getPermissionSnapshot() {
  const geolocation = await queryPermission('geolocation' as PermissionName)
  const microphone = await queryPermission('microphone' as PermissionName)
  const notifications: PermissionStateLike =
    typeof Notification === 'undefined'
      ? 'unsupported'
      : Notification.permission === 'default'
        ? 'prompt'
        : Notification.permission
  return { geolocation, microphone, notifications }
}

const GPS_PERMISSION_STORAGE_KEY = 'gpsPermission'

export async function requestGeolocationPermission(): Promise<PermissionStateLike> {
  if (!navigator.geolocation) return 'unsupported'
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => {
        try {
          localStorage.setItem(GPS_PERMISSION_STORAGE_KEY, 'granted')
        } catch {
          /* ignore */
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(GEO_EXTERNAL_GRANT_EVENT))
        }
        resolve('granted')
      },
      (err) => resolve(err?.code === 1 ? 'denied' : 'prompt'),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    )
  })
}

export async function requestMicrophonePermission(): Promise<PermissionStateLike> {
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported'
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    return 'granted'
  } catch {
    const state = await queryPermission('microphone' as PermissionName)
    return state === 'unknown' ? 'denied' : state
  }
}

export async function requestCameraPermission(): Promise<PermissionStateLike> {
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported'
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true })
    stream.getTracks().forEach((t) => t.stop())
    return 'granted'
  } catch {
    return 'denied'
  }
}

export async function requestNotificationPermission(): Promise<PermissionStateLike> {
  if (typeof Notification === 'undefined' || !Notification.requestPermission) return 'unsupported'
  const state = await Notification.requestPermission()
  return state === 'default' ? 'prompt' : state
}

export async function requestOrientationPermission(): Promise<PermissionStateLike> {
  const request = (DeviceOrientationEvent as any)?.requestPermission
  if (!request) return 'unsupported'
  try {
    const state = await request.call(DeviceOrientationEvent)
    return state === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

export async function requestMotionPermission(): Promise<PermissionStateLike> {
  const request = (DeviceMotionEvent as any)?.requestPermission
  if (!request) return 'unsupported'
  try {
    const state = await request.call(DeviceMotionEvent)
    return state === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

