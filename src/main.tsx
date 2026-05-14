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
import { classifyBuildFreshness } from './runtime/buildFreshness'
import { shouldDeferReloadOnControllerChange, shouldFlushDeferredReload } from './runtime/swReloadPolicy'
import { installDeploymentFreshnessGuard } from './runtime/deploymentFreshness'
import {
  classifyStaleRuntimeReason,
  FORCE_UPDATE_META_KEY,
  mergeForceUpdateMeta,
  SW_DEFERRED_RELOAD_KEY,
} from './runtime/forceUpdateMeta'
import { traceAction } from './runtime/actionTrace'
import {
  backendFailureReason,
  backendReady,
  getBackendReadySource,
  getSupabaseDiagnostics,
  hasSupabaseAnon,
  hasSupabaseUrl,
} from './lib/supabase'
import { logRuntimeIntegrityReport } from './runtime/runtimeIntegrity'
import { installOfflineReadiness } from './runtime/offlineReadiness'
import { consumeForceUpdateNavigationMark } from './utils/forceUpdate'

if (import.meta.env.DEV) {
  console.log('[BUILD ID]', __BUILD_ID__)
  console.log('[DEVICE DETECT]', getDeviceEnvironment())
}
if (typeof window !== 'undefined') {
  consumeForceUpdateNavigationMark()
  const host = window.location.hostname.toLowerCase()
  const deploymentProvider = host.includes('vercel.app')
    ? 'vercel'
    : host === 'localhost' || host === '127.0.0.1'
      ? 'local'
      : 'hosted'
  const bootDiag = getSupabaseDiagnostics()
  const swScope = navigator.serviceWorker?.controller?.scriptURL ?? 'none'
  const bootPayload = {
    backendReady,
    backendReadySource: getBackendReadySource(),
    backendFailureReason: backendFailureReason ?? 'none',
    hasSupabaseUrl,
    hasSupabaseAnon,
    supabaseUrlHost: bootDiag.supabaseUrlHost ?? 'none',
    buildTimeEnvMode: bootDiag.buildTimeEnvMode,
    origin: window.location.origin,
    swScope,
    buildId: __BUILD_ID__,
    buildStamp: import.meta.env.VITE_BUILD_STAMP ?? 'none',
    deploymentProvider,
  }
  if (import.meta.env.DEV) {
    console.table(bootPayload)
    logInfo('RUNTIME', 'boot', bootPayload)
  }
  if (import.meta.env.DEV) {
    console.table([
      {
        feature: 'Contact Config (Dead Man)',
        wired: true,
        handler: 'openContactConfig(source=deadman)',
      },
      {
        feature: 'Contact Config (SOS)',
        wired: true,
        handler: 'openContactConfig(source=sos)',
      },
    ])
    const harnessSeen = new Set<string>()
    const onHarnessResult = (ev: Event) => {
      const detail = (ev as CustomEvent<{ source?: string }>).detail
      if (detail?.source) harnessSeen.add(detail.source)
    }
    window.addEventListener('hud:contact-config-opened', onHarnessResult)
    window.setTimeout(() => {
      window.dispatchEvent(new Event('hud:test-open-contact-deadman'))
      window.dispatchEvent(new Event('hud:test-open-contact-sos'))
    }, 1200)
    window.setTimeout(() => {
      console.table([
        {
          feature: 'Contact Config (Dead Man) smoke',
          wired: harnessSeen.has('deadman'),
          handler: 'openContactConfig(source=deadman)',
        },
        {
          feature: 'Contact Config (SOS) smoke',
          wired: harnessSeen.has('sos'),
          handler: 'openContactConfig(source=sos)',
        },
      ])
      window.removeEventListener('hud:contact-config-opened', onHarnessResult)
    }, 2600)
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  try {
    const rawResult = sessionStorage.getItem('hud_force_update_result_v1')
    if (rawResult) {
      const parsed = JSON.parse(rawResult) as {
        beforeBuild?: string
        afterBuild?: string
        networkBuild?: string | null
        updateTriggered?: boolean
        reloadReason?: string
      }
      console.table({
        beforeBuild: parsed.beforeBuild ?? 'unknown',
        afterBuild: __BUILD_ID__,
        networkBuild: parsed.networkBuild ?? 'unknown',
        updateTriggered: Boolean(parsed.updateTriggered),
        reloadReason: parsed.reloadReason ?? 'unknown',
      })
    }
    const lastSeen = sessionStorage.getItem('hud_last_build_id')
    const runtimeBuild = getRuntimeSnapshot().buildId
    const freshness = classifyBuildFreshness({
      currentBuildId: __BUILD_ID__,
      runtimeBuildId: runtimeBuild,
      lastSeenBuildId: lastSeen,
    })
    if (import.meta.env.DEV && freshness.staleRuntimeSuspected) {
      console.info('[HUD DEV] build-freshness', {
        currentBuildId: __BUILD_ID__,
        runtimeBuildId: runtimeBuild,
        lastSeenBuildId: lastSeen,
        ...freshness,
      })
    }
    sessionStorage.setItem('hud_last_build_id', __BUILD_ID__)
  } catch {
    // ignore storage-denied/unsupported environments
  }
}

// Install runtime truth beacon as early as possible so any subsequent
// subsystem (SW registration, voice, permissions) can update it.
installRuntimeSnapshot()
installDeploymentFreshnessGuard()
installOfflineReadiness()
mountRuntimeDebugOverlay()
logInfo('RUNTIME', 'boot', {
  build: __BUILD_ID__,
  device: getDeviceProfile().type,
  mode: getDeviceProfile().interactionMode,
})
if (!backendReady) {
  const hint = getSupabaseDiagnostics().deployEnvHint
  console.warn('[BACKEND] degraded startup mode enabled', {
    backendFailureReason: backendFailureReason ?? 'unknown',
    backendReadySource: getBackendReadySource(),
    deployEnvHint: hint,
  })
  logInfo(
    'RUNTIME',
    'emergency contacts will use local device storage until Supabase is configured.',
  )
}

if (typeof window !== 'undefined') {
  const runIntegrity = () =>
    void logRuntimeIntegrityReport().catch((e) => console.warn('[RUNTIME INTEGRITY]', e))
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => runIntegrity(), { timeout: 4000 })
  } else {
    window.setTimeout(runIntegrity, 50)
  }
}

if (typeof document !== 'undefined') {
  document.title = `HUD [${import.meta.env.VITE_GIT_COMMIT || 'dev'}]`
  document.title = document.title + ' [' + __BUILD_ID__.slice(11, 19) + ']'
}

if (import.meta.env.PROD) {
  updateServiceWorker({ status: 'installing' })
  const activateUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (import.meta.env.DEV) console.info('[UPDATE AVAILABLE]')
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
  if (!import.meta.env.DEV) return
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
  const snap = getRuntimeSnapshot()
  const controllerUrl = snap.serviceWorker.controllerScriptUrl ?? navigator.serviceWorker?.controller?.scriptURL ?? null
  const controllerTag = controllerUrl ? controllerUrl.split('/').pop() ?? controllerUrl : 'none'
  const swState = snap.serviceWorker.status
  el.textContent = [
    `BUILD ID: ${__BUILD_ID__}`,
    `origin: ${window.location.origin}`,
    `sw.status: ${swState}`,
    `sw.controller: ${controllerTag}`,
    `sw.scope: ${snap.serviceWorker.scope ?? 'unknown'}`,
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
    try {
      window.dispatchEvent(
        new CustomEvent('hud:operator-reload-notify', {
          detail: { message: 'Clearing caches and reloading…' },
        }),
      )
    } catch {
      /* ignore */
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
    location.reload()
  }
  if (import.meta.env.DEV) {
    console.log('[FORCE RELOAD AVAILABLE] window.__forceReload()')
  }

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
    if (import.meta.env.DEV) {
      refreshDebugOverlay()
    }
  }

  window.addEventListener('resize', onViewportChange)
  window.addEventListener('orientationchange', onViewportChange)

  if ('serviceWorker' in navigator) {
    const flushDeferredReloadIfSafe = () => {
      traceAction('sw_controllerchange_reload', 'handler_enter', { source: 'deferred_flush_check' })
      const snap = getRuntimeSnapshot()
      const inFlight =
        snap.voice.state === 'arming' ||
        snap.voice.state === 'processing'
      const recovering =
        snap.runtimeContinuity.voiceRecoveryState === 'recovering' ||
        snap.runtimeContinuity.appLifecycleState === 'resuming'
      const gestureActive = snap.runtimeContinuity.gestureActive
      let deferred = false
      try {
        deferred = sessionStorage.getItem(SW_DEFERRED_RELOAD_KEY) === '1'
      } catch {
        deferred = false
      }
      if (
        !shouldFlushDeferredReload({
          deferredReloadFlag: deferred,
          inFlightVoiceGesture: inFlight,
          recovering,
          gestureActive,
        })
      ) {
        traceAction('sw_controllerchange_reload', 'guard_reject', { reason: 'flush_not_safe_or_not_deferred' })
        return
      }
      try {
        sessionStorage.removeItem(SW_DEFERRED_RELOAD_KEY)
      } catch {
        // ignore
      }
      logInfo('SW', 'flushing deferred reload')
      traceAction('sw_controllerchange_reload', 'reload_requested', { source: 'deferred_flush' })
      window.location.reload()
    }

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      traceAction('sw_controllerchange_reload', 'handler_enter', { source: 'controllerchange' })
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
      const defer = shouldDeferReloadOnControllerChange({
        inFlightVoiceGesture: inFlight,
        recovering,
        gestureActive,
      })
      try {
        const raw = sessionStorage.getItem(FORCE_UPDATE_META_KEY)
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        sessionStorage.setItem(
          FORCE_UPDATE_META_KEY,
          JSON.stringify(
            mergeForceUpdateMeta(parsed, {
            controllerChangeObserved: true,
            controllerChangeAt: Date.now(),
            controllerUrl: navigator.serviceWorker.controller?.scriptURL ?? null,
            }),
          ),
        )
      } catch {
        // ignore storage failures
      }
      if (defer && inFlight) {
        logWarn('SW', 'controllerchange deferred — voice gesture in flight')
        traceAction('sw_controllerchange_reload', 'deferred_reload', { reason: 'voice_gesture_in_flight' })
        try {
          sessionStorage.setItem(SW_DEFERRED_RELOAD_KEY, '1')
        } catch {
          // ignore
        }
        return
      }
      if (defer && (recovering || gestureActive)) {
        logWarn('SW', 'controllerchange deferred — recovery or gesture active', {
          recovering,
          gestureActive,
        })
        traceAction('sw_controllerchange_reload', 'deferred_reload', {
          reason: 'recovering_or_gesture_active',
          recovering,
          gestureActive,
        })
        try {
          sessionStorage.setItem(SW_DEFERRED_RELOAD_KEY, '1')
        } catch {
          // ignore
        }
        return
      }
      try {
        const raw = sessionStorage.getItem(FORCE_UPDATE_META_KEY)
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        sessionStorage.setItem(
          FORCE_UPDATE_META_KEY,
          JSON.stringify(
            mergeForceUpdateMeta(parsed, {
            reloadRequested: true,
            reloadRequestedAt: Date.now(),
            }),
          ),
        )
      } catch {
        // ignore storage failures
      }
      logInfo('SW', 'controllerchange — reloading')
      traceAction('sw_controllerchange_reload', 'reload_requested', { source: 'controllerchange' })
      window.location.reload()
    })
    window.addEventListener('focus', flushDeferredReloadIfSafe)
    window.addEventListener('pageshow', flushDeferredReloadIfSafe)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') flushDeferredReloadIfSafe()
    })

    if (import.meta.env.DEV) {
      void navigator.serviceWorker.getRegistration().then((reg) => {
        const waitingPresent = Boolean(reg?.waiting)
        const controllerUrl = navigator.serviceWorker.controller?.scriptURL ?? null
        let meta: Record<string, unknown> | null = null
        try {
          const raw = sessionStorage.getItem(FORCE_UPDATE_META_KEY)
          meta = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
        } catch {
          meta = null
        }
        if (meta) {
          const staleDiag = classifyStaleRuntimeReason({
            currentBuildId: __BUILD_ID__,
            runtimeBuildId: getRuntimeSnapshot().buildId,
            lastSeenBuildId: sessionStorage.getItem('hud_last_build_id'),
          })
          console.info('[HUD DEV] force-update-runtime-state', {
            currentBuildId: __BUILD_ID__,
            runtimeBuildId: getRuntimeSnapshot().buildId,
            controllerUrl,
            waitingPresent,
            controllerChangeObserved: Boolean(meta.controllerChangeObserved),
            reloadRequested: Boolean(meta.reloadRequested),
            staleRuntimeSuspected: staleDiag.staleRuntimeSuspected,
            staleRuntimeReason: staleDiag.reason,
          })
        }
      })
    }
  }

  if (import.meta.env.DEV) {
    if (document.body) {
      refreshDebugOverlay()
    } else {
      document.addEventListener('DOMContentLoaded', () => refreshDebugOverlay(), { once: true })
    }
  }

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
