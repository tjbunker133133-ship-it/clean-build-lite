import { createRoot, type Root } from 'react-dom/client'
import { logWarn } from './logger'
import { updateOfflineReadiness, type OfflineMapTileReadiness } from './runtimeSnapshot'
import { OfflineReadinessBanner } from './OfflineReadinessBanner'

const MAP_HOST_HINTS = [
  'api.maptiler.com',
  'tiles.maptiler.com',
  'tile.openstreetmap.org',
  'mapbox.com',
  'tiles.mapbox.com',
]

function urlLooksLikeMapAsset(url: string): boolean {
  const u = url.toLowerCase()
  return MAP_HOST_HINTS.some((h) => u.includes(h))
}

function urlLooksLikeAppShell(url: string): boolean {
  const u = url.toLowerCase()
  return u.includes('index.html') || (u.includes('/assets/') && u.endsWith('.html'))
}

function classifyMapReadiness(uniqueMapUrls: number): OfflineMapTileReadiness {
  if (uniqueMapUrls === 0) return 'empty'
  if (uniqueMapUrls < 12) return 'low'
  return 'sufficient'
}

/**
 * Scans Cache Storage for precached shell + prior map traffic. Does not fetch the network.
 * Publishes into the runtime snapshot for UI / overlay / diagnostics.
 */
export async function assessOfflineReadinessAndPublish(): Promise<void> {
  const navigatorOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false
  const mapUrls = new Set<string>()
  let appShellLikelyCached = false

  try {
    if (typeof window !== 'undefined' && 'caches' in window && window.caches) {
      const names = await window.caches.keys()
      for (const name of names) {
        const cache = await window.caches.open(name)
        const keys = await cache.keys()
        for (const req of keys) {
          const raw = typeof req === 'string' ? req : req.url
          if (!raw) continue
          if (urlLooksLikeAppShell(raw)) appShellLikelyCached = true
          if (urlLooksLikeMapAsset(raw)) mapUrls.add(raw.split('?')[0] ?? raw)
        }
      }
    }
  } catch {
    // Cache API denied or broken — banner may still warn from offline + empty counts
  }

  const mapRelatedCacheEntryCount = mapUrls.size
  const mapTileReadiness = classifyMapReadiness(mapRelatedCacheEntryCount)

  let bannerMessage: string | null = null
  if (navigatorOffline) {
    if (mapTileReadiness === 'empty') {
      bannerMessage =
        'Offline: no cached map data found. The basemap may stay blank until you open this area with connectivity or preload tiles while online.'
    } else if (mapTileReadiness === 'low') {
      bannerMessage =
        'Offline: only a small map cache was found. Some zoom levels or regions may not load until you reconnect.'
    } else if (!appShellLikelyCached) {
      bannerMessage =
        'Offline: app shell cache looks thin. If the HUD fails to load after an update, reconnect once to refresh the install.'
    }
  }

  updateOfflineReadiness({
    assessed: true,
    assessedAt: Date.now(),
    mapRelatedCacheEntryCount,
    appShellLikelyCached,
    mapTileReadiness,
    bannerMessage,
    navigatorOffline,
  })

  if (bannerMessage) {
    logWarn('RUNTIME', 'offline readiness', {
      mapTileReadiness,
      mapRelatedCacheEntryCount,
      appShellLikelyCached,
    })
  }
}

let bannerRoot: Root | null = null

export function mountOfflineReadinessBanner(): void {
  if (typeof document === 'undefined') return
  if (bannerRoot) return
  let host = document.getElementById('hud-offline-readiness-root')
  if (!host) {
    host = document.createElement('div')
    host.id = 'hud-offline-readiness-root'
    document.body.appendChild(host)
  }
  bannerRoot = createRoot(host)
  bannerRoot.render(<OfflineReadinessBanner />)
}

export function installOfflineReadiness(): void {
  if (typeof window === 'undefined') return

  mountOfflineReadinessBanner()

  const run = () => void assessOfflineReadinessAndPublish()
  queueMicrotask(run)
  window.addEventListener('online', run)
  window.addEventListener('offline', run)
}
