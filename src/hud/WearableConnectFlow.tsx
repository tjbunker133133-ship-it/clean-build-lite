import { type CSSProperties } from 'react'
import {
  CONNECT_WEARABLE_ERROR_LABEL,
  CONNECT_WEARABLE_SEARCH_LABEL,
  type ConnectWearableReadyCard,
  type ConnectWearableUiPhase,
} from '../lib/wearables/wal/walDeviceConnect'

type Props = {
  phase: ConnectWearableUiPhase
  card: ConnectWearableReadyCard | null
  fontSm: number
  gapSm: number
  tapMin: number
  onConnect: () => void
  onDismiss: () => void
  onRetry: () => void
  busy: boolean
}

const cardShell: CSSProperties = {
  padding: '14px 12px',
  borderRadius: 10,
  border: '1px solid rgba(125,255,138,0.28)',
  background: 'rgba(6, 14, 10, 0.88)',
  display: 'grid',
  gap: 10,
}

export default function WearableConnectFlow({
  phase,
  card,
  fontSm,
  gapSm,
  tapMin,
  onConnect,
  onDismiss,
  onRetry,
  busy,
}: Props) {
  const btn: CSSProperties = {
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid rgba(125,255,138,0.35)',
    background: 'rgba(8, 24, 14, 0.5)',
    color: '#c7cec6',
    fontSize: fontSm,
    fontWeight: 700,
    cursor: 'pointer',
    minHeight: tapMin,
    letterSpacing: '0.06em',
  }

  if (phase === 'idle') {
    return (
      <button type="button" style={btn} disabled={busy} onClick={onConnect}>
        Connect Wearable
      </button>
    )
  }

  if (phase === 'searching') {
    return (
      <div style={cardShell}>
        <p style={{ margin: 0, fontSize: fontSm, color: '#c7cec6', fontWeight: 700 }}>
          {CONNECT_WEARABLE_SEARCH_LABEL}
        </p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div style={{ ...cardShell, borderColor: 'rgba(255,154,172,0.35)' }}>
        <p style={{ margin: 0, fontSize: fontSm, color: '#e2e8e2', lineHeight: 1.45 }}>
          {CONNECT_WEARABLE_ERROR_LABEL}
        </p>
        <button type="button" style={btn} disabled={busy} onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }

  if ((phase === 'ready' || phase === 'partial') && card) {
    return (
      <div style={cardShell}>
        <p style={{ margin: 0, fontSize: fontSm, color: '#7dff8a', fontWeight: 800, letterSpacing: '0.06em' }}>
          {card.title}
        </p>
        <div style={{ display: 'grid', gap: gapSm, fontSize: fontSm }}>
          <Row label="Watch" value={card.watchLine} />
          <Row label="Signals" value={card.signalsLine} />
          <Row label="Notifications" value={card.notificationsLine} />
        </div>
        <button type="button" style={btn} disabled={busy} onClick={onDismiss}>
          {card.primaryButton}
        </button>
      </div>
    )
  }

  return null
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: '#9ea7a0' }}>{label}</span>
      <span style={{ color: '#c7cec6', fontWeight: 700 }}>{value}</span>
    </div>
  )
}
