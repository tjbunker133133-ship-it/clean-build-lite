import { useEffect, useState } from 'react'
import { ensureAlertPushSubscription } from '../lib/push/webPushClient'
import {
  clearPendingAlertSubscribe,
  isWizardCompletedPersisted,
  readPendingAlertSubscribe,
} from '../lib/push/pendingAlertSubscribe'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchFontMd, touchMinTarget } from './tokens'

export default function AlertWatchBootstrap() {
  const [pending, setPending] = useState(() => readPendingAlertSubscribe())
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const fontMd = touchFontMd(isMobile)
  const tapMin = touchMinTarget(isMobile)

  useEffect(() => {
    const p = readPendingAlertSubscribe()
    if (!p) return
    setPending(p)
    if (p.contactEmail) setEmail(p.contactEmail)

    const url = new URL(window.location.href)
    if (url.searchParams.has('alertWatch') || url.searchParams.has('email')) {
      url.searchParams.delete('alertWatch')
      url.searchParams.delete('email')
      const next = `${url.pathname}${url.search}${url.hash}`
      window.history.replaceState({}, '', next)
    }
  }, [])

  if (!pending) return null
  if (!isWizardCompletedPersisted()) return null

  const subscribe = async () => {
    setBusy(true)
    setStatus(null)
    const result = await ensureAlertPushSubscription({
      watchToken: pending.watchToken,
      contactEmail: email,
    })
    setBusy(false)
    if (result.ok) {
      clearPendingAlertSubscribe()
      setStatus('Push alerts enabled on this device. You can close this panel.')
      setPending(null)
    } else {
      setStatus(result.message)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 12000,
        background: 'rgba(4, 8, 10, 0.82)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          borderRadius: 12,
          border: '1px solid rgba(125,255,138,0.45)',
          background: 'rgba(8, 12, 14, 0.96)',
          color: '#d8e3d8',
          padding: 16,
          display: 'grid',
          gap: 12,
        }}
      >
        <div style={{ fontSize: fontMd, fontWeight: 800, color: '#7dff8a' }}>Enable push alerts</div>
        <p style={{ margin: 0, fontSize: fontSm, lineHeight: 1.45, color: '#b8c4b8' }}>
          Confirm the email your teammate listed for you, then allow notifications. This works on any
          Signal One HUD install (installed app or browser).
        </p>
        <label style={{ display: 'grid', gap: 4, fontSize: fontSm }}>
          Your email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="contact@example.com"
            style={{
              minHeight: tapMin,
              borderRadius: 8,
              border: '1px solid rgba(199,206,198,0.35)',
              background: 'rgba(10,12,12,0.85)',
              color: '#e2e8e2',
              padding: '0 10px',
              fontSize: fontMd,
            }}
          />
        </label>
        <button
          type="button"
          disabled={busy || !email.includes('@')}
          onClick={() => void subscribe()}
          style={{
            minHeight: tapMin,
            borderRadius: 8,
            border: '1px solid rgba(125,255,138,0.55)',
            background: 'rgba(125,255,138,0.16)',
            color: '#d8f8dd',
            fontWeight: 700,
            fontSize: fontSm,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'ENABLING…' : 'ENABLE PUSH ALERTS'}
        </button>
        {status && (
          <div style={{ fontSize: fontSm, color: status.includes('enabled') ? '#7dff8a' : '#ffd166' }}>
            {status}
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            clearPendingAlertSubscribe()
            setPending(null)
          }}
          style={{
            minHeight: tapMin,
            border: 'none',
            background: 'transparent',
            color: '#94a3b8',
            fontSize: fontSm,
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
