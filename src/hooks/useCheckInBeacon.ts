import { useCallback, useEffect, useRef, useState } from 'react'
import { useGPS } from './useGPS'
import { ROUTINE_CHECKIN_SCHEMA } from '../lib/checkIn/routineCheckInTypes'
import type { RoutineCheckInContact, RoutineCheckInPayload } from '../lib/checkIn/routineCheckInTypes'
import { buildRescuePacket, resolveRapidEndpoint, resolveCheckInWebhook } from '../lib/rescue/buildRescuePacket'

export function useCheckInBeacon(getContacts: () => RoutineCheckInContact[]) {
  const gps = useGPS()
  const gpsRef = useRef(gps)
  gpsRef.current = gps
  const getContactsRef = useRef(getContacts)
  getContactsRef.current = getContacts

  const isFlushingRef = useRef(false)
  const PENDING_CHECKIN_KEY = 'hud_checkin_pending_checkin_v1'

  const readPendingPayload = useCallback((): RoutineCheckInPayload | null => {
    try {
      const raw = localStorage.getItem(PENDING_CHECKIN_KEY)
      if (!raw) return null
      return JSON.parse(raw) as RoutineCheckInPayload
    } catch {
      return null
    }
  }, [])

  const writePendingPayload = useCallback((payload: RoutineCheckInPayload): void => {
    try {
      localStorage.setItem(PENDING_CHECKIN_KEY, JSON.stringify(payload))
    } catch {
      /* noop */
    }
  }, [])

  const clearPendingPayload = useCallback((): void => {
    try {
      localStorage.removeItem(PENDING_CHECKIN_KEY)
    } catch {
      /* noop */
    }
  }, [])

  const [outboxCount, setOutboxCount] = useState(() => (readPendingPayload() ? 1 : 0))

  /**
   * 1. Low-level Logic Units (Foundational)
   */
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

  const refreshOutbox = useCallback(() => {
    setOutboxCount(readPendingPayload() ? 1 : 0)
  }, [readPendingPayload])

  const guardedFlush = useCallback(async () => {
    if (isFlushingRef.current) {
      return { sent: 0, remaining: readPendingPayload() ? 1 : 0 }
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { sent: 0, remaining: readPendingPayload() ? 1 : 0 }
    }
    const pending = readPendingPayload()
    if (!pending) return { sent: 0, remaining: 0 }

    isFlushingRef.current = true
    try {
      const ok = await performDirectDispatch(pending)
      if (ok) {
        clearPendingPayload()
        refreshOutbox()
        return { sent: 1, remaining: 0 }
      }
      return { sent: 0, remaining: 1 }
    } finally {
      isFlushingRef.current = false
    }
  }, [clearPendingPayload, readPendingPayload, refreshOutbox, performDirectDispatch])

  // 3. Lifecycle Effects
  useEffect(() => {
    const onOnline = () => {
      void guardedFlush()
    }
    window.addEventListener('online', onOnline)
    if (navigator.onLine) void guardedFlush() // Initial check if already online
    return () => window.removeEventListener('online', onOnline)
  }, [guardedFlush])

  /**
   * 4. Dispatch Callbacks (Dependent on logic units)
   */

  // Direct high-reliability dispatch: Signed HMAC POST to rapid endpoint or webhook.
  const performDirectDispatch = useCallback(async (payload: RoutineCheckInPayload): Promise<boolean> => {
    const rapidEndpoint = resolveRapidEndpoint()
    const checkinUrl = resolveCheckInWebhook()
    const note = payload.message ?? undefined

    const sendRescuePacket = async (endpoint: string): Promise<boolean> => {
      try {
        const packet = await buildRescuePacket('CHECKIN', {
          contacts: payload.contacts,
          note,
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
        if (res.ok) return true
      } catch {
        // Fall through to failure
      }
    }

    return false
  }, [])

  const sendManual = useCallback(
    async (message: string | null) => {
      const payload = buildPayload('manual', message)
      if (!payload) return { ok: false as const, error: 'no_fix_or_contacts' }
      
      // Phase 1: High-reliability direct dispatch (SOS-style)
      const dispatchOk = await performDirectDispatch(payload)
      if (dispatchOk) {
        await guardedFlush()
        return { ok: true as const, status: 'sent' as const, dispatchOk: true }
      }

      writePendingPayload(payload)
      refreshOutbox()
      return { ok: true as const, status: 'queued' as const, dispatchOk: false }
    },
    [buildPayload, guardedFlush, performDirectDispatch, refreshOutbox, writePendingPayload],
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
