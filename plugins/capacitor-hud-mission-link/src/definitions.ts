export type MissionPayloadTransport = 'wifi-lan' | 'nearby' | 'unknown'

export type HudMissionLinkPlatformInfo = {
  available: boolean
  platform: string
  discoveryMethod?: string
}

export interface HudMissionLinkPlugin {
  getPlatformInfo(): Promise<HudMissionLinkPlatformInfo>
  startAdvertising(options: { joinCode: string; payload: string }): Promise<void>
  stopAdvertising(): Promise<void>
  startDiscovery(options: { joinCode: string }): Promise<void>
  stopDiscovery(): Promise<void>
  sendPayloadToHost(options: { host: string; port: number; payload: string }): Promise<void>
  sendNearbyPayload(options: { endpointId: string; payload: string }): Promise<void>
  addListener(
    eventName: 'payloadReceived',
    listenerFunc: (data: {
      joinCode: string
      payload: string
      fromAddress?: string
      fromPort?: number
      endpointId?: string
      transport?: MissionPayloadTransport
    }) => void,
  ): Promise<{ remove: () => Promise<void> }>
}
