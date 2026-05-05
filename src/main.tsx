import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

if (import.meta.env.PROD) {
  const activateUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(
        new CustomEvent('hud:sw-update', {
          detail: { activate: activateUpdate },
        }),
      )
    },
  })
}

if (typeof window !== 'undefined') {
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
  </React.StrictMode>
)
