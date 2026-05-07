import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registerSW } from 'virtual:pwa-register'
import { getDeviceEnvironment } from './utils/device'
import {
  installRuntimeSnapshot,
  updateServiceWorker,
  getRuntimeSnapshot,
  updatePendingSwUpdate,
} from './runtime/runtimeSnapshot'
import { mountRuntimeDebugOverlay } from './runtime/RuntimeDebugOverlay'
import { logInfo, logWarn } from './runtime/logger'
import { getDeviceProfile } from './runtime/deviceProfile'
import { reportPolicyAttempt } from './runtime/devicePolicy'

console.log('[BUILD ID]', __BUILD_ID__)
console.log('[DEVICE DETECT]', getDeviceEnvironment())

// Install runtime truth beacon as early as possible so any subsequent
// subsystem (SW registration, voice, permissions) can update it.
installRuntimeSnapshot()
mountRuntimeDebugOverlay()
logInfo('RUNTIME', 'boot', {
  build: __BUILD_ID__,
  device: getDeviceProfile().type,
  mode: getDeviceProfile().interactionMode,
})

if (typeof document !== 'undefined') {
  document.title = `HUD [${import.meta.env.VITE_GIT_COMMIT || 'dev'}]`
  document.title = document.title + ' [' + __BUILD_ID__.slice(11, 19) + ']'
}

if (import.meta.env.PROD) {
  updateServiceWorker({ status: 'installing' })
  const activateUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      console.log('[UPDATE AVAILABLE]')
      updateServiceWorker({ needsRefresh: true, status: 'installed' })
      updatePendingSwUpdate(true)
      window.dispatchEvent(
        new CustomEvent('hud:sw-update', {
          detail: { activate: activateUpdate },
        }),
      )
    },
    onOfflineReady() {
      updateServiceWorker({ status: 'activated' })
      updatePendingSwUpdate(false)
    },
  })

  // Track SW lifecycle in detail for the runtime snapshot. Workbox-window's
  // events go through `controllerchange`; we also poll the registration once.
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (!reg) {
          updateServiceWorker({ status: 'unregistered' })
          return
        }
        const setFromState = (sw: ServiceWorker | null) => {
          if (!sw) return
          updateServiceWorker({
            status: sw.state as never,
            controllerScriptUrl: sw.scriptURL ?? null,
            scope: reg.scope ?? null,
          })
          sw.addEventListener('statechange', () => {
            updateServiceWorker({ status: sw.state as never })
          })
        }
        setFromState(reg.active)
        setFromState(reg.installing)
        setFromState(reg.waiting)
      })
      .catch(() => {
        updateServiceWorker({ status: 'error' })
      })
  }
}

const DEBUG_OVERLAY_ID = 'hud-build-debug-overlay'

function refreshDebugOverlay() {
  if (typeof document === 'undefined') return
  let el = document.getElementById(DEBUG_OVERLAY_ID)
  if (!el) {
    el = document.createElement('div')
    el.id = DEBUG_OVERLAY_ID
    el.setAttribute('aria-hidden', 'true')
    Object.assign(el.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      zIndex: '2147483646',
      pointerEvents: 'none',
      fontFamily: 'ui-monospace, monospace',
      fontSize: '10px',
      lineHeight: '1.35',
      color: 'rgba(220,230,220,0.92)',
      background: 'rgba(0,0,0,0.55)',
      padding: '6px 8px',
      borderRadius: '6px',
      border: '1px solid rgba(125,255,138,0.35)',
      maxWidth: 'min(90vw, 280px)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    })
    document.body.appendChild(el)
  }
  const d = getDeviceEnvironment()
  el.textContent = [
    `BUILD ID: ${__BUILD_ID__}`,
    `isMobileEnvironment: ${d.isMobileEnvironment}`,
    `width: ${d.width}`,
    `touch: ${d.isTouchDevice}`,
  ].join('\n')
}

if (typeof window !== 'undefined') {
  const w = window as Window & {
    __forceReload?: () => Promise<void>
  }

  w.__forceReload = async () => {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
    location.reload()
  }
  console.log('[FORCE RELOAD AVAILABLE] window.__forceReload()')

  const onViewportChange = () => {
    if (import.meta.env.DEV) {
      try {
        const w = window as Window & { __HUD_LOOP_DEBUG__?: number; HUD_LOOP_DEBUG?: number }
        if (
          localStorage.getItem('hud_tier1_debug') === '1' ||
          w.__HUD_LOOP_DEBUG__ === 1 ||
          w.HUD_LOOP_DEBUG === 1
        ) {
          console.log('[DEVICE DETECT UPDATE]', getDeviceEnvironment())
        }
      } catch {
        /* ignore */
      }
    }
    refreshDebugOverlay()
  }

  window.addEventListener('resize', onViewportChange)
  window.addEventListener('orientationchange', onViewportChange)

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const snap = getRuntimeSnapshot()
      const inFlight =
        snap.voice.state === 'arming' ||
        snap.voice.state === 'processing'
      const recovering =
        snap.runtimeContinuity.voiceRecoveryState === 'recovering' ||
        snap.runtimeContinuity.appLifecycleState === 'resuming'
      const gestureActive = snap.runtimeContinuity.gestureActive
      // If a voice/permission gesture is in flight, defer the reload so we don't
      // abort an OS-level prompt. Otherwise, reload to pick up the new SW.
      updateServiceWorker({ status: 'controlling', needsRefresh: false })
      // DEPE: deferring during a voice gesture is REQUIRED. Reload-without-defer
      // is FORBIDDEN. Announce both states to the engine.
      reportPolicyAttempt(
        'sw.deferReloadDuringVoiceGesture',
        inFlight ? 'enable' : 'disable',
        `voiceState=${snap.voice.state}`,
      )
      reportPolicyAttempt(
        'sw.unconditionalReloadOnControllerchange',
        'disable',
        'controllerchange-handler',
      )
      if (inFlight) {
        logWarn('SW', 'controllerchange deferred — voice gesture in flight')
        return
      }
      if (recovering || gestureActive) {
        logWarn('SW', 'controllerchange deferred — recovery or gesture active', {
          recovering,
          gestureActive,
        })
        return
      }
      logInfo('SW', 'controllerchange — reloading')
      window.location.reload()
    })
  }

  if (document.body) {
    refreshDebugOverlay()
  } else {
    document.addEventListener('DOMContentLoaded', () => refreshDebugOverlay(), { once: true })
  }

  ;(window as any).__hudRuntimeGuards = true
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const asError = reason instanceof Error ? reason : new Error(String(reason ?? 'Unknown rejection'))
    console.error('[runtime] Unhandled promise rejection', asError)
  })

  window.addEventListener('error', (event) => {
    if (!event.error) return
    console.error('[runtime] Unhandled error', event.error)
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

if (import.meta.env.DEV) {
  void import('./diag/DevTestPanel').then(({ mountDevTestPanel }) => {
    mountDevTestPanel()
  })
}
