/** Non-emergency routine location ping — never mixed with SOS / rescue payloads. */
export const ROUTINE_CHECKIN_SCHEMA = 'trailmap_routine_checkin_v1' as const

export type RoutineCheckInKind = 'manual' | 'beacon'

export type RoutineCheckInContact = {
  name: string
  email: string
}

export type RoutineCheckInPayload = {
  schema: typeof ROUTINE_CHECKIN_SCHEMA
  sentAt: number
  kind: RoutineCheckInKind
  lat: number
  lng: number
  accuracyM: number | null
  elevationM: number | null
  message: string | null
  contacts: RoutineCheckInContact[]
}
