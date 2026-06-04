import { useEffect, useState } from 'react'
import { buildCommsStatus, commsStatusColor } from '../lib/commsStatus'
import { useMissionSync } from '../context/MissionSyncContext'
import { useTacticalProfile } from '../hooks/useTacticalProfile'
import { resolveRapidEndpoint } from '../lib/rescue/resolveRapidEndpoint'
import { isWebPushConfigured } from '../lib/push/webPushConfig'
import { countAlertPushSubscribers } from '../lib/push/webPushClient'
import { loadOrCreateAlertWatchToken } from '../lib/push/alertWatchToken'
import { touchFontSm } from './tokens'
import { getDeviceProfile } from '../runtime/deviceProfile'

type Props = {
  observerWaiting?: boolean
}

export default function CommsStatusStrip({ observerWaiting = false }: Props) {
  const { assessment, operationalReady } = useTacticalProfile()
  const sync = useMissionSync()
  const fontSm = touchFontSm(getDeviceProfile().interactionMode === 'mobile')
  const endpoint = resolveRapidEndpoint()
  const waiting =
    observerWaiting ||
    (sync.role === 'observer' && sync.phase === 'connecting' && !sync.monitorLive)
  const [pushSubscriberCount, setPushSubscriberCount] = useState<number | null>(null)

  useEffect(() => {
    if (!isWebPushConfigured()) return
    const token = loadOrCreateAlertWatchToken()
    void countAlertPushSubscribers(token).then(setPushSubscriberCount)
  }, [])

  const lines = buildCommsStatus({
    operationalReady,
    contactCount: assessment.validContactCount,
    rescueEndpointReady: Boolean(endpoint?.trim()),
    pushAlertsReady: isWebPushConfigured(),
    pushSubscriberCount,
    missionRole: sync.role,
    monitorLive: sync.monitorLive,
    observerWaiting: waiting,
  })

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid rgba(94, 234, 212, 0.25)',
        background: 'rgba(4, 48, 42, 0.35)',
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={{ fontSize: fontSm, fontWeight: 800, letterSpacing: '0.08em', color: '#5eead4' }}>
        COMMS
      </div>
      {lines.map((line) => (
        <div
          key={line.key}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            fontSize: fontSm,
            lineHeight: 1.35,
          }}
        >
          <span style={{ color: commsStatusColor(line.state), fontWeight: 700 }}>{line.label}</span>
          <span style={{ color: '#94a3b8', textAlign: 'right' }}>{line.detail}</span>
        </div>
      ))}
    </div>
  )
}
