/**
 * useReducedMotion
 *
 * Reactive hook for prefers-reduced-motion media query.
 * Must be threaded through all Modern Layer animation systems.
 *
 * When true:
 *   - Skip enter keyframe animations (use opacity-only transitions)
 *   - Skip lightning pulses
 *   - Skip camera easing (use jumpTo or skip entirely)
 *   - Skip route glow pulses (show static)
 *   - Skip proximity ring animations
 *   - Retain atmospheric tints (non-kinetic, still meaningful)
 */

import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

export function useReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(QUERY).matches
  })

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return prefersReduced
}
