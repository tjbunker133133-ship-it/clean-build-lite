import { useEffect, useRef, useState } from 'react'
import { useMissionSync } from '../context/MissionSyncContext'
import {
  clearPendingMonitorJoin,
  readPendingMonitorJoin,
  stripWatchMeParamsFromUrl,
} from '../lib/missionSync/pendingMonitorJoin'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchFontMd, touchMinTarget } from './tokens'

/**
 * When someone opens a "watch me" link, connect as observer without paste fields.
 */
export default function MonitorJoinBootstrap() {
  const sync = useMissionSync()
  const [status, setStatus] = useState<string | null>(() =>
    readPendingMonitorJoin() ? 'Opening live map…' : null,
  )
  const startedRef = useRef(false)
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const fontMd = touchFontMd(isMobile)
  const tapMin = touchMinTarget(isMobile)

  useEffect(() => {
    stripWatchMeParamsFromUrl()
  }, [])

  useEffect(() => {
    const pending = readPendingMonitorJoin()
    if (!pending || startedRef.current) return
    startedRef.current = true

    const run = async () => {
      try {
        if (pending.kind === 'bundle') {
          setStatus('Connecting to live map…')
          await sync.monitorMissionFromOffer(pending.encoded)
        } else {
          setStatus('Waiting for GPS from the field…')
          await sync.monitorMissionFromToken(
            pending.missionId,
            pending.token,
            pending.missionName,
          )
        }
        clearPendingMonitorJoin()
        setStatus('Live map connected — check your map view.')
        window.setTimeout(() => setStatus(null), 4500)
      } catch {
        setStatus('Could not connect — open Mission Link and try the link again.')
      }
    }

    void run()
  }, [sync])

  if (!status) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
        transform: 'translateX(-50%)',
        zIndex: 11000,
        width: 'min(360px, calc(100vw - 24px))',
        padding: '12px 14px',
        borderRadius: 10,
        border: '1px solid rgba(125,255,138,0.45)',
        background: 'rgba(6, 12, 10, 0.94)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ fontSize: fontMd, fontWeight: 800, color: '#7dff8a', letterSpacing: '0.06em' }}>
        LIVE MAP INVITE
      </div>
      <p style={{ margin: 0, fontSize: fontSm, lineHeight: 1.45, color: '#d8e3d8' }}>{status}</p>
      <button
        type="button"
        onClick={() => {
          clearPendingMonitorJoin()
          setStatus(null)
        }}
        style={{
          minHeight: tapMin,
          border: 'none',
          background: 'transparent',
          color: '#94a3b8',
          fontSize: fontSm,
          cursor: 'pointer',
          justifySelf: 'start',
        }}
      >
        Dismiss
      </button>
    </div>
  )
}
