import { useCallback, useEffect, useRef, useState } from 'react'
import { useGPS } from './useGPS'
import { readCheckInOutbox } from '../lib/checkIn/checkInOutbox'
import {
  flushRoutineCheckInOutbox,
  sendRoutineCheckInOrQueue,
} from '../lib/checkIn/sendRoutineCheckInOrQueue'
import { ROUTINE_CHECKIN_SCHEMA } from '../lib/checkIn/routineCheckInTypes'
import type { RoutineCheckInContact, RoutineCheckInPayload } from '../lib/checkIn/routineCheckInTypes'
import {
  BEACON_INTERVAL_CHOICES,
  loadBeacon,
  saveBeacon,
  type BeaconPersistedState,
} from '../lib/checkIn/beaconPersisted'

export type { BeaconPersistedState }

export function useCheckInBeacon(getContacts: () => RoutineCheckInContact[]) {
  const gps = useGPS()
  const gpsRef = useRef(gps)
  gpsRef.current = gps
  const getContactsRef = useRef(getContacts)
  getContactsRef.current = getContacts

  const [beacon, setBeacon] = useState<BeaconPersistedState>(() => loadBeacon())
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
    const onSync = () => setBeacon(loadBeacon())
    window.addEventListener('hud:checkin-beacon-sync', onSync)
    return () => window.removeEventListener('hud:checkin-beacon-sync', onSync)
  }, [])

  useEffect(() => {
    const onOnline = () => {
      void flushRoutineCheckInOutbox().then(refreshOutbox)
    }
    window.addEventListener('online', onOnline)
    if (navigator.onLine) void flushRoutineCheckInOutbox().then(refreshOutbox)
    return () => window.removeEventListener('online', onOnline)
  }, [refreshOutbox])

  const setBeaconPersisted = useCallback((next: BeaconPersistedState) => {
    saveBeacon(next)
    setBeacon(next)
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

  useEffect(() => {
    if (!beacon.active || beacon.paused) return
    const ms = beacon.intervalMinutes * 60_000
    const tick = () => {
      const payload = buildPayload('beacon', null)
      if (!payload) return
      void sendRoutineCheckInOrQueue(payload).then(refreshOutbox)
    }
    const id = window.setInterval(tick, ms)
    return () => window.clearInterval(id)
  }, [beacon.active, beacon.paused, beacon.intervalMinutes, buildPayload, refreshOutbox])

  const sendManual = useCallback(
    async (message: string | null) => {
      const payload = buildPayload('manual', message)
      if (!payload) return { ok: false as const, error: 'no_fix_or_contacts' }
      const r = await sendRoutineCheckInOrQueue(payload)
      refreshOutbox()
      return { ok: true as const, status: r.status }
    },
    [buildPayload, refreshOutbox],
  )

  const flushOutbox = useCallback(async () => {
    const r = await flushRoutineCheckInOutbox()
    refreshOutbox()
    return r
  }, [refreshOutbox])

  return {
    beacon,
    setBeaconPersisted,
    intervalChoices: BEACON_INTERVAL_CHOICES,
    outboxCount,
    refreshOutbox,
    sendManual,
    flushOutbox,
    buildPayload,
  }
}
