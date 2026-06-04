/**
 * WAL output channel projections — state machine is source of truth.
 * Channels render; they do not decide escalation.
 */

import type { EscalationProjection, EscalationSnapshot, OutputChannelKind } from './types'
import type { WalPresetConfig } from './userPresets'

export type OutputChannel = {
  kind: OutputChannelKind
  /** Project escalation state to this channel (phone UI, watch notification, etc.) */
  project(projection: EscalationProjection): Promise<void>
}

export function buildEscalationProjection(
  snapshot: EscalationSnapshot,
  preset: WalPresetConfig,
): EscalationProjection | null {
  if (preset.notificationVerbosity === 'none' && snapshot.state === 'risk_detected') {
    return null
  }

  const channels: OutputChannelKind[] = ['phone']
  if (preset.notificationVerbosity !== 'none') {
    channels.push('watch_notification')
  }

  switch (snapshot.state) {
    case 'risk_detected':
      return {
        state: snapshot.state,
        title: 'Companion risk signal',
        body: 'Advisory signal detected — monitoring. No emergency dispatch.',
        urgency: 'info',
        channels: ['phone'],
      }
    case 'escalation_pending': {
      const sec =
        snapshot.timerRemainingMs != null ? Math.ceil(snapshot.timerRemainingMs / 1000) : '?'
      return {
        state: snapshot.state,
        title: 'Escalation pending',
        body: `Possible emergency — cancel or confirm SOS. Auto-escalation in ${sec}s if no response.`,
        urgency: 'critical',
        channels,
      }
    }
    case 'user_cancelled':
      return {
        state: snapshot.state,
        title: 'Escalation cancelled',
        body: 'Emergency escalation cancelled by operator.',
        urgency: 'info',
        channels: ['phone'],
      }
    case 'escalation_confirmed':
      return {
        state: snapshot.state,
        title: 'Escalation confirmed',
        body: 'SOS dispatch authorized by timer or operator confirm.',
        urgency: 'critical',
        channels,
      }
    case 'sos_dispatched':
      return {
        state: snapshot.state,
        title: 'SOS dispatch complete',
        body: 'Rescue pipeline invoked — returning to normal monitoring.',
        urgency: 'warn',
        channels: ['phone'],
      }
    default:
      return null
  }
}

/** Phone notification via existing companion path — NOT SOS tag. */
export const WAL_ESCALATION_NOTIFICATION_TAG = 'signal-one-wal-escalation'

export async function projectToWatchNotification(projection: EscalationProjection): Promise<void> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  const payload = {
    title: projection.title,
    body: projection.body,
    tag: WAL_ESCALATION_NOTIFICATION_TAG,
    renotify: projection.urgency === 'critical',
  }
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification(payload.title, {
        body: payload.body,
        tag: payload.tag,
        icon: '/hud-icon-192.png',
      })
      return
    }
  } catch {
    /* fallback */
  }
  try {
    new Notification(payload.title, { body: payload.body, tag: payload.tag })
  } catch {
    /* ignore */
  }
}

export function createDefaultOutputChannels(): OutputChannel[] {
  return [
    {
      kind: 'phone',
      project: async (p) => {
        if (p.channels.includes('watch_notification')) {
          await projectToWatchNotification(p)
        }
      },
    },
    {
      kind: 'watch_notification',
      project: async (p) => {
        await projectToWatchNotification(p)
      },
    },
  ]
}
