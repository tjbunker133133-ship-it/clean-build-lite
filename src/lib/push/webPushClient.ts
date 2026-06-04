import { buildRescueDispatchHeaders } from '../rescue/rescueDispatch'
import {
  isWebPushConfigured,
  readVapidPublicKey,
  resolveRegisterAlertPushEndpoint,
} from './webPushConfig'
import { isValidAlertWatchToken, normalizeContactEmail } from './alertWatchToken'

export type PushSubscriptionWire = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function subscriptionToWire(sub: PushSubscription): PushSubscriptionWire | null {
  const json = sub.toJSON()
  const endpoint = json.endpoint
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!endpoint || !p256dh || !auth) return null
  return { endpoint, keys: { p256dh, auth } }
}

export async function subscribeToWebPush(): Promise<PushSubscription | null> {
  if (!isWebPushSupported() || !isWebPushConfigured()) return null
  const vapid = readVapidPublicKey()
  if (!vapid) return null

  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  if (existing) return existing

  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
  })
}

export async function registerAlertPushSubscription(args: {
  watchToken: string
  contactEmail: string
  subscription: PushSubscriptionWire
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const endpoint = resolveRegisterAlertPushEndpoint()
  if (!endpoint) return { ok: false, message: 'Push registration endpoint not configured.' }
  if (!isValidAlertWatchToken(args.watchToken)) {
    return { ok: false, message: 'Invalid alert watch token.' }
  }
  const email = normalizeContactEmail(args.contactEmail)
  if (!email.includes('@')) return { ok: false, message: 'Valid contact email required.' }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: buildRescueDispatchHeaders(),
      body: JSON.stringify({
        watchToken: args.watchToken.trim(),
        contactEmail: email,
        subscription: args.subscription,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 240) : '',
      }),
    })
    if (res.ok) return { ok: true }
    let message = `Registration failed (${res.status})`
    try {
      const body = (await res.json()) as { message?: string; error?: string }
      message = body.message ?? body.error ?? message
    } catch {
      /* ignore */
    }
    return { ok: false, message }
  } catch {
    return { ok: false, message: 'Network error during push registration.' }
  }
}

export async function ensureAlertPushSubscription(args: {
  watchToken: string
  contactEmail: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isWebPushSupported()) {
    return { ok: false, message: 'Push notifications are not supported on this browser.' }
  }
  if (!isWebPushConfigured()) {
    return { ok: false, message: 'Push alerts are not configured for this build.' }
  }
  const perm =
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
      ? 'granted'
      : typeof Notification !== 'undefined'
        ? await Notification.requestPermission()
        : 'denied'
  if (perm !== 'granted') {
    return { ok: false, message: 'Notification permission denied.' }
  }
  const sub = await subscribeToWebPush()
  if (!sub) return { ok: false, message: 'Could not create push subscription.' }
  const wire = subscriptionToWire(sub)
  if (!wire) return { ok: false, message: 'Invalid push subscription keys.' }
  return registerAlertPushSubscription({
    watchToken: args.watchToken,
    contactEmail: args.contactEmail,
    subscription: wire,
  })
}

export async function countAlertPushSubscribers(watchToken: string): Promise<number | null> {
  if (!isValidAlertWatchToken(watchToken)) return null
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const url = (
      import.meta as unknown as { env?: Record<string, string | undefined> }
    ).env?.VITE_SUPABASE_URL?.trim()
    const key = (
      import.meta as unknown as { env?: Record<string, string | undefined> }
    ).env?.VITE_SUPABASE_ANON_KEY?.trim()
    if (!url || !key) return null
    const client = createClient(url, key)
    const { count, error } = await client
      .from('alert_push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('watch_token', watchToken)
    if (error) return null
    return count ?? 0
  } catch {
    return null
  }
}
