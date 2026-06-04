import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type CompassStatus,
  headingDelta,
  headingToCardinal,
  isCompassTiltUnreliable,
  resolveOrientationHeading,
  shouldPublishHeading,
  smoothHeading,
} from '../lib/deviceHeading'

export type DeviceHeadingState = {
  heading: number | null
  status: CompassStatus
  cardinal: string
}

const SMOOTH_FACTOR = 0.28
const OUTLIER_DEG = 35

export function useDeviceHeading(): DeviceHeadingState {
  const [heading, setHeading] = useState<number | null>(null)
  const [status, setStatus] = useState<CompassStatus>('unavailable')
  const displayRef = useRef<number | null>(null)
  const lastRawRef = useRef<number | null>(null)
  const lastPublishRef = useRef(0)
  const gotReadingRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let mounted = true
    let fallbackTimer: number | null = null

    const applyStatus = (next: CompassStatus) => {
      if (!mounted) return
      setStatus(next)
    }

    const publishDisplay = (value: number) => {
      if (!mounted) return
      displayRef.current = value
      setHeading(value)
      gotReadingRef.current = true
      applyStatus('active')
    }

    const onOrientation = (event: DeviceOrientationEvent) => {
      if (isCompassTiltUnreliable(event.beta, event.gamma)) {
        applyStatus('level')
        return
      }

      const raw = resolveOrientationHeading(event)
      if (raw == null) return

      const lastRaw = lastRawRef.current
      if (lastRaw != null && Math.abs(headingDelta(lastRaw, raw)) > OUTLIER_DEG) {
        return
      }
      lastRawRef.current = raw

      const display = displayRef.current
      const smoothed = display == null ? raw : smoothHeading(display, raw, SMOOTH_FACTOR)
      const now = performance.now()

      if (!shouldPublishHeading(display, smoothed, now, lastPublishRef.current)) return

      lastPublishRef.current = now
      publishDisplay(smoothed)
    }

    const onAbsolute = (event: DeviceOrientationEvent) => {
      onOrientation(event)
    }

    window.addEventListener('deviceorientationabsolute', onAbsolute as EventListener, { passive: true })
    window.addEventListener('deviceorientation', onOrientation as EventListener, { passive: true })

    fallbackTimer = window.setTimeout(() => {
      if (!mounted || gotReadingRef.current) return
      applyStatus('unavailable')
      setHeading(null)
    }, 2000)

    return () => {
      mounted = false
      window.removeEventListener('deviceorientationabsolute', onAbsolute as EventListener)
      window.removeEventListener('deviceorientation', onOrientation as EventListener)
      if (fallbackTimer != null) window.clearTimeout(fallbackTimer)
    }
  }, [])

  const cardinal = useMemo(() => {
    if (status !== 'active' || heading == null) return '—'
    return headingToCardinal(heading)
  }, [heading, status])

  return { heading, status, cardinal }
}
