/**
 * Capacitor native mission discovery (Android Play build).
 * Wi‑Fi LAN (NSD) + Google Nearby (Bluetooth / Wi‑Fi Direct) in parallel.
 */

export type MissionPayloadTransport = 'wifi-lan' | 'nearby' | 'unknown'

export type NativeLinkPlatform = {
  available: boolean
  platform: 'web' | 'android' | 'ios' | 'unknown'
  discoveryMethod: 'none' | 'android-nsd' | 'android-nsd-nearby'
}

export type NativePayloadEvent = {
  joinCode: string
  payload: string
  fromAddress?: string
  fromPort?: number
  endpointId?: string
  transport: MissionPayloadTransport
}

type Listener = (ev: NativePayloadEvent) => void

let platformCache: NativeLinkPlatform | null = null
const payloadListeners = new Set<Listener>()

function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } })
    .Capacitor
  return Boolean(cap?.isNativePlatform?.())
}

async function getPlugin() {
  if (!isCapacitorNative()) return null
  try {
    const mod = await import('@signal-one/capacitor-hud-mission-link')
    return mod.HudMissionLink
  } catch {
    return null
  }
}

export function clearNativeLinkPlatformCache(): void {
  platformCache = null
}

export async function getNativeLinkPlatform(): Promise<NativeLinkPlatform> {
  if (platformCache) return platformCache
  if (!isCapacitorNative()) {
    platformCache = { available: false, platform: 'web', discoveryMethod: 'none' }
    return platformCache
  }
  const plugin = await getPlugin()
  if (!plugin) {
    platformCache = { available: false, platform: 'unknown', discoveryMethod: 'none' }
    return platformCache
  }
  try {
    const info = await plugin.getPlatformInfo()
    const method = info.discoveryMethod ?? 'none'
    platformCache = {
      available: Boolean(info.available),
      platform: info.platform === 'android' ? 'android' : info.platform === 'ios' ? 'ios' : 'unknown',
      discoveryMethod:
        method === 'android-nsd-nearby'
          ? 'android-nsd-nearby'
          : method === 'android-nsd'
            ? 'android-nsd'
            : 'none',
    }
  } catch {
    platformCache = { available: false, platform: 'unknown', discoveryMethod: 'none' }
  }
  return platformCache
}

export function onNativePayload(listener: Listener): () => void {
  payloadListeners.add(listener)
  return () => payloadListeners.delete(listener)
}

function emitPayload(ev: NativePayloadEvent): void {
  for (const fn of payloadListeners) fn(ev)
}

let wired = false

/** Call once when mission sync mounts on native Android. */
export async function wireNativePayloadBridge(): Promise<void> {
  if (wired) return
  const plugin = await getPlugin()
  if (!plugin) return
  wired = true
  await plugin.addListener('payloadReceived', (data) => {
    const transport: MissionPayloadTransport =
      data.transport === 'nearby' ? 'nearby' : data.transport === 'wifi-lan' ? 'wifi-lan' : 'unknown'
    emitPayload({
      joinCode: data.joinCode,
      payload: data.payload,
      fromAddress: data.fromAddress,
      fromPort: data.fromPort,
      endpointId: data.endpointId,
      transport,
    })
  })
}

export async function nativeAdvertisePayload(joinCode: string, payload: string): Promise<boolean> {
  const plat = await getNativeLinkPlatform()
  if (!plat.available) return false
  const plugin = await getPlugin()
  if (!plugin) return false
  try {
    await plugin.startAdvertising({ joinCode, payload })
    return true
  } catch {
    return false
  }
}

export async function nativeStopAdvertise(): Promise<void> {
  const plugin = await getPlugin()
  if (!plugin) return
  try {
    await plugin.stopAdvertising()
  } catch {
    /* ignore */
  }
}

export async function nativeSendPayloadToHost(
  host: string,
  port: number,
  payload: string,
): Promise<boolean> {
  const plat = await getNativeLinkPlatform()
  if (!plat.available) return false
  const plugin = await getPlugin()
  if (!plugin) return false
  try {
    await plugin.sendPayloadToHost({ host, port, payload })
    return true
  } catch {
    return false
  }
}

export async function nativeSendNearbyPayload(endpointId: string, payload: string): Promise<boolean> {
  const plat = await getNativeLinkPlatform()
  if (!plat.available) return false
  const plugin = await getPlugin()
  if (!plugin) return false
  try {
    await plugin.sendNearbyPayload({ endpointId, payload })
    return true
  } catch {
    return false
  }
}

export async function nativeDiscoverMission(joinCode: string): Promise<boolean> {
  const plat = await getNativeLinkPlatform()
  if (!plat.available) return false
  const plugin = await getPlugin()
  if (!plugin) return false
  try {
    await plugin.startDiscovery({ joinCode })
    return true
  } catch {
    return false
  }
}

export async function nativeStopDiscovery(): Promise<void> {
  const plugin = await getPlugin()
  if (!plugin) return
  try {
    await plugin.stopDiscovery()
  } catch {
    /* ignore */
  }
}
