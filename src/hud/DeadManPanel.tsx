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

const ALERT_THRESHOLDS = [
  { ms: 60 * 60 * 1000, label: '1 HOUR LEFT' },
  { ms: 30 * 60 * 1000, label: '30 MIN LEFT' },
  { ms: 15 * 60 * 1000, label: '15 MIN LEFT' },
  { ms: 5 * 60 * 1000, label: '5 MIN LEFT' },
]
const RENEW_WINDOW_S = 60

type RescueContact = {
  id: string
  name?: string
  email: string
  phone?: string
  relationship?: string
}

function getSavedContacts(): RescueContact[] {
  try {
    const raw =
      localStorage.getItem('titanium_saved_contacts') ??
      localStorage.getItem('emergency_contacts_saved') ??
      '[]'
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((c: any): RescueContact | null => {
        const email = typeof c?.email === 'string' ? c.email.trim() : ''
        if (!email) return null
        return {
          id: String(c.id ?? email),
          name: typeof c?.name === 'string' ? c.name : undefined,
          email,
          phone: typeof c?.phone === 'string' ? c.phone : undefined,
          relationship: typeof c?.relationship === 'string' ? c.relationship : undefined,
        }
      })
      .filter(Boolean) as RescueContact[]
  } catch {
    return []
  }
}

function getRouteContactIds(): string[] {
  try {
    const raw =
      localStorage.getItem('titanium_route_contacts') ??
      localStorage.getItem('current_route_contacts') ??
      '[]'
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((v: any) => (typeof v === 'string' ? v : typeof v?.id === 'string' ? v.id : ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

function resolveRapidEndpoint(): string {
  const env = ((import.meta as any).env?.VITE_RAPID_ENDPOINT_URL as string | undefined)?.trim()
  if (env) return env
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key) continue
      const value = localStorage.getItem(key)
      if (!value) continue
      try {
        const parsed = JSON.parse(value)
        if (parsed && typeof parsed.heartbeatFnUrl === 'string' && parsed.heartbeatFnUrl.trim()) {
          return parsed.heartbeatFnUrl.trim()
        }
      } catch {
        // noop
      }
    }
  } catch {
    // noop
  }
  return ''
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.rate = 1
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(u)
}

export default function DeadManPanel() {
  const gps = useGPS()
  const { state } = useAppContext()
  const {
    formattedTime, remainingMs, isExpired, isCritical, isWarning,
    isActive, reset, extend, activate, durationMs,
    setDurationMinutes, expiresAt,
  } = useDeadMan()

  const [statusText, setStatusText] = useState('STANDBY')
  const [renewCountdown, setRenewCountdown] = useState<number | null>(null)
  const firedAlertsRef = useRef<Set<string>>(new Set())
  const renewTimerRef = useRef<number | null>(null)
  const sentRef = useRef(false)

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

  const sendDeadmanRescue = async () => {
    if (sentRef.current) return
    sentRef.current = true
    const saved = getSavedContacts()
    const routeIds = new Set(getRouteContactIds())
    const selected = saved.filter((c) => routeIds.has(c.id))
    const contacts = selected.length ? selected : saved
    const payload = {
      type: 'trigger_rescue',
      trigger_source: 'deadman_timeout',
      timestamp: new Date().toISOString(),
      location: { lat: gps.lat, lon: gps.lng, accuracy_m: gps.accuracy },
      deadman: {
        configured_minutes: durationMin,
        expired_at: new Date(expiresAt).toISOString(),
      },
      route: state.waypoints.map((w) => ({
        id: w.id,
        lat: w.lat,
        lon: w.lng,
        label: w.label,
        type: w.type,
      })),
      contacts: contacts.map((c) => ({
        id: c.id,
        name: c.name ?? null,
        email: c.email,
        phone: c.phone ?? null,
        relationship: c.relationship ?? null,
      })),
    }
    if (!contacts.length) {
      setStatusText('EXPIRED — NO CONTACTS FOUND')
      return
    }
    const endpoint = resolveRapidEndpoint()
    if (!endpoint) {
      setStatusText(`EXPIRED — ${contacts.length} CONTACTS READY (NO ENDPOINT)`)
      return
    }
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) setStatusText(`DEADMAN RESCUE SENT (${contacts.length} CONTACTS)`)
      else setStatusText(`DEADMAN SEND FAILED (${res.status})`)
    } catch {
      setStatusText('DEADMAN SEND FAILED (NETWORK)')
    }
  }

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

  useEffect(() => {
    firedAlertsRef.current = new Set()
    sentRef.current = false
    if (renewTimerRef.current) {
      window.clearInterval(renewTimerRef.current)
      renewTimerRef.current = null
    }
    setRenewCountdown(null)
    setStatusText(isActive ? 'NOMINAL' : 'STARTS AT 2H — ADD HOURS TO MATCH TRIP')
  }, [expiresAt, isActive])

  useEffect(() => {
    if (!isActive || isExpired) return
    for (const t of ALERT_THRESHOLDS) {
      if (durationMs < t.ms) continue
      if (remainingMs <= t.ms && !firedAlertsRef.current.has(t.label)) {
        firedAlertsRef.current.add(t.label)
        setStatusText(`ALERT: ${t.label} — RENEW TIMER`)
        speak(`Deadman alert. ${t.label.toLowerCase()}. Renew timer now.`)
      }
    }
  }, [durationMs, isActive, isExpired, remainingMs])

  useEffect(() => {
    if (!isExpired || !isActive) return
    setStatusText(`EXPIRED — RENEW WITHIN ${RENEW_WINDOW_S}S`)
    setRenewCountdown(RENEW_WINDOW_S)
    speak('Deadman timer expired. Renew now or rescue will be sent.')
    renewTimerRef.current = window.setInterval(() => {
      setRenewCountdown((prev) => {
        if (prev == null) return null
        if (prev <= 1) {
          if (renewTimerRef.current) {
            window.clearInterval(renewTimerRef.current)
            renewTimerRef.current = null
          }
          void sendDeadmanRescue()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (renewTimerRef.current) {
        window.clearInterval(renewTimerRef.current)
        renewTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpired, isActive])

  const statusLine = useMemo(() => {
    if (!isActive) return '○ STANDBY'
    if (renewCountdown != null && renewCountdown > 0) return `⚠ EXPIRED — AUTO PUSH IN ${renewCountdown}s`
    if (isExpired) return '⚠ TIMER EXPIRED'
    if (isCritical) return '⚠ CRITICAL — CHECK IN NOW'
    if (isWarning) return '◉ WARNING'
    return '● NOMINAL'
  }, [isActive, isCritical, isExpired, isWarning, renewCountdown])

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
      {/* Inject keyframe once */}
      <style>{`
        @keyframes deadman-pulse {
          0%, 100% { box-shadow: 0 0 0px transparent; }
          50%       { box-shadow: 0 0 18px ${accent}99; }
        }
      `}</style>

      <HudPanel
        panelId="deadman"
        title="Dead Man Switch"
        initialPos={{ x: 16, y: 590 }}
        initialWidth={220}
        accent={accent}
      >
        <div ref={pulseRef} style={{ fontFamily: 'var(--font-mono)', borderRadius: 4 }}>

          {/* ── Big clock ── */}
          <div
            style={{
              textAlign: 'center',
              fontSize: 28,
              letterSpacing: '0.1em',
              color: accent,
              fontWeight: 'bold',
              padding: '8px 0 4px',
              textShadow: `0 0 20px ${accent}88`,
            }}
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
              fontSize: 9,
              letterSpacing: '0.12em',
              color: isExpired ? '#ff3b3b' : `${accent}99`,
              textAlign: 'center',
              marginBottom: 6,
            }}
          >
            {statusLine}
          </div>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.08em',
              color: 'var(--cockpit-panel-subtle)',
              textAlign: 'center',
              marginBottom: 10,
            }}
          >
            {statusText}
          </div>

          {/* ── Buttons ── */}
          {!isActive && (
            <div style={{ marginBottom: 8 }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: 4,
                  fontSize: 10,
                  color: 'var(--cockpit-panel-subtle)',
                  letterSpacing: '0.08em',
                }}
              >
                TIMER WINDOW
              </label>
              <div
                style={{
                  fontSize: 9,
                  color: 'var(--cockpit-panel-subtle)',
                  marginBottom: 6,
                  letterSpacing: '0.06em',
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
                  minHeight: 30,
                  borderRadius: 4,
                  border: '1px solid rgba(199,206,198,0.28)',
                  background: 'rgba(10,12,13,0.8)',
                  color: '#d3dad3',
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
                style={{ ...btnStyle('#ffcc00'), marginTop: 6 }}
              >
                +1 HR MORE
              </button>
            </div>
          )}
          {!isActive ? (
            <button
              onClick={e => { e.stopPropagation(); activate() }}
              style={btnStyle('#00ffb4')}
            >
              ACTIVATE
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                onClick={e => { e.stopPropagation(); handleRenew() }}
                style={btnStyle(accent)}
              >
                {renewCountdown != null ? 'RENEW NOW' : 'RESET TIMER'}
              </button>

              <button
                onClick={e => { e.stopPropagation(); extend() }}
                style={btnStyle('#ffcc00')}
              >
                +1 HR MORE
              </button>
            </div>
          )}
        </div>
      </HudPanel>
    </>
  )
}

function btnStyle(color: string): React.CSSProperties {
  return {
    width: '100%',
    padding: '7px 0',
    background: `${color}18`,
    border: `1px solid ${color}55`,
    borderRadius: 2,
    color: color,
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
  }
}
