/**
 * MissionSyncContext value churn audit — render/state discipline contract.
 * Documents what triggers full context consumer re-renders.
 * MissionSyncContext remains monolithic; mitigations are memo boundaries only.
 */

export type ChurnSeverity = 'high' | 'medium' | 'low'

export type ChurnHotspot = {
  id: string
  /** Context field or pattern. */
  surface: string
  /** State/events that invalidate the context value object. */
  triggers: string[]
  severity: ChurnSeverity
  /** Consumers most affected. */
  consumers: string[]
  remediation: string
  status: 'open' | 'mitigated' | 'accepted'
}

/**
 * Context value is a single useMemo — ANY dep change re-renders all useMissionSync() subscribers.
 * Mitigations: pre-memoize derived slices; stable useCallback for actions; avoid inline arrows in value.
 */
export const MISSION_SYNC_CONTEXT_CHURN_AUDIT: ChurnHotspot[] = [
  {
    id: 'monolithic-value',
    surface: 'MissionSyncContext.Provider value',
    triggers: ['Any of ~50 useMemo deps (peers, teamPresence, phase, lastNotice, …)'],
    severity: 'high',
    consumers: [
      'FieldStatusRail',
      'MissionLinkPanel',
      'MissionTeamComms',
      'TeamPresenceLayer',
      'VoicePanel',
      'NavigationHud',
    ],
    remediation:
      'Accepted: single provider by design. Do NOT split without explicit approval. Pre-memoize derived fields.',
    status: 'accepted',
  },
  {
    id: 'peer-fanout',
    surface: 'peers',
    triggers: ['onPeerConnected', 'onPeerDisconnected', 'presence GPS ~8s'],
    severity: 'high',
    consumers: ['TeamPresenceLayer', 'FieldStatusRail', 'MissionLinkPanel', 'MissionTeamComms'],
    remediation: 'Peers array replaces on each connect/disconnect — expected. Map layers should memo per-peer.',
    status: 'accepted',
  },
  {
    id: 'team-presence-tick',
    surface: 'teamPresence',
    triggers: ['PRESENCE_INTERVAL_MS publish', 'remote presence relay', 'GPS debounce'],
    severity: 'high',
    consumers: ['TeamPresenceLayer', 'MonitorMapFollow', 'FieldStatusRail'],
    remediation: 'Accepted for live map. Avoid adding heavy derive in render from teamPresence.',
    status: 'accepted',
  },
  {
    id: 'inline-filter-comms',
    surface: 'teamCheckIns / teamBursts',
    triggers: ['filterFreshCheckIns / filterRecentBursts on every value build'],
    severity: 'medium',
    consumers: ['MissionTeamComms', 'MissionLinkPanel'],
    remediation: 'Pre-memoize filtered arrays in provider — mitigated via missionSyncDerived.',
    status: 'mitigated',
  },
  {
    id: 'inline-qr-fit',
    surface: 'pendingOfferFitsQr / pendingAnswerFitsQr',
    triggers: ['packetFitsCompactQr / watchOfferFitsQr on every value build'],
    severity: 'low',
    consumers: ['MissionLinkPanel'],
    remediation: 'Pre-memoize QR fit booleans — mitigated via missionSyncDerived.',
    status: 'mitigated',
  },
  {
    id: 'inline-dismiss-notice',
    surface: 'dismissNotice',
    triggers: ['Inline arrow in value object'],
    severity: 'low',
    consumers: ['MissionLinkPanel'],
    remediation: 'useCallback dismissNotice — mitigated in provider.',
    status: 'mitigated',
  },
  {
    id: 'last-notice-toast',
    surface: 'lastNotice',
    triggers: ['notify() on mesh/relay/comms events'],
    severity: 'medium',
    consumers: ['All context subscribers'],
    remediation: 'Accepted: toast is mission-wide. Do not add lastNotice to unrelated derive chains.',
    status: 'accepted',
  },
  {
    id: 'join-code-signaling-call',
    surface: 'joinCodeSignalingAvailable',
    triggers: ['isJoinCodeSignalingAvailable() each value build'],
    severity: 'low',
    consumers: ['MissionLinkPanel'],
    remediation: 'Memoize once per env/session — mitigated in provider.',
    status: 'mitigated',
  },
]

export type ChurnAuditSummary = {
  total: number
  mitigated: number
  open: number
  accepted: number
  highSeverity: number
}

export function summarizeContextChurnAudit(
  audit: ChurnHotspot[] = MISSION_SYNC_CONTEXT_CHURN_AUDIT,
): ChurnAuditSummary {
  return {
    total: audit.length,
    mitigated: audit.filter((h) => h.status === 'mitigated').length,
    open: audit.filter((h) => h.status === 'open').length,
    accepted: audit.filter((h) => h.status === 'accepted').length,
    highSeverity: audit.filter((h) => h.severity === 'high').length,
  }
}
