import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registerSW } from 'virtual:pwa-register'
import { getDeviceEnvironment } from './utils/device'

console.log('[BUILD ID]', __BUILD_ID__)
console.log('[DEVICE DETECT]', getDeviceEnvironment())

if (typeof document !== 'undefined') {
  document.title = `HUD [${import.meta.env.VITE_GIT_COMMIT || 'dev'}]`
  document.title = document.title + ' [' + __BUILD_ID__.slice(11, 19) + ']'
}

if (import.meta.env.PROD) {
  const activateUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      console.log('[UPDATE AVAILABLE]')
      window.dispatchEvent(
        new CustomEvent('hud:sw-update', {
          detail: { activate: activateUpdate },
        }),
      )
    },
  })
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
    console.log('[DEVICE DETECT UPDATE]', getDeviceEnvironment())
    refreshDebugOverlay()
  }

  window.addEventListener('resize', onViewportChange)
  window.addEventListener('orientationchange', onViewportChange)

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[SW] Controller changed → reloading')
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
