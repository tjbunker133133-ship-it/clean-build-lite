import { useEffect, useState } from 'react'
import { getRuntimeSnapshot, subscribeRuntimeSnapshot } from './runtimeSnapshot'

const DISMISS_KEY = 'hud_offline_readiness_banner_dismiss_v1'

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function OfflineReadinessBanner() {
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(readDismissed)

  useEffect(() => {
    const apply = () => {
      const snap = getRuntimeSnapshot()
      const m = snap.offlineReadiness.bannerMessage
      setMessage(m)
      setVisible(Boolean(m) && !dismissed)
    }
    apply()
    return subscribeRuntimeSnapshot(apply)
  }, [dismissed])

  if (!visible || !message) return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2147483640,
        padding: '10px 12px',
        fontSize: 13,
        lineHeight: 1.35,
        color: 'rgba(255,245,220,0.96)',
        background: 'rgba(35,28,12,0.94)',
        borderBottom: '1px solid rgba(255,193,90,0.55)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      <button
        type="button"
        onClick={() => {
          writeDismissed()
          setDismissed(true)
          setVisible(false)
        }}
        style={{
          flexShrink: 0,
          border: '1px solid rgba(255,193,90,0.45)',
          background: 'rgba(0,0,0,0.25)',
          color: 'rgba(255,245,220,0.95)',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 12,
        }}
      >
        Dismiss
      </button>
    </div>
  )
}
