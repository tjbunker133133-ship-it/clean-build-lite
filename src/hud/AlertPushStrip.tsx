import { useCallback, useEffect, useState } from 'react'
import { loadOrCreateAlertWatchToken } from '../lib/push/alertWatchToken'
import { buildAlertSubscribeUrl } from '../lib/push/alertSubscribeUrl'
import { shareAlertInvite } from '../lib/push/shareAlertInvite'
import { countAlertPushSubscribers, isWebPushSupported } from '../lib/push/webPushClient'
import { isWebPushConfigured } from '../lib/push/webPushConfig'
import { useTacticalProfile } from '../hooks/useTacticalProfile'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchMinTarget } from './tokens'

type Props = {
  compact?: boolean
}

export default function AlertPushStrip({ compact = false }: Props) {
  const { profile } = useTacticalProfile()
  const watchToken = loadOrCreateAlertWatchToken()
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const tapMin = touchMinTarget(isMobile)
  const pushConfigured = isWebPushConfigured()
  const pushSupported = isWebPushSupported()

  const refreshCount = useCallback(async () => {
    const count = await countAlertPushSubscribers(watchToken)
    setSubscriberCount(count)
  }, [watchToken])

  useEffect(() => {
    void refreshCount()
  }, [refreshCount])

  const shareInvite = async (contactEmail?: string) => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await shareAlertInvite({
        operatorName: profile.display_name,
        watchToken,
        contactEmail,
      })
      if (result === 'shared') setNotice('Invite shared.')
      else if (result === 'copied') setNotice('Invite copied — send to your contact.')
      else setNotice('Could not share invite.')
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    const link = buildAlertSubscribeUrl(watchToken)
    try {
      await navigator.clipboard.writeText(link)
      setNotice('Subscribe link copied.')
    } catch {
      setNotice('Copy failed.')
    }
  }

  return (
    <div
      style={{
        padding: compact ? '8px 10px' : '10px 12px',
        borderRadius: 8,
        border: '1px solid rgba(125,255,138,0.28)',
        background: 'rgba(8, 24, 14, 0.45)',
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ fontSize: fontSm, fontWeight: 800, letterSpacing: '0.08em', color: '#7dff8a' }}>
        PUSH ALERTS (replaces SMS for now)
      </div>
      <div style={{ fontSize: fontSm, color: '#b8c4b8', lineHeight: 1.45 }}>
        Contacts install/open Signal One HUD on any device, allow notifications, and confirm their email.
        Works across HUD builds sharing this Supabase project.
      </div>
      <div style={{ fontSize: fontSm, color: '#94a3b8' }}>
        Status:{' '}
        <span style={{ color: pushConfigured && pushSupported ? '#7dff8a' : '#ffd166' }}>
          {pushConfigured
            ? pushSupported
              ? 'Ready — share invite below'
              : 'Browser does not support push'
            : 'Add VITE_VAPID_PUBLIC_KEY to enable'}
        </span>
        {subscriberCount != null && (
          <span style={{ marginLeft: 8 }}>· {subscriberCount} device(s) subscribed</span>
        )}
      </div>
      {!compact && (
        <div style={{ fontSize: fontSm, fontFamily: 'var(--font-mono, monospace)', color: '#64748b' }}>
          Watch token: {watchToken.slice(0, 6)}…{watchToken.slice(-4)}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          data-no-drag
          disabled={busy || !pushConfigured}
          onClick={() => void shareInvite()}
          style={{
            minHeight: tapMin,
            borderRadius: 8,
            border: '1px solid rgba(125,255,138,0.45)',
            background: 'rgba(125,255,138,0.12)',
            color: '#d8f8dd',
            fontSize: fontSm,
            fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer',
            padding: '0 12px',
          }}
        >
          SHARE PUSH INVITE
        </button>
        <button
          type="button"
          data-no-drag
          disabled={!pushConfigured}
          onClick={() => void copyLink()}
          style={{
            minHeight: tapMin,
            borderRadius: 8,
            border: '1px solid rgba(199,206,198,0.35)',
            background: 'rgba(199,206,198,0.08)',
            color: '#d8e3d8',
            fontSize: fontSm,
            fontWeight: 700,
            cursor: 'pointer',
            padding: '0 12px',
          }}
        >
          COPY LINK
        </button>
        <button
          type="button"
          data-no-drag
          onClick={() => void refreshCount()}
          style={{
            minHeight: tapMin,
            borderRadius: 8,
            border: '1px solid rgba(199,206,198,0.25)',
            background: 'transparent',
            color: '#94a3b8',
            fontSize: fontSm,
            cursor: 'pointer',
            padding: '0 10px',
          }}
        >
          REFRESH
        </button>
      </div>
      {profile.contacts.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          {profile.contacts.slice(0, 4).map((c) => (
            <button
              key={c.id}
              type="button"
              data-no-drag
              disabled={busy || !pushConfigured}
              onClick={() => void shareInvite(c.email)}
              style={{
                minHeight: tapMin,
                textAlign: 'left',
                borderRadius: 6,
                border: '1px solid rgba(199,206,198,0.2)',
                background: 'rgba(10,12,13,0.5)',
                color: '#cbd5e1',
                fontSize: fontSm,
                cursor: busy ? 'wait' : 'pointer',
                padding: '6px 10px',
              }}
            >
              Invite {c.name || c.email} · push link
            </button>
          ))}
        </div>
      )}
      {notice && <div style={{ fontSize: fontSm, color: '#7dff8a' }}>{notice}</div>}
    </div>
  )
}
