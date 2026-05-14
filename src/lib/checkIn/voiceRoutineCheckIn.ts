import { fetchCheckInContacts } from './checkInContacts'
import type { CheckInContact } from './checkInContacts'
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

export async function getVoiceRoutineCheckInPayload(gps: VoiceCheckInGps): Promise<RoutineCheckInPayload | null> {
  if (gps.locationState !== 'granted') {
    return null
  }
  const { data: rows, error } = await fetchCheckInContacts()
  if (error && rows.length === 0) {
    return null
  }
  const contacts = toRoutineContacts(rows)
  if (!contacts.length) {
    return null
  }
  return {
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
}
