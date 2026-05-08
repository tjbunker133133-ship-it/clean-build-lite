import { useEffect, useState } from 'react'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchGapMd, touchMinTarget } from './tokens'

type SwUpdateEventDetail = {
  activate?: () => void
}

export default function SwUpdateBanner() {
  const [activate, setActivate] = useState<null | (() => void)>(null)

  useEffect(() => {
    const onNeedRefresh = (event: Event) => {
      const custom = event as CustomEvent<SwUpdateEventDetail>
      setActivate(() => custom.detail?.activate ?? null)
    }
    window.addEventListener('hud:sw-update', onNeedRefresh as EventListener)
    return () => {
      window.removeEventListener('hud:sw-update', onNeedRefresh as EventListener)
    }
  }, [])

  if (!activate) return null

  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const gapMd = touchGapMd(isMobile)
  const tapMin = touchMinTarget(isMobile)

  return (
    <div
      style={{
        position: 'fixed',
        top: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100005,
        borderRadius: 10,
        border: '1px solid rgba(125,255,138,0.5)',
        background: 'rgba(10,16,12,0.92)',
        color: '#d7f6de',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: gapMd,
        fontSize: fontSm,
        letterSpacing: '0.06em',
      }}
    >
      <span>UPDATE READY</span>
      <button
        type="button"
        onClick={() => activate()}
        style={{
          minHeight: tapMin,
          borderRadius: 8,
          border: '1px solid rgba(125,255,138,0.55)',
          background: 'rgba(125,255,138,0.18)',
          color: '#e7ffe9',
          fontWeight: 700,
          fontSize: fontSm,
          padding: '0 14px',
          cursor: 'pointer',
        }}
      >
        RELOAD
      </button>
    </div>
  )
}

