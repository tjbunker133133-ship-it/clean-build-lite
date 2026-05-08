import { fetchCheckInContacts } from './checkInContacts'
import type { CheckInContact } from './checkInContacts'
import { sendRoutineCheckInOrQueue } from './sendRoutineCheckInOrQueue'
import { ROUTINE_CHECKIN_SCHEMA } from './routineCheckInTypes'
import type { RoutineCheckInContact, RoutineCheckInPayload } from './routineCheckInTypes'

function toRoutineContacts(rows: CheckInContact[]): RoutineCheckInContact[] {
  return rows.map((c) => ({ name: c.contact_name, email: c.email.trim().toLowerCase() }))
}

export type VoiceCheckInGps = {
  lat: number
  lng: number
  locationState: string
  accuracy: number | null
  elevation: number | null
}

export async function sendVoiceRoutineCheckIn(gps: VoiceCheckInGps): Promise<{ ok: boolean; message: string }> {
  if (gps.locationState !== 'granted') {
    return { ok: false, message: 'GPS permission required for check-in.' }
  }
  const { data: rows, error } = await fetchCheckInContacts()
  if (error && rows.length === 0) {
    return { ok: false, message: `Could not load check-in contacts: ${error.message}` }
  }
  const contacts = toRoutineContacts(rows)
  if (!contacts.length) {
    return { ok: false, message: 'No check-in contacts configured.' }
  }
  const payload: RoutineCheckInPayload = {
    schema: ROUTINE_CHECKIN_SCHEMA,
    sentAt: Date.now(),
    kind: 'manual',
    lat: gps.lat,
    lng: gps.lng,
    accuracyM: gps.accuracy ?? null,
    elevationM: gps.elevation ?? null,
    message: null,
    contacts,
  }
  const r = await sendRoutineCheckInOrQueue(payload)
  return {
    ok: true,
    message: r.status === 'sent' ? 'Check-in sent.' : 'Check-in queued for when you are online.',
  }
}
