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
  addListener(
    eventName: 'payloadReceived',
    listenerFunc: (data: { joinCode: string; payload: string; fromAddress?: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>
}
