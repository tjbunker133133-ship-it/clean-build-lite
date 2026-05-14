/**
 * DeadManPanel.tsx
 * Drop-in replacement for your existing DeadManPanel.
 * Matches your exact HudPanel / CSS-var style.
 * NEW vs old:
 *   - Timer shows HH:MM:SS (was MM:SS)
 *   - ACTIVATE button when timer not yet running
 *   - +1 HR extend button (repeatable per cycle)
 *   - Critical state (≤15 min) pulses amber
 *   - Progress bar based on full 4-hour window
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import HudPanel from './HudPanel'
import { useDeadMan } from '../hooks/useDeadMan'
import { useGPS } from '../hooks/useGPS'
import { useAppContext } from '../context/AppContext'
import { isDeadManAudioEnabled } from '../runtime/deadManAudio'
import {
  recordDeadManEscalation,
  updateDeadManTimer,
  type DeadManEscalationLevel,
  type DeadManTimerState,
} from '../runtime/runtimeSnapshot'
import { logInfo, logWarn } from '../runtime/logger'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { traceAction } from '../runtime/actionTrace'
import { classifyDeadmanDispatchEligibility } from '../runtime/deadmanEligibility'
import {
  touchFontSm,
  touchFontMd,
  touchGapMd,
  touchMinTarget,
} from './tokens'
import {
  fetchEmergencyContacts,
  type EmergencyContact,
} from '../lib/emergencyContacts'
import { openContactConfig } from './openContactConfig'
import { buildRescuePacket, resolveRapidEndpoint } from '../lib/rescue/buildRescuePacket'
import {
  clearDeadmanDispatchLock,
  recordDeadmanDispatchSuccess,
  shouldSkipDeadmanDispatch,
} from '../runtime/deadmanDispatchLock'
import { useCockpit } from '../context/CockpitContext'

// CONTRACT-SENSITIVE (threshold dedupe): the firing effect uses
// `firedAlertsRef.current.has(t.label)` as its idempotency key. Two
// invariants this list MUST preserve:
//   1. Labels must be UNIQUE — a duplicate label silently breaks the
//      "fire each threshold exactly once per episode" contract.
//   2. Order is descending by `ms` (largest first). The escalation log
//      relies on threshold-by-threshold progression; reversing the list
//      flips the operator-visible escalation sequence.
// Adding a new threshold: append a new unique label, keep descending ms.
const ALERT_THRESHOLDS = [
  { ms: 60 * 60 * 1000, label: '1 HOUR LEFT' },
  { ms: 30 * 60 * 1000, label: '30 MIN LEFT' },
  { ms: 15 * 60 * 1000, label: '15 MIN LEFT' },
  { ms: 5 * 60 * 1000, label: '5 MIN LEFT' },
]
const RENEW_WINDOW_S = 60

// Removed obsolete localStorage contact fallbacks (`titanium_saved_contacts`,
// `emergency_contacts_saved`, `titanium_route_contacts`,
// `current_route_contacts`). The dispatch path is now backend-truth-only via
// `buildRescuePacket()` → `fetchEmergencyContacts()`.

/**
 * Local audio playback for dead-man alerts.
 *
 * AUDIO GATE: This function is the SINGLE entry point for dead-man
 * audible playback (escalation alerts + expiry alert). It honors the
 * centralized flag exported from `runtime/deadManAudio.ts`:
 *
 *   - flag = true   → SpeechSynthesis utterance plays as before
 *   - flag = false  → no playback; emits a `[DEADMAN]` log line so
 *                     operators can confirm the alert fired with audio
 *                     suppressed. All other dead-man behavior continues
 *                     unchanged.
 *
 * The SpeechSynthesis code below is intentionally preserved verbatim so
 * flipping the flag back to `true` re-enables playback with no other
 * code changes.
 */
function speak(text: string) {
  if (!isDeadManAudioEnabled()) {
    logInfo('DEADMAN', `audioSuppressed=true text="${text.slice(0, 80)}"`)
    return
  }
  // CONTRACT-SENSITIVE (resilience): every browser-capability touchpoint
  // must be exception-isolated. If `SpeechSynthesisUtterance` or
  // `speechSynthesis.speak` throws (older Safari WebViews, private mode,
  // locked-down enterprise browsers), the exception MUST NOT bubble — it
  // would otherwise abort the dead-man renew-window `useEffect` before
  // the rescue interval is registered, suppressing auto-dispatch entirely.
  try {
    if (!('speechSynthesis' in window)) return
    if (typeof SpeechSynthesisUtterance !== 'function') return
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  } catch {
    logInfo('DEADMAN', 'speechSynthesis unavailable; alert text suppressed')
  }
}

export default function DeadManPanel() {
  // CONTRACT-SENSITIVE (subscriptions): both calls are intentional. They
  // do not appear to be used inside this component, but removing them
  // changes runtime behavior:
  //   - `useGPS()` participates in the GPS singleton's listener refcount
  //     (`src/hooks/useGPS.ts`). Dropping the call here lets the watch
  //     tear down sooner than the panel's actual lifetime.
  //   - `useAppContext()` keeps the panel subscribed to global app state
  //     so future operational signals can flow without re-wiring.
  // Do NOT "clean up" by deleting these calls.
  useGPS()
  useAppContext()
  const { panels, updatePanel, raisePanel } = useCockpit()
  const {
    formattedTime, remainingMs, isExpired, isCritical, isWarning,
    isActive, reset, extend, activate, deactivate, durationMs,
    setDurationMinutes, expiresAt,
  } = useDeadMan()

  const [statusText, setStatusText] = useState('STANDBY')
  /** Shown on the main status row (SOS parity); cleared on timer episode change. */
  const [dispatchResult, setDispatchResult] = useState<string | null>(null)
  const [renewCountdown, setRenewCountdown] = useState<number | null>(null)
  const firedAlertsRef = useRef<Set<string>>(new Set())
  const renewTimerRef = useRef<number | null>(null)
  // CONTRACT-SENSITIVE (iOS): absolute wall-clock deadline for the renew
  // window. iOS Safari throttles or fully pauses setInterval on hidden
  // tabs; tick-decrement math drifts and can suppress rescue dispatch
  // after a long background-suspend. Reading `deadline - Date.now()` on
  // each tick instead means the first resumed tick correctly fires the
  // rescue if the deadline has already passed during suspension.
  const renewDeadlineRef = useRef<number>(0)
  /** Previous episode key — used to clear session dispatch lock only on real transitions. */
  const deadmanEpisodeRef = useRef<{ expiresAt: number; isActive: boolean } | null>(null)
  // CONTRACT-SENSITIVE (exactly-once-per-episode dispatch): `sentRef` is
  // the per-mount idempotency gate for `sendDeadmanRescue`. It works in
  // tandem with the cross-mount sessionStorage lock:
  //   - `sentRef` flips to `true` BEFORE any await → blocks double POSTs
  //     within a single mount of this panel.
  //   - `shouldSkipDeadmanDispatch(expiresAt)` (sessionStorage-keyed)
  //     blocks duplicate POSTs across remounts / page reloads while the
  //     SAME `expiresAt` is still in scope.
  //   - The reset to `false` happens ONLY when `expiresAt` or `isActive`
  //     changes (the episode-transition `useEffect` below). Every other
  //     reset path is intentionally absent — do NOT add one inside the
  //     fetch finally block, do NOT clear after a failed POST.
  const sentRef = useRef(false)
  const [linkedContacts, setLinkedContacts] = useState<EmergencyContact[]>([])
  const [linkedStatus, setLinkedStatus] = useState<'loading' | 'ok' | 'unavailable'>('loading')
  // Mount tracker — guards post-async `setStatusText` calls in
  // `sendDeadmanRescue`. The rescue trigger gate (`sentRef`) is unchanged;
  // this only suppresses status-text writes that would land after unmount.
  const mountedRef = useRef(true)
  /** Abort in-flight rescue POST on panel unmount only. */
  const rescueFetchAbortRef = useRef<AbortController | null>(null)
  // CONTRACT-SENSITIVE (unmount cleanup ordering): the three statements
  // below MUST stay in this order:
  //   1. abort() — rejects any in-flight rescue fetch with AbortError.
  //   2. abort ref = null — drops the pointer AFTER abort() so abort()
  //      always sees a live controller.
  //   3. mountedRef = false — flipped LAST so the AbortError branch in
  //      `sendDeadmanRescue`'s catch can return cleanly; subsequent
  //      microtask-resumed paths see the post-unmount flag and no-op.
  // Reordering here resurrects post-unmount setState writes the prior
  // resilience pass eliminated.
  useEffect(() => {
    return () => {
      rescueFetchAbortRef.current?.abort()
      rescueFetchAbortRef.current = null
      mountedRef.current = false
    }
  }, [])

  const accent = isExpired
    ? '#ff3b3b'
    : isCritical
    ? '#ff8c00'
    : isWarning
    ? '#ffcc00'
    : '#00ffb4'

  const pct = isActive ? Math.max(0, remainingMs / durationMs) : 1
  const durationMin = Math.round(durationMs / 60_000)
  const thresholdOptions = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720]

  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const fontMd = touchFontMd(isMobile)
  const gapMd = touchGapMd(isMobile)
  const tapMin = touchMinTarget(isMobile)
  // Dead-man-specific: the renew/activate button is the most important tap
  // target in the app. 64px floor on mobile, 18px font, full-width, panel
  // padding 16+ on mobile so the timer is never flush against the edge.
  const checkInMinHeight = isMobile ? 64 : 44
  const checkInFontSize = isMobile ? 18 : 13
  const countdownFontSize = isMobile ? 32 : 28
  const panelPadding = isMobile ? 16 : 12

  const safeShowDispatch = (s: string) => {
    if (!mountedRef.current) return
    setStatusText(s)
    setDispatchResult(s)
  }

  const sendDeadmanRescue = async () => {
    traceAction('deadman_dispatch', 'handler_enter')
    if (import.meta.env.DEV) {
      console.log('[SYSTEM TRACE]', {
        step: 'deadman_dispatch_enter',
        success: true,
        data: { alreadySent: sentRef.current, expiresAt },
        error: null,
      })
    }
    const alreadyDispatched = shouldSkipDeadmanDispatch(expiresAt)
    if (alreadyDispatched) {
      safeShowDispatch('RESCUE ALREADY DISPATCHED (THIS TAB)')
      traceAction('deadman_dispatch', 'guard_reject', { reason: 'already_dispatched' })
      return
    }
    if (sentRef.current) {
      traceAction('deadman_dispatch', 'guard_reject', { reason: 'already_sent_in_mount' })
      return
    }
    sentRef.current = true
    // Payload construction is centralized in the shared builder. Trigger
    // gating, status text, endpoint lookup, and the network call below
    // are unchanged from the previous behavior.
    traceAction('deadman_dispatch', 'async_start', { step: 'build_packet' })
    const packet = await buildRescuePacket('DEADMAN')
    const contactCount = packet.contacts.length
    const endpoint = resolveRapidEndpoint()
    const eligibility = classifyDeadmanDispatchEligibility({
      alreadyDispatched,
      alreadySentInMount: false,
      contactCount,
      endpoint,
    })
    if (import.meta.env.DEV) {
      console.log('[SYSTEM TRACE]', {
        step: 'deadman_dispatch_eligibility',
        success: eligibility.dispatchReady,
        data: { contactCount, endpointConfigured: Boolean(endpoint), reason: eligibility.reason },
        error: eligibility.dispatchReady ? null : eligibility.reason,
      })
    }
    if (import.meta.env.DEV) {
      console.info('[HUD DEV] deadman-eligibility', {
        contactCount,
        endpointConfigured: Boolean(endpoint),
        eligible: eligibility.dispatchReady,
        reason: eligibility.reason,
      })
    }
    if (!eligibility.dispatchReady && eligibility.reason === 'no_contacts') {
      safeShowDispatch('EXPIRED — NO CONTACTS FOUND')
      traceAction('deadman_dispatch', 'guard_reject', { reason: 'no_contacts' })
      return
    }
    if (!eligibility.dispatchReady && eligibility.reason === 'no_endpoint') {
      safeShowDispatch(`EXPIRED — ${contactCount} CONTACTS READY (NO ENDPOINT)`)
      traceAction('deadman_dispatch', 'guard_reject', { reason: 'no_endpoint', contactCount })
      return
    }
    const ac = new AbortController()
    rescueFetchAbortRef.current = ac
    try {
      traceAction('deadman_dispatch', 'async_start', { step: 'post_dispatch', contactCount })
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(packet),
        signal: ac.signal,
      })
      if (res.ok) {
        if (import.meta.env.DEV) {
          console.log('[SYSTEM TRACE]', {
            step: 'deadman_dispatch_post',
            success: true,
            data: { status: res.status, contactCount, expiresAt },
            error: null,
          })
        }
        recordDeadmanDispatchSuccess(expiresAt)
        // Match SOS main-line wording: "SOS SENT TO N CONTACTS"
        safeShowDispatch(`DEADMAN SENT TO ${contactCount} CONTACTS`)
        traceAction('deadman_dispatch', 'async_complete', { status: res.status, contactCount })
      } else {
        if (import.meta.env.DEV) {
          console.log('[SYSTEM TRACE]', {
            step: 'deadman_dispatch_post',
            success: false,
            data: { status: res.status, contactCount, expiresAt },
            error: `http_${res.status}`,
          })
        }
        safeShowDispatch(`DEADMAN SEND FAILED (${res.status})`)
      }
      if (!res.ok) {
        traceAction('deadman_dispatch', 'failure', { reason: 'http_error', status: res.status })
      }
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === 'AbortError') return
      if (import.meta.env.DEV) {
        console.log('[SYSTEM TRACE]', {
          step: 'deadman_dispatch_post',
          success: false,
          data: { contactCount, expiresAt },
          error: 'network_error',
        })
      }
      safeShowDispatch('DEADMAN SEND FAILED (NETWORK)')
      traceAction('deadman_dispatch', 'failure', { reason: 'network_error' })
    } finally {
      if (rescueFetchAbortRef.current === ac) rescueFetchAbortRef.current = null
    }
  }

  // Mirror dead-man timer state into the runtime snapshot so the debug
  // overlay and any external operator tooling can answer "what is the
  // dead-man subsystem doing right now?". Never alters timer behavior.
  useEffect(() => {
    const timerState: DeadManTimerState = !isActive
      ? 'standby'
      : isExpired && renewCountdown != null && renewCountdown > 0
        ? 'renew_window'
        : isExpired
          ? 'expired'
          : isCritical
            ? 'critical'
            : isWarning
              ? 'warning'
              : 'nominal'
    updateDeadManTimer({
      timerState,
      active: isActive,
      remainingMs,
      durationMs,
    })
  }, [isActive, isExpired, isCritical, isWarning, remainingMs, durationMs, renewCountdown])

  // One-shot, read-only fetch of linked emergency contacts. No polling, no
  // timer, no re-fetch on rerender. Failures collapse to "unavailable" so the
  // dead-man panel keeps operating even when the backend is offline.
  useEffect(() => {
    let alive = true
    void fetchEmergencyContacts()
      .then(({ data, error }) => {
        if (!alive) return
        if (error) {
          setLinkedStatus('unavailable')
          return
        }
        setLinkedContacts(data)
        setLinkedStatus('ok')
      })
      .catch(() => {
        if (!alive) return
        setLinkedStatus('unavailable')
      })
    return () => {
      alive = false
    }
  }, [])

  // Pulse animation ref for critical state
  const pulseRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = pulseRef.current
    if (!el) return
    if (isCritical || isExpired) {
      el.style.animation = 'deadman-pulse 1s ease-in-out infinite'
    } else {
      el.style.animation = 'none'
    }
  }, [isCritical, isExpired])

  // CONTRACT-SENSITIVE (episode-transition reset): this effect locks the
  // dispatch / threshold / countdown contract across episode boundaries.
  // KEY INVARIANTS — do not "simplify":
  //   - First-mount detection (`prev !== null`) is REQUIRED. On first
  //     mount we MUST NOT clear the dispatch lock — a reload during
  //     post-dispatch silence (same `expiresAt` still in
  //     `trailmap_deadman_v1`) would otherwise replay the rescue.
  //   - `clearDeadmanDispatchLock()` MUST come BEFORE `sentRef = false`.
  //     Both gates open together; reversing order would briefly allow a
  //     pending rescue to bypass the lock if the timer fires between
  //     statements (extremely tight but real on slow devices).
  //   - `firedAlertsRef = new Set()` resets the threshold dedupe so a
  //     re-armed timer can re-fire 1h/30m/15m/5m alerts.
  //   - `setStatusText(...)` is LAST. Earlier effects may already have
  //     pushed an EXPIRED/RENEW string in this same render; the renew
  //     effect runs AFTER this one and re-asserts the renew text. Also reset isDisarmed.
  useEffect(() => {
    const prev = deadmanEpisodeRef.current
    const next = { expiresAt, isActive }
    const transitioned =
      prev !== null && (prev.expiresAt !== next.expiresAt || prev.isActive !== next.isActive)
    if (transitioned) {
      clearDeadmanDispatchLock()
    }
    deadmanEpisodeRef.current = next

    firedAlertsRef.current = new Set()
    sentRef.current = false
    if (renewTimerRef.current) {
      window.clearInterval(renewTimerRef.current)
      renewTimerRef.current = null
    }
    setRenewCountdown(null)
    setDispatchResult(null)
    setStatusText(isActive ? 'NOMINAL' : 'STANDBY')
  }, [expiresAt, isActive])

  useEffect(() => {
    if (!isActive || isExpired) return
    for (const t of ALERT_THRESHOLDS) {
      if (durationMs < t.ms) continue
      if (remainingMs <= t.ms && !firedAlertsRef.current.has(t.label)) {
        firedAlertsRef.current.add(t.label)
        setStatusText(`ALERT: ${t.label} — RENEW TIMER`)
        // Map threshold to escalation level for runtime visibility.
        const level: DeadManEscalationLevel =
          t.ms === 60 * 60 * 1000
            ? '1h'
            : t.ms === 30 * 60 * 1000
              ? '30m'
              : t.ms === 15 * 60 * 1000
                ? '15m'
                : '5m'
        // Structured log: separate lines so the audio-suppression state
        // is unambiguous in the production console.
        logWarn('DEADMAN', `escalation="${level}" label="${t.label}"`)
        if (!isDeadManAudioEnabled()) {
          logInfo('DEADMAN', 'audioSuppressed=true')
        }
        recordDeadManEscalation(level, t.label)
        // The audio call below remains intact; gated centrally inside speak().
        speak(`Deadman alert. ${t.label.toLowerCase()}. Renew timer now.`)
      }
    }
  }, [durationMs, isActive, isExpired, remainingMs])

  useEffect(() => {
    if (!isExpired || !isActive) return
    setStatusText(`EXPIRED — RENEW WITHIN ${RENEW_WINDOW_S}S`)
    setRenewCountdown(RENEW_WINDOW_S)
    // Capture the absolute deadline once, here. Subsequent tick callbacks
    // and the visibility-resume handler both read it without drift.
    renewDeadlineRef.current = Date.now() + RENEW_WINDOW_S * 1000
    logWarn('DEADMAN', 'escalation="expired" label="TIMER EXPIRED"')
    if (!isDeadManAudioEnabled()) {
      logInfo('DEADMAN', 'audioSuppressed=true')
    }
    recordDeadManEscalation('expired', 'TIMER EXPIRED')
    // Audio call preserved; centrally gated inside speak().
    speak('Deadman timer expired. Renew now or rescue will be sent.')
    // Single-source-of-truth tick: read seconds remaining from the
    // absolute deadline. Identical UI numbers (60..0) on a foregrounded
    // tab; correctly fires rescue on the first tick after a backgrounded
    // tab wakes past the deadline.
    const renewTick = () => {
      const remainingSec = Math.max(0, Math.ceil((renewDeadlineRef.current - Date.now()) / 1000))
      setRenewCountdown(remainingSec)
      if (remainingSec <= 0) {
        if (renewTimerRef.current) {
          window.clearInterval(renewTimerRef.current)
          renewTimerRef.current = null
        }
        void sendDeadmanRescue()
      }
    }
    renewTimerRef.current = window.setInterval(renewTick, 1000)
    // iOS Safari can fully pause setInterval on hidden tabs. When the
    // user returns, force one immediate reconciliation so the countdown
    // reflects wall-clock time and rescue fires without waiting up to
    // ~1s for the next throttled interval tick.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      if (renewTimerRef.current == null) return
      renewTick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (renewTimerRef.current) {
        window.clearInterval(renewTimerRef.current)
        renewTimerRef.current = null
      }
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpired, isActive])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onHarnessOpen = () => {
      openContactConfig({
        source: 'deadman',
        panels,
        updatePanel,
        raisePanel,
      })
    }
    window.addEventListener('hud:test-open-contact-deadman', onHarnessOpen)
    return () => window.removeEventListener('hud:test-open-contact-deadman', onHarnessOpen)
  }, [panels, updatePanel, raisePanel])

  const statusLine = useMemo(() => {
    if (dispatchResult) return dispatchResult
    if (!isActive) return '○ STANDBY'
    if (renewCountdown != null && renewCountdown > 0) return `⚠ EXPIRED — AUTO PUSH IN ${renewCountdown}s`
    if (isExpired) return '⚠ TIMER EXPIRED'
    if (isCritical) return '⚠ CRITICAL — CHECK IN NOW'
    if (isWarning) return '◉ WARNING'
    return '● NOMINAL'
  }, [dispatchResult, isActive, isCritical, isExpired, isWarning, renewCountdown])

  const handleRenew = () => {
    if (renewTimerRef.current) {
      window.clearInterval(renewTimerRef.current)
      renewTimerRef.current = null
    }
    setRenewCountdown(null)
    setStatusText('TIMER RENEWED')
    reset()
  }

  return (
    <>
      {/* Inject keyframes + active-state feedback for the check-in button. */}
      <style>{`
        @keyframes deadman-pulse {
          0%, 100% { box-shadow: 0 0 0px transparent; }
          50%       { box-shadow: 0 0 18px ${accent}99; }
        }
        .hud-deadman-checkin:active {
          transform: translateY(1px);
          filter: brightness(0.92);
          box-shadow: inset 0 0 0 1px var(--cockpit-accent, ${accent});
        }
      `}</style>

      <HudPanel
        panelId="deadman"
        title="Dead Man Switch"
        initialPos={{ x: 16, y: 590 }}
        initialWidth={220}
        accent={accent}
      >
        <div
          ref={pulseRef}
          style={{
            fontFamily: 'var(--font-mono)',
            borderRadius: 4,
            padding: panelPadding,
            display: 'grid',
            gap: gapMd,
          }}
        >

          {/* ── Big countdown clock — glanceable from arm's length ── */}
          <div
            style={{
              textAlign: 'center',
              fontSize: countdownFontSize,
              letterSpacing: '0.1em',
              color: accent,
              fontWeight: 'bold',
              padding: '8px 0 4px',
              textShadow: `0 0 20px ${accent}88`,
            }}
            aria-live="polite"
            role="status"
          >
            {formattedTime}
          </div>

          {/* ── Progress bar ── */}
          <div
            style={{
              height: 4,
              background: 'rgba(200,230,216,0.08)',
              borderRadius: 2,
              overflow: 'hidden',
              margin: '6px 0',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${pct * 100}%`,
                background: accent,
                borderRadius: 2,
                transition: 'width 1s linear',
                boxShadow: `0 0 8px ${accent}`,
              }}
            />
          </div>

          {/* ── Status label ── */}
          <div
            style={{
              fontSize: fontSm,
              letterSpacing: '0.12em',
              color: isExpired ? '#ff3b3b' : `${accent}99`,
              textAlign: 'center',
              fontWeight: 700,
            }}
          >
            {statusLine}
          </div>
          <div
            style={{
              fontSize: fontSm,
              letterSpacing: '0.08em',
              color: 'var(--cockpit-panel-subtle)',
              textAlign: 'center',
            }}
          >
            {statusText}
          </div>

          {/* ── Buttons ── */}
          {!isActive && (
            <div style={{ display: 'grid', gap: gapMd }}>
              <label
                style={{
                  display: 'block',
                  fontSize: fontSm,
                  color: 'var(--cockpit-panel-subtle)',
                  letterSpacing: '0.08em',
                  fontWeight: 700,
                }}
              >
                TIMER WINDOW
              </label>
              <div
                style={{
                  fontSize: fontSm,
                  color: 'var(--cockpit-panel-subtle)',
                  letterSpacing: '0.06em',
                  lineHeight: 1.45,
                }}
              >
                STARTS AT 2H. ADD +1H UNTIL IT MATCHES YOUR TRIP WINDOW.
              </div>
              <select
                data-no-drag
                value={durationMin}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                style={{
                  width: '100%',
                  minHeight: tapMin,
                  fontSize: fontMd,
                  borderRadius: 4,
                  border: '1px solid rgba(199,206,198,0.28)',
                  background: 'rgba(10,12,13,0.8)',
                  color: '#d3dad3',
                  padding: '0 10px',
                }}
              >
                {thresholdOptions.map((min) => (
                  <option key={min} value={min}>
                    {min >= 60 ? `${Math.floor(min / 60)}h ${min % 60 ? `${min % 60}m` : ''}`.trim() : `${min}m`}
                  </option>
                ))}
              </select>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  extend()
                }}
                style={btnStyle('#ffcc00', isMobile)}
              >
                +1 HR MORE
              </button>
            </div>
          )}
          {!isActive ? (
            <button // ACTIVATE button
              onClick={e => { e.stopPropagation(); activate() }}
              className="hud-deadman-checkin"
              style={primaryCheckInStyle('#00ffb4', checkInMinHeight, checkInFontSize)}
            >
              ACTIVATE
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: gapMd }}> {/* RENEW / EXTEND */}
              <button
                onClick={e => { e.stopPropagation(); handleRenew() }}
                className="hud-deadman-checkin"
                style={primaryCheckInStyle(accent, checkInMinHeight, checkInFontSize)}
              >
                {renewCountdown != null ? 'RENEW NOW' : 'RENEW TIMER'}
              </button>

              <button
                onClick={e => { e.stopPropagation(); extend() }}
                style={btnStyle('#ffcc00', isMobile)}
              >
                +1 HR MORE
              </button>
            </div>
          )}
          {isActive && ( // DEACTIVATE button only visible when active
            <button
              onClick={e => { e.stopPropagation(); deactivate() }}
              style={{
                ...btnStyle('#ff4466', isMobile),
                marginTop: gapMd,
                border: '1px solid rgba(255,68,102,0.55)',
                background: 'rgba(60,8,18,0.45)',
                color: '#ffb8c6',
                fontWeight: 700,
                letterSpacing: '0.08em',
              }}
            >
              DEACTIVATE
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              openContactConfig({
                source: 'deadman',
                panels,
                updatePanel,
                raisePanel,
              })
              setStatusText('OPENING CONTACT CONFIG')
            }}
            style={{ ...btnStyle('#7dff8a', isMobile), opacity: 1 }}
          >
            OPEN CONTACT CONFIG
          </button>

          {/*
            ── Linked emergency contacts (READ-ONLY) ──
            Backend-truth visibility. This panel remains operational/status-
            focused — editing happens elsewhere. Falls back gracefully if the
            backend is unavailable so the timer is never blocked.
          */}
          <div
            style={{
              marginTop: 4,
              paddingTop: 8,
              borderTop: '1px solid rgba(199,206,198,0.16)',
              display: 'grid',
              gap: 4,
              fontSize: fontSm,
              color: 'var(--cockpit-panel-subtle)',
              letterSpacing: '0.06em',
            }}
          >
            <div
              style={{
                fontSize: fontSm,
                fontWeight: 700,
                letterSpacing: '0.12em',
                color: 'var(--cockpit-panel-text, #d6ddd6)',
              }}
            >
              LINKED CONTACTS
            </div>
            {linkedStatus === 'loading' && (
              <div>Loading…</div>
            )}
            {linkedStatus === 'unavailable' && (
              // Shown only when the Supabase fetch genuinely failed (network
              // error / RLS denial / table missing). An empty contact list
              // is reported separately as 'none configured'.
              <div>Status: backend unavailable</div>
            )}
            {linkedStatus === 'ok' && linkedContacts.length === 0 && (
              <div>Status: no contacts configured</div>
            )}
            {linkedStatus === 'ok' && linkedContacts.length > 0 && (
              <>
                <div>Linked contacts: {linkedContacts.length}</div>
                {linkedContacts.slice(0, 3).map((c, i) => (
                  <div
                    key={c.id}
                    style={{
                      color: 'var(--cockpit-panel-text, #d6ddd6)',
                      fontSize: fontMd,
                    }}
                  >
                    {i === 0 ? 'Primary' : i === 1 ? 'Backup' : 'Tertiary'}:{' '}
                    {c.contact_name}
                  </div>
                ))}
                {linkedContacts.length > 3 && (
                  <div>+ {linkedContacts.length - 3} more</div>
                )}
                <div>
                  Rescue routing:{' '}
                  {linkedContacts.length >= 2 ? 'ready (escalation chain available)' : 'ready (single contact)'}
                </div>
              </>
            )}
          </div>
        </div>
      </HudPanel>
    </>
  )
}

function btnStyle(color: string, isMobile: boolean): React.CSSProperties {
  return {
    width: '100%',
    minHeight: touchMinTarget(isMobile),
    padding: '7px 0',
    background: `${color}18`,
    border: `1px solid ${color}55`,
    borderRadius: 2,
    color: color,
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    fontWeight: 700,
    fontSize: touchFontSm(isMobile),
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
  }
}

/**
 * Primary check-in / activate button style.
 *
 * This is the most important tap target in the app. Field rules:
 *   - 64px height on mobile (caller passes the right number)
 *   - 18px font on mobile so it's readable through gloves and at speed
 *   - full panel width (caller passes width: 100%)
 *   - visible :active state via the `.hud-deadman-checkin` class above
 */
function primaryCheckInStyle(color: string, minHeight: number, fontSize: number): React.CSSProperties {
  return {
    width: '100%',
    minHeight,
    padding: '10px 0',
    background: `${color}24`,
    border: `2px solid ${color}aa`,
    borderRadius: 6,
    color,
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    fontWeight: 800,
    fontSize,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    boxShadow: `0 0 12px ${color}55, inset 0 0 0 1px ${color}55`,
    transition: 'transform 80ms ease, filter 120ms ease',
  }
}
