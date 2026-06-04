/**
 * Companion device test alerts — phone notification only (may mirror to watch).
 * Does not trigger SOS, deadman, or rescue dispatch.
 */

const TEST_TAG = 'signal-one-wearables-test'

export async function sendCompanionTestNotification(): Promise<{
  ok: boolean
  message: string
}> {
  if (typeof window === 'undefined') {
    return { ok: false, message: 'Notifications unavailable in this environment.' }
  }
  if (typeof Notification === 'undefined') {
    return { ok: false, message: 'This browser does not support notifications.' }
  }
  if (Notification.permission === 'denied') {
    return { ok: false, message: 'Notifications blocked — enable in system settings for this app.' }
  }
  if (Notification.permission !== 'granted') {
    return { ok: false, message: 'Allow notifications first (button above).' }
  }

  const payload = {
    title: 'Signal One HUD — companion test',
    body: 'If this appears on your watch, phone → watch alerts are working. Not an emergency.',
    icon: '/hud-icon-192.png',
    badge: '/hud-icon-192.png',
    tag: TEST_TAG,
    renotify: true,
  }

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification(payload.title, {
        body: payload.body,
        icon: payload.icon,
        badge: payload.badge,
        tag: payload.tag,
      })
      return {
        ok: true,
        message: 'Test alert sent. Check your phone — paired watches usually mirror within a few seconds.',
      }
    }
  } catch {
    /* fall through to Notification API */
  }

  try {
    new Notification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      tag: payload.tag,
    })
    return { ok: true, message: 'Test alert sent on this device.' }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Could not show test notification.',
    }
  }
}
