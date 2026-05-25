export type RescueEligibilityReason =
  | 'ready'
  | 'no_contacts'
  | 'no_endpoint'
  | 'profile_incomplete'

export function getRescueEligibility(input: {
  contactCount: number
  endpoint: string
  /** When false, SOS / Deadman / Check-In dispatch is blocked. Defaults true for tests. */
  profileOperational?: boolean
}): { dispatchReady: boolean; reason: RescueEligibilityReason } {
  if (input.profileOperational === false) {
    return { dispatchReady: false, reason: 'profile_incomplete' }
  }
  if (input.contactCount <= 0) return { dispatchReady: false, reason: 'no_contacts' }
  if (!input.endpoint.trim()) return { dispatchReady: false, reason: 'no_endpoint' }
  return { dispatchReady: true, reason: 'ready' }
}
