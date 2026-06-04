/**
 * Mission link signaling transport priority (bundle exchange before WebRTC).
 * WebRTC data channel uses its own ICE path: LAN host candidates first, STUN/cellular last.
 */

export type MissionSignalingTransport = 'wifi-lan' | 'nearby' | 'share' | 'unknown' | 'idle'

export type MissionIcePreference = 'lan-first' | 'cellular-fallback'

export const SIGNALING_TRANSPORT_ORDER: MissionSignalingTransport[] = [
  'wifi-lan',
  'nearby',
  'share',
]

export function transportLabel(mode: MissionSignalingTransport): string {
  switch (mode) {
    case 'wifi-lan':
      return 'Wi‑Fi LAN'
    case 'nearby':
      return 'Bluetooth / Nearby'
    case 'share':
      return 'Manual share'
    case 'idle':
      return 'Not searching'
    default:
      return 'Link'
  }
}

export function transportPriorityRank(mode: MissionSignalingTransport): number {
  const idx = SIGNALING_TRANSPORT_ORDER.indexOf(mode)
  return idx >= 0 ? idx : 99
}

/** Prefer higher-priority (lower rank) transport updates for UI status. */
export function shouldPreferTransport(
  current: MissionSignalingTransport,
  next: MissionSignalingTransport,
): boolean {
  return transportPriorityRank(next) < transportPriorityRank(current)
}

export function icePathLabel(state: RTCPeerConnectionState | 'idle'): string {
  switch (state) {
    case 'connected':
      return 'Mesh connected'
    case 'connecting':
    case 'new':
      return 'Mesh connecting…'
    case 'disconnected':
      return 'Mesh reconnecting…'
    case 'failed':
      return 'Mesh interrupted'
    default:
      return 'Mesh idle'
  }
}
