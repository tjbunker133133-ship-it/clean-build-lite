/** Copy for common field test: phone walks, home tablet watches, optional Wi‑Fi teammate. */

export const FIELD_WALK_WATCHER_STEPS = [
  'Phone: Start field mission (you carry GPS on the walk).',
  'Phone: Share live map link → open on home tablet (one tap, no paste).',
  'Optional: same Wi‑Fi / Bluetooth — Share join link for a teammate tablet (local mesh first).',
  'Walk with cell: mission stays linked over internet relay when Wi‑Fi/BT drops (both need service).',
  'Watcher sees every field device on the map (phone + teammate tablets).',
] as const

export function fieldWalkWatcherSummary(observerCount: number, meshPeers: number): string {
  const parts: string[] = []
  if (observerCount > 0) parts.push(`${observerCount} watcher${observerCount > 1 ? 's' : ''} live`)
  if (meshPeers > 0) parts.push(`${meshPeers} teammate${meshPeers > 1 ? 's' : ''} on mesh`)
  if (parts.length === 0) return 'Share watch link before you leave Wi‑Fi (or while on hotspot).'
  return parts.join(' · ')
}
