import type { PendingMonitorJoin } from './monitorInviteUrl'
import { parseWatchMeLocation } from './monitorInviteUrl'

const STORAGE_KEY = 'hud_pending_monitor_join_v1'

export function captureMonitorJoinFromLocation(search = ''): PendingMonitorJoin | null {
  const pending = parseWatchMeLocation(
    search || (typeof window !== 'undefined' ? window.location.search : ''),
  )
  if (!pending) return null
  savePendingMonitorJoin(pending)
  return pending
}

export function savePendingMonitorJoin(pending: PendingMonitorJoin | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    if (!pending) {
      sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending))
  } catch {
    /* ignore */
  }
}

export function readPendingMonitorJoin(): PendingMonitorJoin | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingMonitorJoin
    if (parsed?.kind === 'bundle' && typeof parsed.encoded === 'string') {
      return { kind: 'bundle', encoded: parsed.encoded }
    }
    if (
      parsed?.kind === 'token' &&
      typeof parsed.missionId === 'string' &&
      typeof parsed.token === 'string'
    ) {
      return {
        kind: 'token',
        missionId: parsed.missionId,
        token: parsed.token,
        missionName: typeof parsed.missionName === 'string' ? parsed.missionName : undefined,
      }
    }
    return null
  } catch {
    return null
  }
}

export function clearPendingMonitorJoin(): void {
  savePendingMonitorJoin(null)
}

export function stripWatchMeParamsFromUrl(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (
    !url.searchParams.has('watch') &&
    !url.searchParams.has('mission') &&
    !url.searchParams.has('token')
  ) {
    return
  }
  url.searchParams.delete('watch')
  url.searchParams.delete('mission')
  url.searchParams.delete('token')
  url.searchParams.delete('name')
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState({}, '', next)
}
