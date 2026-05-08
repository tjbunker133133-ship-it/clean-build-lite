import { useCallback, useEffect, useMemo, useState } from 'react'
import HudPanel from './HudPanel'
import { useGPS, requestLocation } from '../hooks/useGPS'
import { useCockpit } from '../context/CockpitContext'
import {
  createCheckInContact,
  deleteCheckInContact,
  fetchCheckInContacts,
  type CheckInContact,
} from '../lib/checkIn/checkInContacts'
import type { RoutineCheckInContact } from '../lib/checkIn/routineCheckInTypes'
import { useCheckInBeacon } from '../hooks/useCheckInBeacon'
import { getDeviceProfile } from '../runtime/deviceProfile'
import {
  touchFontSm as touchFontSmFn,
  touchGapMd as touchGapMdFn,
  touchGapSm as touchGapSmFn,
  touchMinTarget as touchMinTargetFn,
} from './tokens'

const ACCENT = '#5ad4c4'
const MUTED = '#8aa7b8'
const FIELD_BG = 'rgba(20, 40, 48, 0.55)'

function toRoutineContacts(rows: CheckInContact[]): RoutineCheckInContact[] {
  return rows.map((c) => ({ name: c.contact_name, email: c.email.trim().toLowerCase() }))
}

function isEmail(s: string): boolean {
  const t = s.trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)
}

export default function CheckInPanel() {
  const gps = useGPS()
  const { raisePanel } = useCockpit()
  const [contacts, setContacts] = useState<CheckInContact[]>([])
  const [loading, setLoading] = useState(true)
  const [statusLine, setStatusLine] = useState('')
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [flushing, setFlushing] = useState(false)

  const getRoutine = useCallback(() => toRoutineContacts(contacts), [contacts])

  const {
    beacon,
    setBeaconPersisted,
    intervalChoices,
    outboxCount,
    sendManual,
    flushOutbox,
  } = useCheckInBeacon(getRoutine)

  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const touchFontSm = touchFontSmFn(isMobile)
  const touchGapMd = touchGapMdFn(isMobile)
  const touchGapSm = touchGapSmFn(isMobile)
  const touchMin = touchMinTargetFn(isMobile)

  const reloadContacts = useCallback(async () => {
    setLoading(true)
    const { data, error } = await fetchCheckInContacts()
    setContacts(data)
    if (error && data.length === 0) setStatusLine(`Could not load roster: ${error.message}`)
    else setStatusLine('')
    setLoading(false)
  }, [])

  useEffect(() => {
    void reloadContacts()
  }, [reloadContacts])

  const hasFix = useMemo(
    () => gps.locationState === 'granted' && gps.lat != null && gps.lng != null,
    [gps.lat, gps.lng, gps.locationState],
  )

  const canSend = hasFix && contacts.length > 0 && !sending

  const onAddContact = async () => {
    const name = newName.trim()
    const email = newEmail.trim()
    if (!name || !email) {
      setStatusLine('Enter a display name and email.')
      return
    }
    if (!isEmail(email)) {
      setStatusLine('Enter a valid email address.')
      return
    }
    const { data, error } = await createCheckInContact({ contact_name: name, email })
    if (error || !data) {
      setStatusLine(error?.message ?? 'Could not add contact.')
      return
    }
    setNewName('')
    setNewEmail('')
    await reloadContacts()
    setStatusLine('Contact added for routine check-ins only.')
  }

  const onDelete = async (id: string) => {
    const { error } = await deleteCheckInContact(id)
    if (error) setStatusLine(error.message)
    await reloadContacts()
  }

  const onSendManual = async () => {
    if (!canSend) return
    setSending(true)
    setStatusLine('')
    const r = await sendManual(note || null)
    setSending(false)
    if (!r.ok) {
      setStatusLine('Need a GPS fix and at least one check-in contact.')
      raisePanel('checkin')
      return
    }
    setStatusLine(r.status === 'sent' ? 'Check-in sent.' : 'Check-in queued (offline or retry).')
  }

  const onFlush = async () => {
    setFlushing(true)
    const r = await flushOutbox()
    setFlushing(false)
    setStatusLine(`Outbox: sent ${r.sent}, ${r.remaining} waiting.`)
  }

  const beaconSummary = beacon.active
    ? beacon.paused
      ? 'Timed beacon: paused'
      : `Timed beacon: every ${beacon.intervalMinutes} min`
    : 'Timed beacon: off'

  return (
    <HudPanel
      panelId="checkin"
      title="Routine check-in"
      accent={ACCENT}
      initialPos={{ x: 320, y: 96 }}
      initialWidth={300}
      minHeight={320}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: touchGapMd, color: MUTED }}>
        <p style={{ margin: 0, fontSize: touchFontSm, lineHeight: 1.45 }}>
          Share your position for progress updates — not for emergencies. Uses the current GPS fix only
          (no extra acquisition). Separate roster from SOS.
        </p>
        <p style={{ margin: 0, fontSize: touchFontSm - 1, lineHeight: 1.4, opacity: 0.85 }}>
          Outbound: set <code style={{ color: '#b8dcff' }}>VITE_CHECKIN_WEBHOOK_URL</code> (POST JSON) or
          Supabase table <code style={{ color: '#b8dcff' }}>check_in_events</code> when no webhook is set.
        </p>

        {!hasFix && (
          <button
            type="button"
            data-ui-action="checkin-enable-location"
            onClick={() => void requestLocation()}
            style={{
              minHeight: touchMin,
              borderRadius: 8,
              border: `1px solid ${ACCENT}88`,
              background: FIELD_BG,
              color: ACCENT,
              cursor: 'pointer',
              fontSize: touchFontSm,
            }}
          >
            Enable location for check-in
          </button>
        )}

        <section>
          <div style={{ fontSize: touchFontSm, color: ACCENT, marginBottom: touchGapSm }}>
            Check-in contacts (separate from SOS)
          </div>
          {loading ? (
            <div style={{ fontSize: touchFontSm }}>Loading roster…</div>
          ) : contacts.length === 0 ? (
            <div style={{ fontSize: touchFontSm }}>No contacts yet — add one below.</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {contacts.map((c) => (
                <li
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: FIELD_BG,
                    border: `1px solid ${ACCENT}33`,
                  }}
                >
                  <span style={{ fontSize: touchFontSm, color: '#c5dce8' }}>
                    {c.contact_name}{' '}
                    <span style={{ color: MUTED }}>({c.email})</span>
                  </span>
                  <button
                    type="button"
                    data-ui-action={`checkin-remove-${c.id}`}
                    onClick={() => void onDelete(c.id)}
                    style={{
                      minHeight: 40,
                      minWidth: 40,
                      borderRadius: 6,
                      border: `1px solid ${MUTED}55`,
                      background: 'transparent',
                      color: MUTED,
                      cursor: 'pointer',
                      fontSize: touchFontSm,
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: touchGapSm, marginTop: touchGapMd }}>
            <input
              aria-label="Contact name"
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{
                flex: '1 1 100px',
                minHeight: touchMin,
                borderRadius: 6,
                border: `1px solid ${ACCENT}44`,
                background: FIELD_BG,
                color: '#dff8ff',
                padding: '0 10px',
                fontSize: touchFontSm,
              }}
            />
            <input
              aria-label="Contact email"
              placeholder="Email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              style={{
                flex: '1 1 140px',
                minHeight: touchMin,
                borderRadius: 6,
                border: `1px solid ${ACCENT}44`,
                background: FIELD_BG,
                color: '#dff8ff',
                padding: '0 10px',
                fontSize: touchFontSm,
              }}
            />
            <button
              type="button"
              data-ui-action="checkin-add-contact"
              onClick={() => void onAddContact()}
              style={{
                minHeight: touchMin,
                padding: '0 14px',
                borderRadius: 8,
                border: `1px solid ${ACCENT}aa`,
                background: `${ACCENT}22`,
                color: ACCENT,
                cursor: 'pointer',
                fontSize: touchFontSm,
              }}
            >
              Add
            </button>
          </div>
        </section>

        <section>
          <div style={{ fontSize: touchFontSm, color: ACCENT, marginBottom: touchGapSm }}>Optional note</div>
          <textarea
            aria-label="Short status message"
            value={note}
            maxLength={160}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Short status (optional)"
            style={{
              width: '100%',
              resize: 'vertical',
              minHeight: 72,
              borderRadius: 6,
              border: `1px solid ${ACCENT}44`,
              background: FIELD_BG,
              color: '#dff8ff',
              padding: 8,
              fontSize: touchFontSm,
              boxSizing: 'border-box',
            }}
          />
        </section>

        <button
          type="button"
          data-ui-action="checkin-send-manual"
          disabled={!canSend}
          onClick={() => void onSendManual()}
          style={{
            minHeight: touchMin,
            borderRadius: 8,
            border: `1px solid ${ACCENT}cc`,
            background: canSend ? `${ACCENT}35` : `${ACCENT}12`,
            color: canSend ? '#0a1418' : MUTED,
            cursor: canSend ? 'pointer' : 'not-allowed',
            fontWeight: 600,
            fontSize: touchFontSm,
          }}
        >
          {sending ? 'Sending…' : 'Send check-in now'}
        </button>

        <section
          style={{
            borderTop: `1px solid ${ACCENT}33`,
            paddingTop: touchGapMd,
            display: 'flex',
            flexDirection: 'column',
            gap: touchGapSm,
          }}
        >
          <div style={{ fontSize: touchFontSm, color: ACCENT }}>Timed beacon</div>
          <div style={{ fontSize: touchFontSm }}>{beaconSummary}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: touchGapSm, alignItems: 'center' }}>
            <label style={{ fontSize: touchFontSm, display: 'flex', alignItems: 'center', gap: 6 }}>
              Interval
              <select
                aria-label="Beacon interval"
                value={beacon.intervalMinutes}
                disabled={beacon.active && !beacon.paused}
                onChange={(e) =>
                  setBeaconPersisted({
                    ...beacon,
                    intervalMinutes: Number(e.target.value) as typeof beacon.intervalMinutes,
                  })
                }
                style={{
                  minHeight: 40,
                  borderRadius: 6,
                  border: `1px solid ${ACCENT}55`,
                  background: FIELD_BG,
                  color: '#dff8ff',
                  fontSize: touchFontSm,
                }}
              >
                {intervalChoices.map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </label>
            {!beacon.active ? (
              <button
                type="button"
                data-ui-action="checkin-beacon-start"
                disabled={!hasFix || contacts.length === 0}
                onClick={() => setBeaconPersisted({ ...beacon, active: true, paused: false })}
                style={{
                  minHeight: touchMin,
                  padding: '0 12px',
                  borderRadius: 8,
                  border: `1px solid #7eb8ff`,
                  background: 'rgba(100, 160, 220, 0.2)',
                  color: '#b8dcff',
                  cursor: hasFix && contacts.length > 0 ? 'pointer' : 'not-allowed',
                  fontSize: touchFontSm,
                }}
              >
                Start beacon
              </button>
            ) : (
              <>
                <button
                  type="button"
                  data-ui-action="checkin-beacon-pause"
                  onClick={() => setBeaconPersisted({ ...beacon, paused: !beacon.paused })}
                  style={{
                    minHeight: touchMin,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: `1px solid ${ACCENT}77`,
                    background: FIELD_BG,
                    color: ACCENT,
                    cursor: 'pointer',
                    fontSize: touchFontSm,
                  }}
                >
                  {beacon.paused ? 'Resume' : 'Pause'}
                </button>
                <button
                  type="button"
                  data-ui-action="checkin-beacon-stop"
                  onClick={() => setBeaconPersisted({ active: false, paused: false, intervalMinutes: beacon.intervalMinutes })}
                  style={{
                    minHeight: touchMin,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: `1px solid ${MUTED}`,
                    background: 'transparent',
                    color: MUTED,
                    cursor: 'pointer',
                    fontSize: touchFontSm,
                  }}
                >
                  Stop beacon
                </button>
              </>
            )}
          </div>
        </section>

        <section style={{ fontSize: touchFontSm, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            Outbox: <strong style={{ color: '#c5dce8' }}>{outboxCount}</strong> pending
          </div>
          <button
            type="button"
            data-ui-action="checkin-flush-outbox"
            disabled={outboxCount === 0 || flushing || !navigator.onLine}
            onClick={() => void onFlush()}
            style={{
              alignSelf: 'flex-start',
              minHeight: 40,
              padding: '0 12px',
              borderRadius: 8,
              border: `1px solid #7eb8ff66`,
              background: 'rgba(80, 120, 160, 0.2)',
              color: '#b8dcff',
              cursor: outboxCount && navigator.onLine && !flushing ? 'pointer' : 'not-allowed',
              fontSize: touchFontSm,
            }}
          >
            {flushing ? 'Sending queued…' : 'Send queued now'}
          </button>
        </section>

        {statusLine ? (
          <div style={{ fontSize: touchFontSm, color: '#c5dce8', borderTop: `1px solid ${ACCENT}22`, paddingTop: 8 }}>
            {statusLine}
          </div>
        ) : null}
      </div>
    </HudPanel>
  )
}
