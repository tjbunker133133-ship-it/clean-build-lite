import { isFieldSessionBackgrounded } from '../../runtime/fieldLifecycle'
import type { MissionSyncConnectionPhase } from './types'
import type { MissionMonitorTransport } from './monitorLive'
import { monitorTransportLabel } from './monitorUx'
import type { RelayLinkState } from './relayRecovery'
import { relayLinkStateDetail } from './relayRecovery'

export { isFieldSessionBackgrounded }

export type MemberConnectionStatus = {
  label: string
  live: boolean
  /** Secondary transport honesty line (relay-only, etc.). */
  supplement: string | null
}

export type ObserverConnectionStatus = {
  label: string
  live: boolean
  supplement: string | null
}

/** Field member mesh / relay connection label for FieldStatusRail. */
export function buildMemberConnectionStatus(args: {
  phase: MissionSyncConnectionPhase
  peerCount: number
  fieldMemberCount: number
  observerCallsigns: string[]
  teamCommsReady: boolean
  mapReady: boolean
}): MemberConnectionStatus {
  const meshConnected = args.phase === 'connected' && args.peerCount > 0

  if (meshConnected) {
    const watchBit =
      args.observerCallsigns.length > 0
        ? ` · ${args.observerCallsigns.join(', ')} watching`
        : ''
    return {
      label: `Mesh ${args.fieldMemberCount} teammate${args.fieldMemberCount === 1 ? '' : 's'}${watchBit}${args.mapReady ? ' · map' : ''}`,
      live: true,
      supplement: null,
    }
  }

  if (args.teamCommsReady && args.peerCount === 0) {
    return {
      label: 'Relay-only · internet link',
      live: true,
      supplement: 'No local mesh peers — comms via internet relay',
    }
  }

  if (args.phase === 'awaiting-host-answer') {
    return { label: 'Mesh pending', live: false, supplement: null }
  }

  if (args.observerCallsigns.length > 0) {
    return {
      label: `Watching · ${args.observerCallsigns.join(', ')}`,
      live: false,
      supplement: null,
    }
  }

  return {
    label: 'Mesh on — share join or watch link',
    live: false,
    supplement: null,
  }
}

/** Observer monitor connection label for FieldStatusRail. */
export function buildObserverConnectionStatus(args: {
  phase: MissionSyncConnectionPhase
  monitorLive: boolean
  monitorTargetCallsign: string
  teamCommsReady: boolean
  peerCount: number
  monitorTransport: MissionMonitorTransport
}): ObserverConnectionStatus {
  if (args.monitorLive) {
    const transport =
      args.monitorTransport !== 'idle'
        ? monitorTransportLabel(args.monitorTransport)
        : null
    return {
      label: `Monitor · ${args.monitorTargetCallsign}`,
      live: true,
      supplement: transport,
    }
  }

  if (args.phase === 'awaiting-host-answer' || args.phase === 'connecting') {
    return { label: 'Monitor connecting', live: false, supplement: null }
  }

  if (args.teamCommsReady && args.peerCount === 0) {
    return {
      label: 'Monitor · relay linked',
      live: false,
      supplement: 'Waiting for field update — not live yet',
    }
  }

  return { label: 'Monitor standby', live: false, supplement: null }
}

/** Relay degraded/unavailable supplement when mesh peers absent. */
export function buildRelayHealthSupplement(relayLinkState: RelayLinkState): string | null {
  return relayLinkStateDetail(relayLinkState)
}
