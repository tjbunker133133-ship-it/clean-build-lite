import { sanitizeBurstText } from './comms'

const TEAM_MESSAGE_TAG = 'signal-one-team-message'

/** System notification when foreground TTS is gated (background / low-light). May mirror to watch via OS. */
export async function showInboundTeamMessageNotification(
  callsign: string,
  text: string,
  opts?: { pendingConfirm?: boolean },
): Promise<void> {
  if (typeof window === 'undefined') return
  if (typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return

  const body = sanitizeBurstText(text)
  if (!body) return

  const who = callsign.trim() || 'Teammate'
  const title = opts?.pendingConfirm ? `Message from ${who}` : `${who} — team message`
  const notifyBody = opts?.pendingConfirm
    ? `${body.slice(0, 96)} — open HUD to listen`
    : body.slice(0, 120)

  const icon = '/hud-icon-192.png'
  const options: NotificationOptions = {
    body: notifyBody,
    icon,
    badge: icon,
    tag: TEAM_MESSAGE_TAG,
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification(title, options)
      return
    }
  } catch {
    /* fall through */
  }

  try {
    new Notification(title, options)
  } catch {
    /* optional */
  }
}
