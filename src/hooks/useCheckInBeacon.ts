import { useCallback, useEffect, useRef, useState } from 'react'
import { useGPS } from './useGPS'
import { readCheckInOutbox } from '../lib/checkIn/checkInOutbox'
import {
  flushRoutineCheckInOutbox,
  sendRoutineCheckInOrQueue,
} from '../lib/checkIn/sendRoutineCheckInOrQueue'
import { ROUTINE_CHECKIN_SCHEMA } from '../lib/checkIn/routineCheckInTypes'
import type { RoutineCheckInContact, RoutineCheckInPayload } from '../lib/checkIn/routineCheckInTypes'
import { buildRescuePacket, resolveRapidEndpoint, resolveCheckInWebhook } from '../lib/rescue/buildRescuePacket'

export function useCheckInBeacon(getContacts: () => RoutineCheckInContact[]) {
  const gps = useGPS()
  const gpsRef = useRef(gps)
  gpsRef.current = gps
  const getContactsRef = useRef(getContacts)
  getContactsRef.current = getContacts

  const [outboxCount, setOutboxCount] = useState(() => readCheckInOutbox().length)

  const refreshOutbox = useCallback(() => {
    setOutboxCount(readCheckInOutbox().length)
  }, [])

  useEffect(() => {
    const fn = () => refreshOutbox()
    window.addEventListener('hud:checkin-outbox-changed', fn)
    return () => window.removeEventListener('hud:checkin-outbox-changed', fn)
  }, [refreshOutbox])

  useEffect(() => {
    const onOnline = () => {
      void flushRoutineCheckInOutbox().then(refreshOutbox)
    }
    window.addEventListener('online', onOnline)
    if (navigator.onLine) void flushRoutineCheckInOutbox().then(refreshOutbox)
    return () => window.removeEventListener('online', onOnline)
  }, [refreshOutbox])

  /**
   * Direct high-reliability dispatch transport. 
   * Signed HMAC POST to rapid endpoint or specific webhook.
   */
  const performDirectDispatch = useCallback(async (message: string | null): Promise<boolean> => {
    const checkinUrl = resolveCheckInWebhook()
    const endpoint = checkinUrl || resolveRapidEndpoint()
    if (!endpoint) return false

    try {
      const contacts = getContactsRef.current()
      const packet = await buildRescuePacket('CHECKIN', {
        contacts,
        note: message || undefined
      })
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(packet)
      })
      return res.ok
    } catch (err) {
      return false
    }
  }, [])

  const buildPayload = useCallback(
    (kind: 'manual' | 'beacon', message: string | null): RoutineCheckInPayload | null => {
      const g = gpsRef.current
      if (g.lat == null || g.lng == null || g.locationState !== 'granted') return null
      const contacts = getContactsRef.current()
      if (!contacts.length) return null
      return {
        schema: ROUTINE_CHECKIN_SCHEMA,
        sentAt: Date.now(),
        kind,
        lat: g.lat,
        lng: g.lng,
        accuracyM: g.accuracy ?? null,
        elevationM: g.elevation ?? null,
        message: message?.trim() ? message.trim().slice(0, 160) : null,
        contacts,
      }
    },
    [],
  )

  const sendManual = useCallback(
    async (message: string | null) => {
      const payload = buildPayload('manual', message)
      if (!payload) return { ok: false as const, error: 'no_fix_or_contacts' }
      // Direct Outbound Flow
      const dispatchOk = await performDirectDispatch(message)
      const r = await sendRoutineCheckInOrQueue(payload)
      refreshOutbox()
      return { ok: true as const, status: r.status, dispatchOk }
    },
    [buildPayload, refreshOutbox, performDirectDispatch],
  )

  const flushOutbox = useCallback(async () => {
    const r = await flushRoutineCheckInOutbox()
    refreshOutbox()
    return r
  }, [refreshOutbox])

  return {
    outboxCount,
    refreshOutbox,
    sendManual,
    flushOutbox,
    buildPayload,
  }
}
