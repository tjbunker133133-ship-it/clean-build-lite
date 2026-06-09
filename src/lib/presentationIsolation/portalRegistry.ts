/**
 * Portal ownership registry — tracks mounted portals per mode for cleanup verification.
 */

import type { ModeRootId } from './modeRoots'

export type PortalOwner = ModeRootId | 'global'

export type PortalEntry = {
  id: string
  owner: PortalOwner
  mountedAt: number
}

const registry = new Map<string, PortalEntry>()

export function registerPortal(id: string, owner: PortalOwner): void {
  registry.set(id, { id, owner, mountedAt: Date.now() })
  publishDiagnostics()
}

export function unregisterPortal(id: string): void {
  registry.delete(id)
  publishDiagnostics()
}

export function getActivePortals(): PortalEntry[] {
  return [...registry.values()]
}

export function getOrphanedPortals(activeMode: ModeRootId): PortalEntry[] {
  return getActivePortals().filter((p) => p.owner !== 'global' && p.owner !== activeMode)
}

export function clearPortalRegistry(): void {
  registry.clear()
  publishDiagnostics()
}

function publishDiagnostics(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & { __HUD_ISOLATION__?: Record<string, unknown> }
  w.__HUD_ISOLATION__ = {
    ...w.__HUD_ISOLATION__,
    portals: getActivePortals(),
    orphanedPortals: (active: ModeRootId) => getOrphanedPortals(active),
  }
}
