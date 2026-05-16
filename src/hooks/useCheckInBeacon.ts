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

  const isFlushingRef = useRef(false) // New ref to prevent concurrent flushes
  const [outboxCount, setOutboxCount] = useState(() => readCheckInOutbox().length)

  const refreshOutbox = useCallback(() => {
    setOutboxCount(readCheckInOutbox().length)
  }, [])

  // Guarded flush to prevent multiple concurrent executions
  const guardedFlush = useCallback(async () => {
    if (isFlushingRef.current) {
      // If already flushing, return a promise that resolves to a neutral state
      // to avoid double-counting or race conditions.
      return { sent: 0, remaining: readCheckInOutbox().length }
    }
    isFlushingRef.current = true
    try {
      const result = await flushRoutineCheckInOutbox()
      return result
    } finally {
      isFlushingRef.current = false
      refreshOutbox()
    }
  }, [refreshOutbox])

  useEffect(() => {
    const fn = () => refreshOutbox()
    window.addEventListener('hud:checkin-outbox-changed', fn)
    return () => window.removeEventListener('hud:checkin-outbox-changed', fn)
  }, [refreshOutbox])

  useEffect(() => {
    const onOnline = () => {
      void guardedFlush()
    }
    window.addEventListener('online', onOnline)
    if (navigator.onLine) void guardedFlush() // Initial check if already online
    return () => window.removeEventListener('online', onOnline)
  }, [guardedFlush])

  /**
   * Direct high-reliability dispatch transport. 
   * Signed HMAC POST to rapid endpoint or specific webhook.
   */
  const performDirectDispatch = useCallback(async (message: string | null): Promise<boolean> => {
    const rapidEndpoint = resolveRapidEndpoint()
    const checkinUrl = resolveCheckInWebhook()
    const contacts = getContactsRef.current()
    const payload = buildPayload('manual', message)
    if (!payload) return false

    const sendRescuePacket = async (endpoint: string): Promise<boolean> => {
      try {
        const packet = await buildRescuePacket('CHECKIN', {
          contacts,
          note: message || undefined,
        })
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(packet),
        })
        return res.ok
      } catch {
        return false
      }
    }

    if (rapidEndpoint) {
      const ok = await sendRescuePacket(rapidEndpoint)
      if (ok) return true
    }

    if (checkinUrl) {
      try {
        const res = await fetch(checkinUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
          mode: 'cors',
        })
        return res.ok
      } catch {
        return false
      }
    }

    return false
  }, [buildPayload])

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
      
      // Phase 1: High-reliability direct dispatch (SOS-style)
      const dispatchOk = await performDirectDispatch(message)
      if (dispatchOk) {
        refreshOutbox()
        return { ok: true as const, status: 'sent' as const, dispatchOk: true }
      }

      // Phase 2: Fallback to Routine Webhook / Queue path on failure or offline
      const r = await sendRoutineCheckInOrQueue(payload)
      refreshOutbox()
      return { ok: true as const, status: r.status, dispatchOk }
    },
    [buildPayload, refreshOutbox, performDirectDispatch],
  )

  const flushOutbox = useCallback(async () => {
    const r = await guardedFlush()
    return r
  }, [guardedFlush])

  return {
    outboxCount,
    refreshOutbox,
    sendManual,
    flushOutbox,
    buildPayload,
  }
}
