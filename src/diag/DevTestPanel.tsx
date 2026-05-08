/**
 * DEV-only diagnostic overlay.
 *
 * Mounts via `mountDevTestPanel()` from `main.tsx`, but only inside an
 * `if (import.meta.env.DEV)` guard. The whole module — component, styles,
 * mount helper — is therefore excluded from production bundles.
 *
 * Surfaces:
 *   - Service-worker status (registered / active / waiting / installing / controlling)
 *   - Viewport size + mobile/desktop classification (mirrors getDeviceEnvironment)
 *   - Panel resize commits (Δw / Δh per panel id), most recent first
 *   - Last few `safeSystemNavigation` calls and their outcome (attempt / success / fallback)
 *
 * It mounts in its own React root (sibling to <App />) and never reads from
 * Cockpit context, so it cannot influence app render behavior.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  type PanelCommitEvent,
  type SystemNavEvent,
  subscribePanelCommit,
  subscribeSystemNav,
} from './devEvents'
import { getRuntimeSnapshot, subscribeRuntimeSnapshot, type RuntimeSnapshot } from '../runtime/runtimeSnapshot'
import { getDeviceEnvironment } from '../utils/device'

const PANEL_LOG_MAX = 8
const NAV_LOG_MAX = 6
const STORAGE_KEY = 'hud_dev_test_panel_open'
const SW_POLL_MS = 2500

type SwState = {
  registered: boolean
  active: boolean
  waiting: boolean
  installing: boolean
  controlling: boolean
}

type ViewportState = {
  w: number
  h: number
  isMobile: boolean
  isCompact: boolean
}

/** Aggregate soak counters — DEV panel only; derived from runtime snapshot diffs (no production hooks). */
type SoakCounters = {
  voiceRecoveringEnters: number
  voiceResumedEvents: number
  lifecycleResumeHints: number
  policyViolationAdds: number
  networkTransitionsSeen: number
  hapticAttemptsDelta: number
  standaloneToggles: number
  orientationEvents: number
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

function writeOpen(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    /* private mode / quota — non-fatal */
  }
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

function fmtDim(n: number | null): string {
  if (n == null) return '·'
  return n.toFixed(1)
}

function fmtDelta(n: number): string {
  if (Math.abs(n) < 0.05) return '0'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}`
}

const DevTestPanel: React.FC = () => {
  const [open, setOpen] = useState<boolean>(readOpen)

  const [sw, setSw] = useState<SwState>({
    registered: false,
    active: false,
    waiting: false,
    installing: false,
    controlling: false,
  })

  const [viewport, setViewport] = useState<ViewportState>(() => {
    if (typeof window === 'undefined') {
      return { w: 0, h: 0, isMobile: false, isCompact: false }
    }
    const env = getDeviceEnvironment()
    return {
      w: window.innerWidth,
      h: window.innerHeight,
      isMobile: env.isMobileEnvironment,
      isCompact: env.isCompactLayout,
    }
  })

  const [panelLog, setPanelLog] = useState<PanelCommitEvent[]>([])
  const [navLog, setNavLog] = useState<SystemNavEvent[]>([])
  const [soak, setSoak] = useState<SoakCounters>({
    voiceRecoveringEnters: 0,
    voiceResumedEvents: 0,
    lifecycleResumeHints: 0,
    policyViolationAdds: 0,
    networkTransitionsSeen: 0,
    hapticAttemptsDelta: 0,
    standaloneToggles: 0,
    orientationEvents: 0,
  })
  const snapPrevRef = useRef<RuntimeSnapshot | null>(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    let cancelled = false

    const refresh = async (): Promise<void> => {
      try {
        const reg = await navigator.serviceWorker.getRegistration()
        if (cancelled) return
        setSw({
          registered: !!reg,
          active: !!reg?.active,
          waiting: !!reg?.waiting,
          installing: !!reg?.installing,
          controlling: !!navigator.serviceWorker.controller,
        })
      } catch {
        /* registration query may reject on some hardened browsers */
      }
    }

    refresh()
    const onCtrl = (): void => {
      void refresh()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onCtrl)
    const interval = window.setInterval(() => void refresh(), SW_POLL_MS)
    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener('controllerchange', onCtrl)
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = (): void => {
      const env = getDeviceEnvironment()
      setViewport({
        w: window.innerWidth,
        h: window.innerHeight,
        isMobile: env.isMobileEnvironment,
        isCompact: env.isCompactLayout,
      })
    }
    const onOrient = (): void => {
      setSoak((s) => ({ ...s, orientationEvents: s.orientationEvents + 1 }))
      onResize()
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onOrient)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onOrient)
    }
  }, [])

  /** Long-session soak: transition detects only — O(1) per snapshot notify, no console. */
  useEffect(() => {
    return subscribeRuntimeSnapshot((snap) => {
      const prev = snapPrevRef.current
      snapPrevRef.current = snap
      if (!prev) return

      setSoak((s) => {
        const next: SoakCounters = { ...s }
        let changed = false
        const touch = (patch: Partial<SoakCounters>): void => {
          Object.assign(next, patch)
          changed = true
        }

        if (snap.voice.state === 'recovering' && prev.voice.state !== 'recovering') {
          touch({ voiceRecoveringEnters: next.voiceRecoveringEnters + 1 })
        }
        if (
          snap.runtimeContinuity.voiceRecoveryState === 'resumed' &&
          prev.runtimeContinuity.voiceRecoveryState !== 'resumed'
        ) {
          touch({ voiceResumedEvents: next.voiceResumedEvents + 1 })
        }
        const hiddenLike = ['hidden', 'background', 'suspended'].includes(
          prev.runtimeContinuity.appLifecycleState,
        )
        if (hiddenLike && snap.runtimeContinuity.appLifecycleState === 'resuming') {
          touch({ lifecycleResumeHints: next.lifecycleResumeHints + 1 })
        }
        const pv = snap.policy.violationCount - prev.policy.violationCount
        if (pv > 0) {
          touch({ policyViolationAdds: next.policyViolationAdds + pv })
        }
        const nt = snap.network.transitions.length - prev.network.transitions.length
        if (nt > 0) {
          touch({ networkTransitionsSeen: next.networkTransitionsSeen + nt })
        }
        const ha = snap.haptics.attemptCount - prev.haptics.attemptCount
        if (ha > 0) {
          touch({ hapticAttemptsDelta: next.hapticAttemptsDelta + ha })
        }
        if (snap.installMode.standalone !== prev.installMode.standalone) {
          touch({ standaloneToggles: next.standaloneToggles + 1 })
        }
        return changed ? next : s
      })
    })
  }, [])

  useEffect(() => {
    return subscribePanelCommit((event) => {
      setPanelLog((prev) => {
        const next = [event, ...prev]
        if (next.length > PANEL_LOG_MAX) next.length = PANEL_LOG_MAX
        return next
      })
    })
  }, [])

  useEffect(() => {
    return subscribeSystemNav((event) => {
      setNavLog((prev) => {
        const next = [event, ...prev]
        if (next.length > NAV_LOG_MAX) next.length = NAV_LOG_MAX
        return next
      })
    })
  }, [])

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev
      writeOpen(next)
      return next
    })
  }, [])

  const clearPanelLog = useCallback(() => setPanelLog([]), [])
  const clearNavLog = useCallback(() => setNavLog([]), [])
  const clearSoak = useCallback(() => {
    setSoak({
      voiceRecoveringEnters: 0,
      voiceResumedEvents: 0,
      lifecycleResumeHints: 0,
      policyViolationAdds: 0,
      networkTransitionsSeen: 0,
      hapticAttemptsDelta: 0,
      standaloneToggles: 0,
      orientationEvents: 0,
    })
    snapPrevRef.current = getRuntimeSnapshot()
  }, [])

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label="Open dev test panel"
        style={badgeStyle}
      >
        DEV
      </button>
    )
  }

  const swColor = sw.controlling ? '#7dff8a' : sw.registered ? '#f5d76e' : '#ff8a8a'
  const swSummary = sw.registered
    ? [
        sw.active ? 'active' : '–',
        sw.waiting ? 'WAITING' : '–',
        sw.installing ? 'installing' : '–',
        sw.controlling ? 'controlling' : '!controlling',
      ].join(' · ')
    : 'no registration'

  return (
    <div role="region" aria-label="Dev test panel" style={panelStyle}>
      <div style={headerStyle}>
        <span style={titleStyle}>DEV TEST PANEL</span>
        <button
          type="button"
          onClick={toggle}
          aria-label="Hide dev test panel"
          style={hideBtnStyle}
        >
          ×
        </button>
      </div>

      <section style={sectionStyle}>
        <div style={labelStyle}>SERVICE WORKER</div>
        <div style={{ ...rowStyle, color: swColor }}>{swSummary}</div>
      </section>

      <section style={sectionStyle}>
        <div style={labelStyle}>VIEWPORT</div>
        <div style={rowStyle}>
          {viewport.w}×{viewport.h}{' '}
          <span style={{ color: '#888' }}>·</span>{' '}
          <span style={{ color: viewport.isMobile ? '#7dff8a' : '#9ad' }}>
            {viewport.isMobile ? 'mobile' : 'desktop'}
          </span>
          {viewport.isCompact && !viewport.isMobile ? (
            <span style={{ color: '#f5d76e' }}> · compact</span>
          ) : null}
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <span style={labelStyle}>PANEL COMMITS</span>
          <button type="button" onClick={clearPanelLog} style={clearBtnStyle}>
            clear
          </button>
        </div>
        {panelLog.length === 0 ? (
          <div style={mutedStyle}>none yet</div>
        ) : (
          panelLog.map((c, i) => {
            const drift = c.dw !== 0 || c.dh !== 0
            return (
              <div key={`${c.ts}-${i}`} style={rowStyle}>
                <span style={{ color: '#9ad' }}>{fmtTime(c.ts)}</span>{' '}
                <span style={{ color: '#d8e3d8' }}>{c.panelId}</span>{' '}
                <span style={{ color: drift ? '#f5d76e' : '#666' }}>
                  Δw={fmtDelta(c.dw)} Δh={fmtDelta(c.dh)}
                </span>{' '}
                <span style={{ color: '#666' }}>
                  ({fmtDim(c.before.w)}→{fmtDim(c.after.w)}, {fmtDim(c.before.h)}→{fmtDim(c.after.h)})
                </span>
              </div>
            )
          })
        )}
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <span style={labelStyle}>SOAK (aggregate)</span>
          <button type="button" onClick={clearSoak} style={clearBtnStyle}>
            reset
          </button>
        </div>
        <div style={rowStyle}>voice→recovering: {soak.voiceRecoveringEnters}</div>
        <div style={rowStyle}>voice resumed: {soak.voiceResumedEvents}</div>
        <div style={rowStyle}>lifecycle resume: {soak.lifecycleResumeHints}</div>
        <div style={rowStyle}>policy Δ: {soak.policyViolationAdds}</div>
        <div style={rowStyle}>net flips: {soak.networkTransitionsSeen}</div>
        <div style={rowStyle}>haptic attempts Δ: {soak.hapticAttemptsDelta}</div>
        <div style={rowStyle}>standalone toggle: {soak.standaloneToggles}</div>
        <div style={rowStyle}>orientation: {soak.orientationEvents}</div>
        <div style={{ ...mutedStyle, marginTop: 2 }}>
          Drag-acquire timing: use [MOBILE_UI] logs · memory: use DevTools
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <span style={labelStyle}>SYSTEM NAV</span>
          <button type="button" onClick={clearNavLog} style={clearBtnStyle}>
            clear
          </button>
        </div>
        {navLog.length === 0 ? (
          <div style={mutedStyle}>none yet</div>
        ) : (
          navLog.map((n, i) => {
            const phaseColor =
              n.phase === 'success'
                ? '#7dff8a'
                : n.phase === 'fallback'
                  ? '#f5d76e'
                  : '#9ad'
            return (
              <div key={`${n.ts}-${i}`} style={rowStyle}>
                <span style={{ color: '#9ad' }}>{fmtTime(n.ts)}</span>{' '}
                <span style={{ color: phaseColor, fontWeight: 700 }}>{n.phase}</span>{' '}
                <span style={{ color: '#aaa' }}>{n.scheme}</span>{' '}
                <span style={{ color: '#666' }}>{n.url.slice(0, 32)}</span>
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  right: 8,
  bottom: 8,
  zIndex: 2147483645,
  width: 'min(340px, 92vw)',
  maxHeight: '60vh',
  overflowY: 'auto',
  background: 'rgba(0,0,0,0.78)',
  border: '1px solid rgba(125,255,138,0.35)',
  borderRadius: 6,
  padding: '6px 8px',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 10,
  lineHeight: 1.4,
  color: 'rgba(220,230,220,0.92)',
  pointerEvents: 'auto',
  boxShadow: '0 0 12px rgba(0,0,0,0.5)',
  boxSizing: 'border-box',
}

const badgeStyle: React.CSSProperties = {
  position: 'fixed',
  right: 8,
  bottom: 8,
  zIndex: 2147483645,
  background: 'rgba(0,0,0,0.7)',
  border: '1px solid rgba(125,255,138,0.45)',
  borderRadius: 999,
  padding: '4px 10px',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 10,
  letterSpacing: '0.08em',
  color: '#7dff8a',
  cursor: 'pointer',
  pointerEvents: 'auto',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 6,
}

const titleStyle: React.CSSProperties = {
  color: '#7dff8a',
  fontWeight: 700,
  letterSpacing: '0.08em',
  fontSize: 10,
}

const hideBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#aaa',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  padding: '0 4px',
}

const sectionStyle: React.CSSProperties = {
  marginBottom: 6,
}

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}

const labelStyle: React.CSSProperties = {
  color: '#7dff8a',
  fontSize: 9,
  letterSpacing: '0.08em',
  marginBottom: 2,
}

const rowStyle: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const mutedStyle: React.CSSProperties = {
  color: '#666',
}

const clearBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(125,255,138,0.25)',
  borderRadius: 4,
  color: '#9ad',
  cursor: 'pointer',
  fontSize: 9,
  padding: '0 6px',
  letterSpacing: '0.06em',
}

const HOST_ID = 'dev-test-panel-root'

export function mountDevTestPanel(): void {
  if (!import.meta.env.DEV) return
  if (typeof document === 'undefined') return
  if (document.getElementById(HOST_ID)) return
  const host = document.createElement('div')
  host.id = HOST_ID
  host.setAttribute('aria-hidden', 'false')
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(
    <React.StrictMode>
      <DevTestPanel />
    </React.StrictMode>,
  )
}

export default DevTestPanel
