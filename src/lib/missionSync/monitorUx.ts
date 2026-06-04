import { useMemo } from 'react'
import type { TeamPresence } from './types'
import { filterTeammatePresence } from './presence'

/** Primary field operator fix for monitor map follow (freshest valid teammate). */
export function pickMonitoredPresence(
  teamPresence: TeamPresence[],
  selfDeviceId: string,
  preferDeviceId?: string | null,
): TeamPresence | null {
  const teammates = filterTeammatePresence(teamPresence, selfDeviceId)
  if (teammates.length === 0) return null
  if (preferDeviceId) {
    const preferred = teammates.find((p) => p.deviceId === preferDeviceId)
    if (preferred) return preferred
  }
  return teammates.reduce((best, p) => (p.updatedAt >= best.updatedAt ? p : best))
}

export function formatPresenceAge(updatedAt: number, nowMs = Date.now()): string {
  const sec = Math.max(0, Math.round((nowMs - updatedAt) / 1000))
  if (sec < 8) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  return `${min}m ago`
}

export function monitorTransportLabel(
  transport: 'idle' | 'direct' | 'relay' | 'both',
): string {
  if (transport === 'both') return 'Direct + relay'
  if (transport === 'relay') return 'Internet relay'
  if (transport === 'direct') return 'Direct link'
  return 'Connecting…'
}
