/**
 * useDeadMan.ts
 * Full deadman switch:
 *   - 2-hour default countdown
 *   - reset()  → restart from configured duration
 *   - extend() → +1 hour (repeatable)
 *   - isCritical → true when ≤ 15 minutes remaining
 *   - isWarning  → true when ≤ 30 minutes remaining (matches original isWarning field)
 *   - isExpired  → true when hits 0
 *   - Persists expiry timestamp so page refresh doesn't reset
 *   - onExpire callback fires once when counter hits 0
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

const STORAGE_KEY = 'trailmap_deadman_v1'
const FULL_MS        = 2 * 60 * 60 * 1000   // 2 hours default
const EXTEND_MS      = 60 * 60 * 1000        // +1 hour
const CRITICAL_MS    = 15 * 60 * 1000        // 15 min  → amber pulse
const WARNING_MS     = 30 * 60 * 1000        // 30 min  → warning state
const MIN_DURATION_MIN = 15
const MAX_DURATION_MIN = 48 * 60

interface Stored {
  expiresAt: number
  extended: boolean
  durationMs?: number
}

/**
 * Validates persisted `trailmap_deadman_v1` JSON. Malformed storage,
 * NaN poisoning, or non-finite numbers must NOT reach React state —
 * they would corrupt remaining-time math and UI.
 * Exported for Vitest contract locking only.
 */
export function parseDeadManStorageRaw(raw: string | null): Stored | null {
  if (raw == null || raw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  const rawExp = o.expiresAt
  let expiresAt: number
  if (typeof rawExp === 'number' && Number.isFinite(rawExp)) {
    expiresAt = rawExp
  } else if (typeof rawExp === 'string' && rawExp.trim() !== '') {
    const n = Number(rawExp)
    if (!Number.isFinite(n)) return null
    expiresAt = n
  } else {
    return null
  }
  const extended = typeof o.extended === 'boolean' ? o.extended : false
  let durationMs: number | undefined
  if (o.durationMs !== undefined) {
    if (typeof o.durationMs !== 'number' || !Number.isFinite(o.durationMs)) {
      durationMs = undefined
    } else {
      durationMs = o.durationMs
    }
  }
  return { expiresAt, extended, durationMs }
}

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return parseDeadManStorageRaw(raw)
  } catch {
    return null
  }
}
function save(d: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d))
  } catch (error) {
    console.warn('[localStorage] deadman save failed', { key: STORAGE_KEY, error })
  }
}
function clear() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.warn('[localStorage] deadman clear failed', { key: STORAGE_KEY, error })
  }
}

export interface UseDeadManReturn {
  /** Remaining milliseconds */
  remainingMs:  number
  /** Remaining seconds — kept for backward compat with existing UI */
  timeLeft:     number
  isCritical:   boolean
  isWarning:    boolean
  isExpired:    boolean
  hasExtended:  boolean
  isActive:     boolean
  expiresAt:    number
  durationMs:   number
  /** HH:MM:SS string */
  formattedTime: string
  reset:    () => void
  extend:   () => void
  activate: () => void
  deactivate: () => void
  setDurationMinutes: (minutes: number) => void
}

export function useDeadMan(onExpire?: () => void): UseDeadManReturn {
  const onExpireRef = useRef(onExpire)
  useEffect(() => { onExpireRef.current = onExpire })

  // ── Bootstrap from storage ───────────────────────────────────────────────
  // CONTRACT-SENSITIVE (long-runtime resilience): `boot()` parses localStorage
  // and is only meaningful on mount — the values it returns seed `useState`
  // and are ignored on every subsequent render. Memoizing prevents N×
  // localStorage reads per second once the tick effect drives re-renders.
  const boot = () => {
    const stored = load()
    const safeDuration =
      typeof stored?.durationMs === 'number' && Number.isFinite(stored.durationMs)
        ? Math.max(MIN_DURATION_MIN * 60_000, Math.min(MAX_DURATION_MIN * 60_000, stored.durationMs))
        : FULL_MS
    if (stored && stored.expiresAt > Date.now()) {
      return { expiresAt: stored.expiresAt, extended: stored.extended, active: true, durationMs: safeDuration }
    }
    return { expiresAt: Date.now() + FULL_MS, extended: false, active: false, durationMs: safeDuration }
  }

  const b = useMemo(boot, [])
  const [expiresAt, setExpiresAt] = useState(b.expiresAt)
  const [extended,  setExtended]  = useState(b.extended)
  const [isActive,  setIsActive]  = useState(b.active)
  const [durationMs, setDurationMs] = useState(b.durationMs)
  const [remainingMs, setRemainingMs] = useState(
    Math.max(0, b.expiresAt - Date.now())
  )

  const firedRef = useRef(false)

  // ── Tick every second ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) return
    const tick = () => {
      const rem = Math.max(0, expiresAt - Date.now())
      setRemainingMs((prev) => (prev === rem ? prev : rem))
      if (rem === 0 && !firedRef.current) {
        firedRef.current = true
        onExpireRef.current?.()
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isActive, expiresAt])

  // ── Persist ──────────────────────────────────────────────────────────────
  // Only persist when timer is active. When deactivated, storage is cleared
  // and must NOT be re-written. This ensures deactivate() persists across reloads.
  useEffect(() => {
    if (isActive) {
      save({ expiresAt, extended, durationMs })
    }
  }, [expiresAt, extended, isActive, durationMs])

  // ── Actions ──────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    const newExpiry = Date.now() + durationMs
    firedRef.current = false
    setExpiresAt(newExpiry)
    setExtended(false)
    setIsActive(true)
    setRemainingMs(durationMs)
    save({ expiresAt: newExpiry, extended: false, durationMs })
  }, [durationMs])

  const extend = useCallback(() => {
    if (isActive) {
      setExtended(true)
      setExpiresAt((prev) => {
        const n = prev + EXTEND_MS
        save({ expiresAt: n, extended: true, durationMs })
        return n
      })
      setRemainingMs((prev) => prev + EXTEND_MS)
      return
    }
    const nextDurationMs = Math.min(durationMs + EXTEND_MS, MAX_DURATION_MIN * 60_000)
    setExtended(true)
    setDurationMs(nextDurationMs)
    setRemainingMs(nextDurationMs)
    const previewExpiry = Date.now() + nextDurationMs
    setExpiresAt(previewExpiry)
    save({ expiresAt: previewExpiry, extended: true, durationMs: nextDurationMs })
  }, [durationMs, isActive])

  const activate = useCallback(() => {
    const newExpiry = Date.now() + durationMs
    setExpiresAt(newExpiry)
    setRemainingMs(durationMs)
    setIsActive(true)
    setExtended(false)
    firedRef.current = false
    save({ expiresAt: newExpiry, extended: false, durationMs })
  }, [durationMs])

  const deactivate = useCallback(() => {
    setIsActive(false)
    clear()
  }, [])

  const setDurationMinutes = useCallback(
    (minutes: number) => {
      const clamped = Math.max(MIN_DURATION_MIN, Math.min(MAX_DURATION_MIN, Math.round(minutes)))
      const nextDurationMs = clamped * 60_000
      setDurationMs(nextDurationMs)
      if (!isActive) {
        const previewExpiry = Date.now() + nextDurationMs
        setExpiresAt(previewExpiry)
        setRemainingMs(nextDurationMs)
        save({ expiresAt: previewExpiry, extended, durationMs: nextDurationMs })
      } else {
        save({ expiresAt, extended, durationMs: nextDurationMs })
      }
    },
    [expiresAt, extended, isActive],
  )

  // ── Derived ──────────────────────────────────────────────────────────────
  const isCritical = isActive && remainingMs > 0 && remainingMs <= CRITICAL_MS
  const isWarning  = isActive && remainingMs > 0 && remainingMs <= WARNING_MS
  const isExpired  = isActive && remainingMs === 0
  const timeLeft   = Math.floor(remainingMs / 1000)   // seconds, backward compat

  const hh = Math.floor(remainingMs / 3_600_000)
  const mm = Math.floor((remainingMs % 3_600_000) / 60_000)
  const ss = Math.floor((remainingMs % 60_000) / 1000)
  const formattedTime = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`

  return {
    remainingMs, timeLeft, isCritical, isWarning, isExpired,
    hasExtended: extended, isActive, expiresAt, durationMs, formattedTime,
    reset, extend, activate, deactivate, setDurationMinutes,
  }
}
