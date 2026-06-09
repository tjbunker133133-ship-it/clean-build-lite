/**
 * Map interaction registry — mode roots register interaction authority.
 * MapCanvas reads this registry; it does not branch on presentation mode.
 */

export type MapInteractionOwnerId = 'modern' | 'balanced'

export type MapTapEvent = {
  lat: number
  lng: number
  source: 'click' | 'touch'
  waypointPlaced: boolean
}

export type MapInteractionOwner = {
  id: MapInteractionOwnerId
  /** When false, MapCanvas omits the user GPS marker. */
  showUserMarker: boolean
  /** Tap that did not commit waypoint/measure/trail inspect. */
  onIdleMapTap?: (event: MapTapEvent) => void
}

let activeOwner: MapInteractionOwner | null = null
const registryListeners = new Set<() => void>()

function notifyRegistryListeners(): void {
  registryListeners.forEach((fn) => fn())
}

export function subscribeMapInteractionRegistry(listener: () => void): () => void {
  registryListeners.add(listener)
  return () => {
    registryListeners.delete(listener)
  }
}

export function registerMapInteractionOwner(owner: MapInteractionOwner): () => void {
  if (import.meta.env.DEV && activeOwner && activeOwner.id !== owner.id) {
    throw new Error(
      `[MapInteractionRegistry] Owner collision: "${activeOwner.id}" already registered; "${owner.id}" attempted mount`,
    )
  }
  activeOwner = owner
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-map-interaction-owner', owner.id)
  }
  notifyRegistryListeners()
  return () => {
    if (activeOwner?.id === owner.id) {
      activeOwner = null
      if (typeof document !== 'undefined') {
        document.documentElement.removeAttribute('data-map-interaction-owner')
      }
      notifyRegistryListeners()
    }
  }
}

export function getMapInteractionOwner(): MapInteractionOwner | null {
  return activeOwner
}

export function notifyIdleMapTap(event: MapTapEvent): void {
  activeOwner?.onIdleMapTap?.(event)
}

export function shouldShowUserMarker(): boolean {
  return activeOwner?.showUserMarker ?? true
}

export function publishMapInteractionRegistryApi(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & {
    __HUD_MAP_INTERACTION__?: {
      owner: () => MapInteractionOwner | null
      shouldShowUserMarker: typeof shouldShowUserMarker
    }
  }
  w.__HUD_MAP_INTERACTION__ = {
    owner: getMapInteractionOwner,
    shouldShowUserMarker,
  }
}
