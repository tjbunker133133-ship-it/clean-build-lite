export type RescueEligibilityReason = 'ready' | 'no_contacts' | 'no_endpoint'

export function getRescueEligibility(input: {
  contactCount: number
  endpoint: string
}): { dispatchReady: boolean; reason: RescueEligibilityReason } {
  if (input.contactCount <= 0) return { dispatchReady: false, reason: 'no_contacts' }
  if (!input.endpoint.trim()) return { dispatchReady: false, reason: 'no_endpoint' }
  return { dispatchReady: true, reason: 'ready' }
}
