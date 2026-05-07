import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  getRuntimeSnapshot,
  subscribeRuntimeSnapshot,
  type RuntimeSnapshot,
} from './runtimeSnapshot'

/**
 * Toggleable in-app runtime overlay.
 *
 * Toggle in two ways:
 *   - keyboard: Alt+Shift+D
 *   - imperative: `window.__hudOverlay.toggle()` from devtools
 *
 * Persists user preference in `localStorage['hud_runtime_overlay']`.
 *
 * The overlay is dependency-free (no fetches, no global side effects beyond
 * the keyboard listener and the localStorage read on boot). It is safe to
 * mount in production but defaults to hidden; the keyboard binding only
 * arms when the user has explicitly enabled it once via devtools or query
 * string `?hudOverlay=1`.
 */

const STORAGE_KEY = 'hud_runtime_overlay'

function readInitialVisible(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const qp = new URLSearchParams(window.location.search)
    if (qp.get('hudOverlay') === '1') return true
    if (qp.get('hudOverlay') === '0') return false
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function persistVisible(v: boolean): void {
  try {
    if (v) localStorage.setItem(STORAGE_KEY, '1')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  right: 8,
  bottom: 8,
  zIndex: 2147483647,
  width: 'min(360px, 92vw)',
  maxHeight: '52vh',
  overflow: 'auto',
  background: 'rgba(8,10,12,0.92)',
  color: 'rgba(220,230,220,0.94)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10.5,
  lineHeight: 1.4,
  padding: 10,
  border: '1px solid rgba(125,255,138,0.4)',
  borderRadius: 8,
  pointerEvents: 'auto',
  boxShadow: '0 4px 18px rgba(0,0,0,0.6)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

const headingStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'rgba(125,255,138,0.9)',
  marginTop: 6,
  marginBottom: 2,
}

function colorFor(state: string): string {
  switch (state) {
    case 'listening':
    case 'processing':
    case 'controlling':
    case 'activated':
    case 'granted':
      return '#7dff8a'
    case 'arming':
    case 'starting':
    case 'installing':
    case 'activating':
    case 'prompt':
      return '#ffd76b'
    case 'error':
    case 'dead':
    case 'denied':
    case 'redundant':
    case 'unsupported':
      return '#ff6464'
    default:
      return 'rgba(220,230,220,0.78)'
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={headingStyle}>{title}</div>
      <div>{children}</div>
    </div>
  )
}

function Row({ k, v, color }: { k: string; v: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: 'rgba(160,180,170,0.85)' }}>{k}</span>
      <span style={{ color: color ?? 'rgba(220,230,220,0.94)', textAlign: 'right' }}>{v}</span>
    </div>
  )
}

function Body({ snap, onClose }: { snap: RuntimeSnapshot; onClose: () => void }) {
  const d = snap.device
  const sw = snap.serviceWorker
  const v = snap.voice
  const p = snap.permissions
  const trace = snap.commandTrace
  const ageSec = Math.round((Date.now() - snap.startedAt) / 1000)

  return (
    <div style={containerStyle} role="region" aria-label="HUD Runtime Overlay">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ color: '#7dff8a', fontSize: 11 }}>HUD RUNTIME</strong>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: '1px solid rgba(125,255,138,0.45)',
            color: 'rgba(220,230,220,0.9)',
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 4,
            cursor: 'pointer',
          }}
          aria-label="Hide runtime overlay"
        >
          hide
        </button>
      </div>

      <Section title="build">
        <Row k="id" v={snap.buildId.slice(0, 19)} />
        <Row k="age" v={`${ageSec}s`} />
      </Section>

      <Section title="device">
        <Row k="type" v={d.type} color={d.type === 'mobile' ? '#7dff8a' : '#9ad'} />
        <Row k="mode" v={d.interactionMode} />
        <Row k="orient" v={d.orientation} />
        <Row k="viewport" v={`${d.width}×${d.height}`} />
        <Row k="touch" v={String(d.isTouch)} />
        <Row k="ios" v={String(d.isIOS)} />
        <Row k="android" v={String(d.isAndroid)} />
        <Row k="pwa" v={String(d.isPWA)} color={d.isPWA ? '#7dff8a' : undefined} />
        <Row k="reduced-motion" v={String(d.prefersReducedMotion)} />
      </Section>

      <Section title="controller">
        <Row
          k="active"
          v={snap.activeController}
          color={snap.activeController === d.interactionMode ? '#7dff8a' : '#ff6464'}
        />
        {snap.activeController !== 'unknown' && snap.activeController !== d.interactionMode ? (
          <div style={{ color: '#ff6464', fontSize: 10 }}>mismatch — controller != device mode</div>
        ) : null}
      </Section>

      <Section title="service worker">
        <Row k="status" v={sw.status} color={colorFor(sw.status)} />
        <Row k="version" v={sw.buildVersion.slice(0, 19)} />
        <Row k="needs-refresh" v={String(sw.needsRefresh)} color={sw.needsRefresh ? '#ffd76b' : undefined} />
        {sw.buildVersion && sw.buildVersion !== snap.buildId ? (
          <div style={{ color: '#ff6464', fontSize: 10 }}>SW build mismatch — reload required</div>
        ) : null}
      </Section>

      <Section title="voice">
        <Row
          k="wakeWordDetectedAt"
          v={
            snap.wakeWordDetectedAt == null
              ? '—'
              : `${new Date(snap.wakeWordDetectedAt).toLocaleTimeString()} (${snap.wakeWordDetectedAt})`
          }
          color={snap.wakeWordDetectedAt != null ? '#7dff8a' : undefined}
        />
        <Row k="state" v={v.state} color={colorFor(v.state)} />
        <Row k="armed" v={String(v.armed)} color={v.armed ? '#7dff8a' : undefined} />
        <Row k="supported" v={String(v.supported)} />
        <Row k="permission" v={v.permission} color={colorFor(v.permission)} />
        {v.lastError ? (
          <Row k="error" v={v.lastError.slice(0, 60)} color="#ff6464" />
        ) : null}
        {v.armed && (v.state === 'inactive' || v.state === 'dead') ? (
          <div style={{ color: '#ff6464', fontSize: 10 }}>armed but not listening — dead-state</div>
        ) : null}
      </Section>

      <Section title="permissions">
        <Row k="geolocation" v={p.geolocation} color={colorFor(p.geolocation)} />
        <Row k="microphone" v={p.microphone} color={colorFor(p.microphone)} />
        <Row k="notifications" v={p.notifications} color={colorFor(p.notifications)} />
        <Row k="orientation" v={p.orientation} color={colorFor(p.orientation)} />
        <Row k="motion" v={p.motion} color={colorFor(p.motion)} />
      </Section>

      <Section title="command trace">
        {trace.length === 0 ? (
          <div style={{ opacity: 0.6 }}>(none)</div>
        ) : (
          trace
            .slice()
            .reverse()
            .map((e, i) => (
              <Row
                key={i}
                k={`${e.source}:${e.cmd}`}
                v={e.ok ? 'ok' : 'fail'}
                color={e.ok ? '#7dff8a' : '#ff6464'}
              />
            ))
        )}
      </Section>

      <Section title="policy (DEPE)">
        <Row k="mode" v={snap.policy.mode} />
        <Row
          k="violations"
          v={String(snap.policy.violationCount)}
          color={snap.policy.violationCount > 0 ? '#ff6464' : '#7dff8a'}
        />
        {snap.policy.recentViolations.length === 0 ? (
          <div style={{ opacity: 0.6 }}>(no violations)</div>
        ) : (
          snap.policy.recentViolations
            .slice()
            .reverse()
            .map((v, i) => (
              <div key={i} style={{ color: '#ff6464', fontSize: 9.5, lineHeight: 1.3 }}>
                {v.behavior} <span style={{ opacity: 0.7 }}>· {v.attempted} · expect {v.expected}</span>
                {v.context ? <div style={{ opacity: 0.55, marginLeft: 8 }}>{v.context}</div> : null}
              </div>
            ))
        )}
      </Section>

      <Section title="runtime continuity">
        <Row k="locked-mode" v={snap.runtimeContinuity.interactionModeLocked} />
        <Row k="lifecycle" v={snap.runtimeContinuity.appLifecycleState} />
        <Row k="voice-recovery" v={snap.runtimeContinuity.voiceRecoveryState} />
        <Row k="gps-recovery" v={snap.runtimeContinuity.gpsRecoveryState} />
        <Row k="coordinator" v={snap.runtimeContinuity.recoveryCoordinatorState} />
        <Row k="persistence" v={snap.runtimeContinuity.persistenceHealth} />
        <Row k="pending-sw-update" v={String(snap.runtimeContinuity.pendingSWUpdate)} />
        <Row k="gesture-active" v={String(snap.runtimeContinuity.gestureActive)} />
      </Section>

      <Section title="network">
        <Row k="online" v={String(snap.network.online)} color={snap.network.online ? '#7dff8a' : '#ffd76b'} />
        <Row k="last-online" v={snap.network.lastOnlineAt ? new Date(snap.network.lastOnlineAt).toLocaleTimeString() : '—'} />
        <Row k="last-offline" v={snap.network.lastOfflineAt ? new Date(snap.network.lastOfflineAt).toLocaleTimeString() : '—'} />
      </Section>

      <Section title="recent voice events">
        {snap.voiceEvents.length === 0 ? (
          <div style={{ opacity: 0.6 }}>(none)</div>
        ) : (
          snap.voiceEvents
            .slice()
            .reverse()
            .slice(0, 8)
            .map((e, i) => (
              <div key={i} style={{ fontSize: 9.5, lineHeight: 1.3, color: e.severity === 'CRITICAL' ? '#ff6464' : e.severity === 'DEGRADED' ? '#ffd76b' : 'rgba(220,230,220,0.78)' }}>
                {new Date(e.ts).toLocaleTimeString()} · {e.msg}
              </div>
            ))
        )}
      </Section>

      <Section title="recent runtime events">
        {snap.runtimeEvents.length === 0 ? (
          <div style={{ opacity: 0.6 }}>(none)</div>
        ) : (
          snap.runtimeEvents
            .slice()
            .reverse()
            .slice(0, 8)
            .map((e, i) => (
              <div key={i} style={{ fontSize: 9.5, lineHeight: 1.3, color: e.severity === 'CRITICAL' ? '#ff6464' : e.severity === 'DEGRADED' ? '#ffd76b' : 'rgba(220,230,220,0.78)' }}>
                {new Date(e.ts).toLocaleTimeString()} · {e.msg}
              </div>
            ))
        )}
      </Section>

      <Section title="voice registry">
        <Row k="commands" v={String(snap.voiceRegistry.totalCommands)} />
        <Row k="aliases" v={String(snap.voiceRegistry.totalAliases)} />
        <Row k="palette-visible" v={String(snap.voiceRegistry.paletteVisible)} />
        <Row k="directory-resolved" v={String(snap.voiceRegistry.resolvedDirectoryItems)} />
        <Row
          k="ghost-ui"
          v={String(snap.voiceRegistry.ghostDirectoryItems.length)}
          color={snap.voiceRegistry.ghostDirectoryItems.length > 0 ? '#ff6464' : '#7dff8a'}
        />
        <Row
          k="duplicate-aliases"
          v={String(snap.voiceRegistry.duplicateAliases.length)}
          color={snap.voiceRegistry.duplicateAliases.length > 0 ? '#ff6464' : '#7dff8a'}
        />
        <Row
          k="label-mismatches"
          v={String(snap.voiceRegistry.labelMismatches.length)}
          color={snap.voiceRegistry.labelMismatches.length > 0 ? '#ffd76b' : undefined}
        />
        <Row k="hidden-voice-only" v={String(snap.voiceRegistry.hiddenVoiceOnly.length)} />
        {snap.voiceRegistry.ghostDirectoryItems.length > 0 ? (
          <div style={{ color: '#ff6464', fontSize: 9.5, marginTop: 2 }}>
            ghosts: {snap.voiceRegistry.ghostDirectoryItems.map((g) => g.cmd).join(', ')}
          </div>
        ) : null}
        {snap.voiceRegistry.duplicateAliases.length > 0 ? (
          <div style={{ color: '#ff6464', fontSize: 9.5, marginTop: 2 }}>
            dup: {snap.voiceRegistry.duplicateAliases.map((d) => `${d.phrase} → [${d.commandIds.join(',')}]`).join(' · ')}
          </div>
        ) : null}
      </Section>

      <Section title="recent voice parser">
        {snap.voiceParserEvents.length === 0 ? (
          <div style={{ opacity: 0.6 }}>(none)</div>
        ) : (
          snap.voiceParserEvents
            .slice()
            .reverse()
            .slice(0, 8)
            .map((e, i) => {
              const tag = e.result === 'executed' ? 'executed' : `rejected:${e.reason}`
              const color = e.result === 'executed' ? 'rgba(220,230,220,0.78)' : '#ffd76b'
              return (
                <div key={i} style={{ fontSize: 9.5, lineHeight: 1.3, color }}>
                  {new Date(e.ts).toLocaleTimeString()} · &quot;{e.normalized.slice(0, 32)}&quot; → {e.commandId ?? '∅'} · {tag}
                </div>
              )
            })
        )}
      </Section>

      <Section title="command execution">
        {(() => {
          const ce = snap.commandExecution
          const last = ce.last
          const verColor =
            last?.verification === 'verified'
              ? '#7dff8a'
              : last?.verification === 'unverified_ok'
                ? '#ffd76b'
                : last?.verification === 'verification_failed'
                  ? '#ff6464'
                  : last?.verification === 'pending'
                    ? '#ffd76b'
                    : 'rgba(220,230,220,0.78)'
          const statusColor =
            last?.status === 'success'
              ? '#7dff8a'
              : last?.status === 'failed' || last?.status === 'timeout' || last?.status === 'rejected'
                ? '#ff6464'
                : last?.status === 'executing' || last?.status === 'requested'
                  ? '#ffd76b'
                  : 'rgba(220,230,220,0.78)'
          return (
            <>
              <Row k="success" v={String(ce.counts.success)} color="#7dff8a" />
              <Row k="failed" v={String(ce.counts.failed)} color={ce.counts.failed > 0 ? '#ff6464' : undefined} />
              <Row k="timeout" v={String(ce.counts.timeout)} color={ce.counts.timeout > 0 ? '#ff6464' : undefined} />
              <Row k="rejected" v={String(ce.counts.rejected)} color={ce.counts.rejected > 0 ? '#ff6464' : undefined} />
              <Row k="requested" v={String(ce.counts.requested)} />
              {last ? (
                <>
                  <Row k="last-cmd" v={last.commandId ?? '∅'} />
                  <Row k="last-status" v={last.status} color={statusColor} />
                  <Row k="last-verify" v={last.verification} color={verColor} />
                  {last.failureReason ? (
                    <Row k="last-reason" v={last.failureReason} color="#ff6464" />
                  ) : null}
                  {last.durationMs != null ? (
                    <Row k="last-duration" v={`${last.durationMs}ms`} />
                  ) : null}
                </>
              ) : (
                <div style={{ opacity: 0.6 }}>(no commands yet)</div>
              )}
              {ce.history.length > 0 ? (
                <div style={{ marginTop: 4 }}>
                  {ce.history
                    .slice()
                    .reverse()
                    .slice(0, 6)
                    .map((e) => {
                      const c =
                        e.status === 'success'
                          ? 'rgba(220,230,220,0.78)'
                          : e.status === 'failed' || e.status === 'timeout' || e.status === 'rejected'
                            ? '#ff6464'
                            : '#ffd76b'
                      return (
                        <div key={e.id} style={{ fontSize: 9.5, lineHeight: 1.3, color: c }}>
                          {new Date(e.requestedAt).toLocaleTimeString()} · {e.commandId ?? '∅'} ·{' '}
                          {e.status}
                          {e.verification !== 'pending' && e.verification !== 'skipped'
                            ? ` (${e.verification})`
                            : ''}
                          {e.failureReason ? ` · ${e.failureReason}` : ''}
                        </div>
                      )
                    })}
                </div>
              ) : null}
            </>
          )
        })()}
      </Section>

      <Section title="haptics">
        <Row
          k="supported"
          v={String(snap.haptics.supported)}
          color={snap.haptics.supported ? '#7dff8a' : 'rgba(220,230,220,0.6)'}
        />
        <Row
          k="enabled"
          v={String(snap.haptics.enabled)}
          color={snap.haptics.enabled ? '#7dff8a' : '#ffd76b'}
        />
        <Row k="last-event" v={snap.haptics.lastEvent ?? '—'} />
        <Row
          k="last-pulse"
          v={
            snap.haptics.lastPulseAt
              ? new Date(snap.haptics.lastPulseAt).toLocaleTimeString()
              : '—'
          }
        />
        <Row k="attempts" v={String(snap.haptics.attemptCount)} />
        <Row
          k="suppressed"
          v={String(snap.haptics.suppressedCount)}
          color={snap.haptics.suppressedCount > 0 ? '#ffd76b' : undefined}
        />
        {snap.haptics.lastSuppressedReason ? (
          <Row k="last-suppress" v={snap.haptics.lastSuppressedReason} color="#ffd76b" />
        ) : null}
      </Section>

      <Section title="dead man">
        <Row
          k="timerState"
          v={snap.deadMan.timerState}
          color={
            snap.deadMan.timerState === 'expired' || snap.deadMan.timerState === 'renew_window'
              ? '#ff6464'
              : snap.deadMan.timerState === 'critical'
                ? '#ff8c00'
                : snap.deadMan.timerState === 'warning'
                  ? '#ffd76b'
                  : snap.deadMan.timerState === 'nominal'
                    ? '#7dff8a'
                    : undefined
          }
        />
        <Row k="escalation" v={snap.deadMan.escalationLevel} />
        <Row
          k="audioEnabled"
          v={String(snap.deadMan.audioEnabled)}
          color={snap.deadMan.audioEnabled ? '#7dff8a' : '#ffd76b'}
        />
        <Row k="active" v={String(snap.deadMan.active)} />
        {snap.deadMan.active ? (
          <Row
            k="remaining"
            v={`${Math.floor(snap.deadMan.remainingMs / 60000)}m ${Math.floor((snap.deadMan.remainingMs % 60000) / 1000)}s`}
          />
        ) : null}
        {snap.deadMan.lastEscalationLabel ? (
          <Row
            k="last-escalation"
            v={`${snap.deadMan.lastEscalationLabel} @ ${new Date(snap.deadMan.lastEscalationAt).toLocaleTimeString()}`}
            color="#ffd76b"
          />
        ) : null}
        {!snap.deadMan.audioEnabled ? (
          <div style={{ color: '#ffd76b', fontSize: 9.5, marginTop: 2 }}>
            audio temporarily suppressed (deadManAudio.ts)
          </div>
        ) : null}
      </Section>
    </div>
  )
}

function OverlayRoot() {
  const [visible, setVisible] = useState<boolean>(readInitialVisible)
  const [snap, setSnap] = useState<RuntimeSnapshot>(getRuntimeSnapshot)

  useEffect(() => {
    const unsub = subscribeRuntimeSnapshot(() => {
      setSnap({ ...getRuntimeSnapshot() })
    })
    return unsub
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        setVisible((v) => {
          const next = !v
          persistVisible(next)
          return next
        })
      }
    }
    window.addEventListener('keydown', onKey)
    const w = window as Window & {
      __hudOverlay?: { toggle: () => void; show: () => void; hide: () => void }
    }
    w.__hudOverlay = {
      toggle: () =>
        setVisible((v) => {
          persistVisible(!v)
          return !v
        }),
      show: () => {
        persistVisible(true)
        setVisible(true)
      },
      hide: () => {
        persistVisible(false)
        setVisible(false)
      },
    }
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!visible) return null
  return (
    <Body
      snap={snap}
      onClose={() => {
        persistVisible(false)
        setVisible(false)
      }}
    />
  )
}

let mounted = false

export function mountRuntimeDebugOverlay(): void {
  if (mounted || typeof document === 'undefined') return
  mounted = true
  const host = document.createElement('div')
  host.id = 'hud-runtime-overlay-host'
  host.setAttribute('aria-hidden', 'true')
  document.body.appendChild(host)
  createRoot(host).render(<OverlayRoot />)
}
