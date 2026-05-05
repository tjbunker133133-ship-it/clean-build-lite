/**
 * useDeadMan.ts
 * Full deadman switch:
 *   - 4-hour default countdown
 *   - reset()  → restart from full 4 hours
 *   - extend() → +1 hour (once per reset cycle)
 *   - isCritical → true when ≤ 15 minutes remaining
 *   - isWarning  → true when ≤ 30 minutes remaining (matches original isWarning field)
 *   - isExpired  → true when hits 0
 *   - Persists expiry timestamp so page refresh doesn't reset
 *   - onExpire callback fires once when counter hits 0
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const STORAGE_KEY    = 'trailmap_deadman_v1'
const FULL_MS        = 4 * 60 * 60 * 1000   // 4 hours
const EXTEND_MS      = 60 * 60 * 1000        // +1 hour
const CRITICAL_MS    = 15 * 60 * 1000        // 15 min  → amber pulse
const WARNING_MS     = 30 * 60 * 1000        // 30 min  → warning state

interface Stored { expiresAt: number; extended: boolean }

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}
function save(d: Stored) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch {}
}
function clear() {
  try { localStorage.removeItem(STORAGE_KEY) } catch {}
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
  /** HH:MM:SS string */
  formattedTime: string
  reset:    () => void
  extend:   () => void
  activate: () => void
  deactivate: () => void
}

export function useDeadMan(onExpire?: () => void): UseDeadManReturn {
  const onExpireRef = useRef(onExpire)
  useEffect(() => { onExpireRef.current = onExpire })

  // ── Bootstrap from storage ───────────────────────────────────────────────
  const boot = () => {
    const stored = load()
    if (stored && stored.expiresAt > Date.now()) {
      return { expiresAt: stored.expiresAt, extended: stored.extended, active: true }
    }
    return { expiresAt: Date.now() + FULL_MS, extended: false, active: false }
  }

  const b = boot()
  const [expiresAt, setExpiresAt] = useState(b.expiresAt)
  const [extended,  setExtended]  = useState(b.extended)
  const [isActive,  setIsActive]  = useState(b.active)
  const [remainingMs, setRemainingMs] = useState(
    Math.max(0, b.expiresAt - Date.now())
  )

  const firedRef = useRef(false)

  // ── Tick every second ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) return
    const tick = () => {
      const rem = Math.max(0, expiresAt - Date.now())
      setRemainingMs(rem)
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
  useEffect(() => {
    if (isActive) save({ expiresAt, extended })
  }, [expiresAt, extended, isActive])

  // ── Actions ──────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    const newExpiry = Date.now() + FULL_MS
    firedRef.current = false
    setExpiresAt(newExpiry)
    setExtended(false)
    setIsActive(true)
    setRemainingMs(FULL_MS)
    save({ expiresAt: newExpiry, extended: false })
  }, [])

  const extend = useCallback(() => {
    if (extended) return
    setExpiresAt(prev => {
      const n = prev + EXTEND_MS
      save({ expiresAt: n, extended: true })
      return n
    })
    setExtended(true)
    setRemainingMs(prev => prev + EXTEND_MS)
  }, [extended])

  const activate = useCallback(() => {
    const newExpiry = Date.now() + FULL_MS
    setExpiresAt(newExpiry)
    setRemainingMs(FULL_MS)
    setIsActive(true)
    save({ expiresAt: newExpiry, extended: false })
  }, [])

  const deactivate = useCallback(() => {
    setIsActive(false)
    clear()
  }, [])

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
    hasExtended: extended, isActive, formattedTime,
    reset, extend, activate, deactivate,
  }
}
