import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { getDeviceProfile } from '../runtime/deviceProfile'

const DEFAULT_HOLD_MS = 3000

/** Android / legacy key codes for volume-up (not exposed on most mobile browsers). */
function isVolumeUpKey(e: KeyboardEvent): boolean {
  return (
    e.key === 'VolumeUp' ||
    e.code === 'AudioVolumeUp' ||
    e.keyCode === 24 ||
    (e as KeyboardEvent & { which?: number }).which === 24
  )
}

/**
 * Best-effort hardware shortcut: hold volume-up ~3s.
 * Rarely works in mobile Chrome/PWA — pair with `useLongPressVoiceArm` on a button.
 */
export function useVolumeUpVoiceArm(
  onHoldComplete: () => void,
  opts?: { enabled?: boolean; holdMs?: number },
): void {
  const holdMs = opts?.holdMs ?? DEFAULT_HOLD_MS
  const enabled = opts?.enabled ?? getDeviceProfile().interactionMode === 'mobile'
  const onHoldRef = useRef(onHoldComplete)
  const holdTimerRef = useRef<number | null>(null)
  const holdActiveRef = useRef(false)

  onHoldRef.current = onHoldComplete

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    const clearHold = () => {
      if (holdTimerRef.current != null) {
        window.clearTimeout(holdTimerRef.current)
        holdTimerRef.current = null
      }
      holdActiveRef.current = false
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isVolumeUpKey(e)) return
      if (e.repeat) return
      if (holdActiveRef.current) return
      holdActiveRef.current = true
      if (e.cancelable) e.preventDefault()
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null
        holdActiveRef.current = false
        onHoldRef.current()
      }, holdMs)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (!isVolumeUpKey(e)) return
      clearHold()
    }

    const onBlur = () => clearHold()

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      clearHold()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [enabled, holdMs])
}

/** Reliable field fallback: hold a panel button ~3s to arm voice (touch + mouse). */
export function useLongPressVoiceArm(
  onHoldComplete: () => void,
  opts?: { holdMs?: number },
): {
  onPointerDown: (e: ReactPointerEvent) => void
  onPointerUp: (e: ReactPointerEvent) => void
  onPointerCancel: (e: ReactPointerEvent) => void
} {
  const holdMs = opts?.holdMs ?? DEFAULT_HOLD_MS
  const onHoldRef = useRef(onHoldComplete)
  const timerRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)

  onHoldRef.current = onHoldComplete

  const clear = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pointerIdRef.current = null
  }

  return {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      clear()
      pointerIdRef.current = e.pointerId
      if (e.cancelable) e.preventDefault()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        pointerIdRef.current = null
        onHoldRef.current()
      }, holdMs)
    },
    onPointerUp: (e) => {
      if (pointerIdRef.current !== e.pointerId) return
      clear()
    },
    onPointerCancel: (e) => {
      if (pointerIdRef.current !== e.pointerId) return
      clear()
    },
  }
}
