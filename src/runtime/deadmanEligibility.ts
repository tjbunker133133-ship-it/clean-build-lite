export type DeadmanDispatchReason =
  | 'ready'
  | 'already_dispatched'
  | 'already_sent_in_mount'
  | 'no_contacts'
  | 'no_endpoint'

export function classifyDeadmanDispatchEligibility(input: {
  alreadyDispatched: boolean
  alreadySentInMount: boolean
  contactCount: number
  endpoint: string
}): { dispatchReady: boolean; reason: DeadmanDispatchReason } {
  if (input.alreadyDispatched) return { dispatchReady: false, reason: 'already_dispatched' }
  if (input.alreadySentInMount) return { dispatchReady: false, reason: 'already_sent_in_mount' }
  if (input.contactCount <= 0) return { dispatchReady: false, reason: 'no_contacts' }
  if (!input.endpoint.trim()) return { dispatchReady: false, reason: 'no_endpoint' }
  return { dispatchReady: true, reason: 'ready' }
}

