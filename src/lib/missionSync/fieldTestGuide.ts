/** Copy for common field test: phone walks, home tablet watches, optional Wi‑Fi teammate. */

export const FIELD_WALK_WATCHER_STEPS = [
  'Phone: Start field mission (you carry GPS on the walk).',
  'Phone: Share live map link → open on home tablet (one tap, no paste).',
  'Optional: same Wi‑Fi — Share join link for a teammate tablet (mesh).',
  'Walk with cell: watcher keeps your map via internet relay (tablet can stay on home Wi‑Fi).',
] as const

export function fieldWalkWatcherSummary(observerCount: number, meshPeers: number): string {
  const parts: string[] = []
  if (observerCount > 0) parts.push(`${observerCount} watcher${observerCount > 1 ? 's' : ''} live`)
  if (meshPeers > 0) parts.push(`${meshPeers} teammate${meshPeers > 1 ? 's' : ''} on mesh`)
  if (parts.length === 0) return 'Share watch link before you leave Wi‑Fi (or while on hotspot).'
  return parts.join(' · ')
}
