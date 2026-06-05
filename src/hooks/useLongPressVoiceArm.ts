import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

const DEFAULT_HOLD_MS = 3000

/** Hold a panel button ~3s to arm hands-free voice (touch + mouse). */
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
