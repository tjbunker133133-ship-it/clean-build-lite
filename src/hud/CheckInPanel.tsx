import React, { useEffect, useRef, useState } from 'react'
import HudPanel from './HudPanel'
import { useGPS } from '../hooks/useGPS'
import { useAppContext } from '../context/AppContext'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { traceAction } from '../runtime/actionTrace'
import { buildRescuePacket, applyCheckInNote, readCheckInNoteDraft, persistCheckInNoteDraft, CHECKIN_NOTE_MAX_CHARS, rescuePacketDevLogSummary } from '../lib/rescue/buildRescuePacket'
import { getRescueEligibility } from '../lib/rescue/eligibility'
import { useTacticalProfile } from '../hooks/useTacticalProfile'
import { hasRescueDispatchAuth } from '../lib/rescue/rescueDispatch'
import { postRescuePacket } from '../lib/rescue/postRescuePacket'
import { resolveRapidEndpoint } from '../lib/rescue/resolveRapidEndpoint'
import {
  touchFontSm,
  touchFontMd,
  touchGapMd,
  touchMinTarget,
} from './tokens'

export default function CheckInPanel() {
  useGPS()
  useAppContext()
  const { operationalReady, assessment } = useTacticalProfile()

  const mountedRef = useRef(true)
  const sendingRef = useRef(false)
  const [status, setStatus] = useState('READY')
  const [checkInNote, setCheckInNote] = useState(readCheckInNoteDraft)

  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const fontMd = touchFontMd(isMobile)
  const gapMd = touchGapMd(isMobile)
  const tapMin = touchMinTarget(isMobile)
  const buttonMinHeight = isMobile ? 64 : 44
  const buttonFontSize = isMobile ? 18 : 13
  const panelPadding = isMobile ? 16 : 12

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const safeSetStatus = (next: string) => {
    if (mountedRef.current) setStatus(next)
  }

  const sendCheckIn = async () => {
    traceAction('checkin_dispatch', 'handler_enter')
    if (sendingRef.current) {
      traceAction('checkin_dispatch', 'guard_reject', { reason: 'already_sending' })
      return
    }
    sendingRef.current = true
    safeSetStatus('BUILDING CHECK-IN…')
    try {
      traceAction('checkin_dispatch', 'async_start', { step: 'build_packet' })
      const basePacket = await buildRescuePacket('CHECKIN')
      const packet = await applyCheckInNote(basePacket, checkInNote)
      const contactCount = packet.contacts.length
      const endpoint = resolveRapidEndpoint()

      if (import.meta.env.DEV) {
        console.log('[rescue] check-in send (redacted)', rescuePacketDevLogSummary(packet))
      }

      const eligibility = getRescueEligibility({
        contactCount,
        endpoint,
        profileOperational: operationalReady,
      })
      if (!eligibility.dispatchReady && eligibility.reason === 'profile_incomplete') {
        safeSetStatus('CHECK-IN BLOCKED — COMPLETE TACTICAL PROFILE IN PREFLIGHT')
        traceAction('checkin_dispatch', 'guard_reject', { reason: 'profile_incomplete' })
        return
      }
      if (!eligibility.dispatchReady && eligibility.reason === 'no_contacts') {
        safeSetStatus('CHECK-IN: NO CONTACTS FOUND')
        traceAction('checkin_dispatch', 'guard_reject', { reason: 'no_contacts' })
        return
      }
      if (!eligibility.dispatchReady && eligibility.reason === 'no_endpoint') {
        safeSetStatus(`CHECK-IN READY (${contactCount} CONTACTS) — NO ENDPOINT SET`)
        traceAction('checkin_dispatch', 'guard_reject', { reason: 'no_endpoint', contactCount })
        return
      }

      safeSetStatus('SENDING CHECK-IN…')
      traceAction('checkin_dispatch', 'async_start', {
        step: 'post_dispatch',
        contactCount,
        hasDispatchAuth: hasRescueDispatchAuth(),
        signed: Boolean(packet.signature),
      })

      const result = await postRescuePacket(packet, endpoint, 'CHECKIN')
      if (result.ok) {
        safeSetStatus(`CHECK-IN SENT TO ${contactCount} CONTACTS`)
        persistCheckInNoteDraft('')
        setCheckInNote('')
        traceAction('checkin_dispatch', 'async_complete', { status: result.status, contactCount })
      } else if (result.reason === 'http_error') {
        safeSetStatus(result.failure.operatorMessage)
        traceAction('checkin_dispatch', 'failure', {
          reason: 'http_error',
          status: result.failure.status,
          code: result.failure.code,
        })
      } else {
        safeSetStatus('CHECK-IN SEND FAILED (NETWORK)')
        traceAction('checkin_dispatch', 'failure', { reason: 'network_error' })
      }
    } finally {
      sendingRef.current = false
    }
  }

  return (
    <HudPanel
      panelId="checkin"
      title="CHECK-IN"
      initialPos={{ x: 1220, y: 340 }}
      initialWidth={280}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: gapMd,
          padding: panelPadding,
          fontSize: fontSm,
        }}
      >
        <div style={{ opacity: 0.85, lineHeight: 1.35 }}>
          One tap sends your current location to emergency contacts — same secure channel as SOS
          and Deadman. An optional note is included in the email time line.
        </div>
        {!operationalReady && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid rgba(255, 107, 135, 0.45)',
              background: 'rgba(48, 18, 22, 0.55)',
              color: '#ffd5dd',
              fontSize: fontSm,
              lineHeight: 1.35,
            }}
          >
            <strong>Setup incomplete</strong> — Check-In is disabled until your tactical profile is complete.
            {assessment.messages[0] ? ` ${assessment.messages[0]}` : ''}
          </div>
        )}
        <label style={{ display: 'grid', gap: 6, fontSize: fontSm, color: '#b8c4d8' }}>
          Note (optional)
          <input
            type="text"
            value={checkInNote}
            onChange={(e) => {
              const next = e.target.value.slice(0, CHECKIN_NOTE_MAX_CHARS)
              setCheckInNote(next)
              persistCheckInNoteDraft(next)
            }}
            maxLength={CHECKIN_NOTE_MAX_CHARS}
            placeholder="e.g. I'm fine — check this ridge"
            style={{
              background: '#151a22',
              color: '#e5f0ff',
              border: '1px solid #2b3340',
              borderRadius: 8,
              padding: '8px 10px',
              minHeight: Math.max(tapMin, 36),
              fontSize: fontSm,
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => void sendCheckIn()}
          disabled={!operationalReady}
          style={{
            minHeight: buttonMinHeight,
            minWidth: tapMin,
            width: '100%',
            fontSize: buttonFontSize,
            fontWeight: 700,
            letterSpacing: '0.04em',
            border: '1px solid rgba(120, 220, 160, 0.55)',
            borderRadius: 8,
            background: operationalReady
              ? 'linear-gradient(180deg, rgba(40, 90, 60, 0.95), rgba(20, 50, 35, 0.98))'
              : 'rgba(40, 40, 45, 0.9)',
            color: operationalReady ? '#d8ffe6' : '#9ea7a0',
            cursor: operationalReady ? 'pointer' : 'not-allowed',
            opacity: operationalReady ? 1 : 0.72,
          }}
        >
          {operationalReady ? 'SEND CHECK-IN' : 'CHECK-IN DISABLED — COMPLETE PROFILE'}
        </button>
        <div
          style={{
            fontSize: fontMd,
            fontWeight: 600,
            color: status.includes('FAILED') || status.includes('NO ') ? '#ff8fa3' : '#a8e6ff',
            minHeight: '1.4em',
          }}
        >
          {status}
        </div>
      </div>
    </HudPanel>
  )
}
