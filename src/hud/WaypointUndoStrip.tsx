import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchMinTarget } from './tokens'
import { useAppContext } from '../context/AppContext'

/** Bottom strip after a waypoint delete — one-handed undo. */
export default function WaypointUndoStrip() {
  const {
    waypointDeletionUndo,
    restoreWaypointDeletionUndo,
    dismissWaypointDeletionUndo,
  } = useAppContext()
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const tap = Math.max(touchMinTarget(isMobile), 48)
  const fontSm = touchFontSm(isMobile)

  if (!waypointDeletionUndo) return null

  const label = waypointDeletionUndo.waypoint.label || 'Waypoint'

  return (
    <div
      style={{
        position: 'fixed',
        left: 8,
        right: 8,
        bottom: 12,
        zIndex: 20000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 12,
        background: 'rgba(8,14,22,0.94)',
        border: '1px solid rgba(148,163,184,0.45)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ fontSize: fontSm, color: '#e2e8f0', lineHeight: 1.35, flex: 1, minWidth: 0 }}>
        Removed “{label.slice(0, 28)}
        {label.length > 28 ? '…' : ''}”
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={dismissWaypointDeletionUndo}
          style={{
            minHeight: tap,
            minWidth: tap,
            padding: '0 14px',
            borderRadius: 10,
            border: '1px solid rgba(148,163,184,0.4)',
            background: 'rgba(30,41,59,0.5)',
            color: '#cbd5e1',
            fontWeight: 700,
            letterSpacing: '0.06em',
            fontSize: fontSm,
            cursor: 'pointer',
          }}
        >
          DISMISS
        </button>
        <button
          type="button"
          onClick={restoreWaypointDeletionUndo}
          style={{
            minHeight: tap,
            minWidth: tap,
            padding: '0 18px',
            borderRadius: 10,
            border: '1px solid rgba(52,211,153,0.65)',
            background: 'rgba(6,78,59,0.45)',
            color: '#bbf7d0',
            fontWeight: 800,
            letterSpacing: '0.08em',
            fontSize: fontSm,
            cursor: 'pointer',
          }}
        >
          UNDO
        </button>
      </div>
    </div>
  )
}
