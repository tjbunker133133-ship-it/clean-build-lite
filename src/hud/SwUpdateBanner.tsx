import { useEffect, useRef, useState } from 'react'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { SW_DEFERRED_RELOAD_KEY } from '../runtime/forceUpdateMeta'
import { subscribeRuntimeSnapshot, updatePendingSwUpdate } from '../runtime/runtimeSnapshot'
import { touchFontSm, touchGapMd, touchMinTarget } from './tokens'

type SwUpdateEventDetail = {
  activate?: () => void
}

/** Idle / probe → ready = update available → operator reload (reloading is transient). */
type BannerPhase = 'idle' | 'checking' | 'ready' | 'up_to_date' | 'reloading'

export default function SwUpdateBanner() {
  const [activate, setActivate] = useState<null | (() => void)>(null)
  const [phase, setPhase] = useState<BannerPhase>('idle')
  const [operatorMsg, setOperatorMsg] = useState<string | null>(null)
  const [swDeferredHint, setSwDeferredHint] = useState<string | null>(null)
  const [deployStaleHint, setDeployStaleHint] = useState<string | null>(null)
  const waitingBannerRef = useRef(false)
  const reloadingRef = useRef(false)

  useEffect(() => {
    const onNeedRefresh = (event: Event) => {
      const custom = event as CustomEvent<SwUpdateEventDetail>
      setActivate(() => custom.detail?.activate ?? null)
      if (!reloadingRef.current) setPhase('ready')
    }
    window.addEventListener('hud:sw-update', onNeedRefresh as EventListener)
    const onOpReload = (event: Event) => {
      const d = (event as CustomEvent<{ message?: string }>).detail
      setOperatorMsg(d?.message ?? 'Reloading…')
      window.setTimeout(() => setOperatorMsg(null), 5000)
    }
    window.addEventListener('hud:operator-reload-notify', onOpReload as EventListener)
    return () => {
      window.removeEventListener('hud:sw-update', onNeedRefresh as EventListener)
      window.removeEventListener('hud:operator-reload-notify', onOpReload as EventListener)
    }
  }, [])

  useEffect(() => {
    const readDeferred = () => {
      try {
        setSwDeferredHint(
          sessionStorage.getItem(SW_DEFERRED_RELOAD_KEY) === '1'
            ? 'New version ready — reload was deferred during voice or setup. Tap RELOAD APP when safe.'
            : null,
        )
      } catch {
        setSwDeferredHint(null)
      }
    }
    readDeferred()
    window.addEventListener('focus', readDeferred)
    document.addEventListener('visibilitychange', readDeferred)
    return () => {
      window.removeEventListener('focus', readDeferred)
      document.removeEventListener('visibilitychange', readDeferred)
    }
  }, [])

  useEffect(() => {
    return subscribeRuntimeSnapshot((snap) => {
      if (reloadingRef.current) return

      const di = snap.deploymentIntegrity
      if (di.reloadAttempted && di.staleStatus === 'stale_detected' && !di.recoveryInFlight) {
        setDeployStaleHint(
          'Automatic stale recovery already ran once this session. If the app still looks wrong, tap RELOAD APP.',
        )
      } else {
        setDeployStaleHint(null)
      }

      const sw = snap.serviceWorker
      const pending = snap.runtimeContinuity.pendingSWUpdate
      if (pending || sw.needsRefresh) {
        setPhase('ready')
        return
      }
      if (sw.status === 'installing' || sw.status === 'installed') {
        setPhase('checking')
        return
      }
      if (sw.status === 'activated' || sw.status === 'controlling') {
        setPhase('up_to_date')
        return
      }
      setPhase('idle')
    })
  }, [])

  /** Fallback when `onNeedRefresh` does not fire: detect a waiting service worker. */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const poll = () => {
      if (reloadingRef.current) return
      void navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg?.waiting) {
          waitingBannerRef.current = false
          return
        }
        if (waitingBannerRef.current) return
        waitingBannerRef.current = true
        updatePendingSwUpdate(true)
        setPhase('ready')
        const fn = () => {
          try {
            reg.waiting?.postMessage({ type: 'SKIP_WAITING' })
          } catch {
            /* ignore */
          }
          window.location.reload()
        }
        setActivate(() => fn)
      })
    }
    poll()
    const id = window.setInterval(poll, 45_000)
    return () => window.clearInterval(id)
  }, [])

  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const gapMd = touchGapMd(isMobile)
  const tapMin = touchMinTarget(isMobile)

  const isSupabaseConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
  const supabaseStatusText = isSupabaseConfigured ? 'CONNECTED' : 'BACKEND OFFLINE'

  const invokeReload = (fn: () => void) => {
    try {
      window.dispatchEvent(
        new CustomEvent('hud:operator-reload-notify', {
          detail: { message: 'Reloading app…' },
        }),
      )
    } catch {
      /* ignore */
    }
    reloadingRef.current = true
    setPhase('reloading')
    fn()
  }

  const primaryActivate = activate ?? (() => window.location.reload())

  const showPrimaryStrip = phase === 'ready' || phase === 'reloading'

  const phaseLabel =
    phase === 'reloading'
      ? 'RELOADING…'
      : phase === 'ready'
        ? 'UPDATE READY'
        : phase === 'checking'
          ? 'CHECKING FOR UPDATE…'
          : phase === 'up_to_date'
            ? 'APP UP TO DATE'
            : 'SERVICE WORKER IDLE'

  const recoveryText = swDeferredHint ?? deployStaleHint

  return (
    <>
      {operatorMsg && (
        <div
          role="status"
          style={{
            position: 'fixed',
            top: 52,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100006,
            borderRadius: 8,
            border: '1px solid rgba(255,200,120,0.5)',
            background: 'rgba(40,28,10,0.92)',
            color: '#ffe8cc',
            padding: '8px 14px',
            fontSize: fontSm,
            maxWidth: 'min(92vw, 420px)',
            textAlign: 'center',
          }}
        >
          {operatorMsg}
        </div>
      )}

      {showPrimaryStrip && (
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
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <span>{phase === 'reloading' ? 'RELOADING…' : phaseLabel}</span>
          <button
            type="button"
            disabled={phase === 'reloading'}
            onClick={() => invokeReload(() => primaryActivate())}
            style={{
              minHeight: tapMin,
              borderRadius: 8,
              border: '1px solid rgba(125,255,138,0.55)',
              background: 'rgba(125,255,138,0.18)',
              color: '#e7ffe9',
              fontWeight: 700,
              fontSize: fontSm,
              padding: '0 14px',
              cursor: phase === 'reloading' ? 'not-allowed' : 'pointer',
              opacity: phase === 'reloading' ? 0.55 : 1,
            }}
          >
            {activate ? 'RELOAD' : 'RELOAD APP'}
          </button>
        </div>
      )}

      {!showPrimaryStrip && (
        <div
          style={{
            position: 'fixed',
            bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
            right: 12,
            zIndex: 100004,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 6,
            fontSize: Math.max(10, fontSm - 1),
            color: '#8a9a8c',
            letterSpacing: '0.06em',
            maxWidth: 'min(92vw, 320px)',
            textAlign: 'right',
          }}
        >
          <span 
            style={{ 
              color: isSupabaseConfigured ? '#8a9a8c' : '#ff6b6b',
              fontWeight: isSupabaseConfigured ? 400 : 700,
              fontSize: Math.max(9, fontSm - 3),
              textTransform: 'uppercase',
              letterSpacing: '0.1em'
            }}
          >
            {supabaseStatusText}
          </span>
          <span>{phaseLabel}</span>
          {recoveryText && (
            <span
              role="status"
              style={{
                color: '#d4b87a',
                lineHeight: 1.35,
                fontWeight: 600,
                fontSize: Math.max(10, fontSm - 2),
              }}
            >
              {recoveryText}
            </span>
          )}
          <button
            type="button"
            onClick={() => invokeReload(() => window.location.reload())}
            style={{
              minHeight: Math.max(36, tapMin - 8),
              padding: '0 12px',
              borderRadius: 8,
              border: '1px solid rgba(199,206,198,0.28)',
              background: 'rgba(10,14,12,0.88)',
              color: '#c7cec6',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            RELOAD APP
          </button>
        </div>
      )}

      {showPrimaryStrip && recoveryText && (
        <div
          role="status"
          style={{
            position: 'fixed',
            top: 58,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100004,
            maxWidth: 'min(92vw, 420px)',
            textAlign: 'center',
            fontSize: Math.max(10, fontSm - 1),
            color: '#d4b87a',
            lineHeight: 1.35,
            padding: '0 8px',
          }}
        >
          {recoveryText}
        </div>
      )}
    </>
  )
}
