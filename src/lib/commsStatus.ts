export type CommsStatusState = 'pass' | 'warn' | 'idle'

export type CommsStatusLine = {
  key: 'profile' | 'rescue' | 'push' | 'mission'
  label: string
  state: CommsStatusState
  detail: string
}

export function buildCommsStatus(args: {
  operationalReady: boolean
  contactCount: number
  rescueEndpointReady: boolean
  pushAlertsReady: boolean
  pushSubscriberCount?: number | null
  missionRole: 'idle' | 'member' | 'observer'
  monitorLive: boolean
  observerWaiting?: boolean
}): CommsStatusLine[] {
  const profile: CommsStatusLine = args.operationalReady
    ? {
        key: 'profile',
        label: 'Profile',
        state: 'pass',
        detail: `${args.contactCount} contact(s) · alerts enabled`,
      }
    : {
        key: 'profile',
        label: 'Profile',
        state: 'warn',
        detail: 'SOS / Deadman / Check-In disabled until Preflight complete',
      }

  const rescue: CommsStatusLine = args.rescueEndpointReady
    ? {
        key: 'rescue',
        label: 'Rescue email',
        state: 'pass',
        detail: 'send-rescue-email configured',
      }
    : {
        key: 'rescue',
        label: 'Rescue email',
        state: 'warn',
        detail: 'Endpoint missing — email alerts unavailable',
      }

  const push: CommsStatusLine = args.pushAlertsReady
    ? {
        key: 'push',
        label: 'Push alerts',
        state: 'pass',
        detail:
          typeof args.pushSubscriberCount === 'number'
            ? `${args.pushSubscriberCount} contact device(s) subscribed`
            : 'Share invite from Preflight',
      }
    : {
        key: 'push',
        label: 'Push alerts',
        state: 'warn',
        detail: 'VAPID key missing — email only until push configured',
      }

  let mission: CommsStatusLine
  if (args.missionRole === 'observer') {
    if (args.monitorLive) {
      mission = { key: 'mission', label: 'Mission link', state: 'pass', detail: 'Monitoring live on map' }
    } else if (args.observerWaiting) {
      mission = {
        key: 'mission',
        label: 'Mission link',
        state: 'idle',
        detail: 'Waiting for field lead monitor link',
      }
    } else {
      mission = { key: 'mission', label: 'Mission link', state: 'idle', detail: 'Monitor reconnecting…' }
    }
  } else if (args.missionRole === 'member') {
    mission = { key: 'mission', label: 'Mission link', state: 'pass', detail: 'Field mission active' }
  } else {
    mission = { key: 'mission', label: 'Mission link', state: 'idle', detail: 'Not linked' }
  }

  return [profile, rescue, push, mission]
}

export function commsStatusColor(state: CommsStatusState): string {
  if (state === 'pass') return '#7dff8a'
  if (state === 'warn') return '#ffd166'
  return '#94a3b8'
}
