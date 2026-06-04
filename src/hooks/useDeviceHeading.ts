import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type CompassStatus,
  headingToCardinal,
  isCompassLevelOrientation,
  isCompassTiltUnreliable,
  quantizeHeading,
  resolveOrientationHeading,
  shouldPublishHeading,
  smoothHeading,
} from '../lib/deviceHeading'
import { getDeviceProfile } from '../runtime/deviceProfile'

export type DeviceHeadingState = {
  heading: number | null
  status: CompassStatus
  cardinal: string
}

/** Lower = steadier dial; level/edge orientations use heavier smoothing. */
const SMOOTH_FACTOR = getDeviceProfile().isIOS ? 0.09 : 0.12
const LEVEL_SMOOTH_FACTOR = 0.06
const EDGE_SMOOTH_FACTOR = 0.05

export function useDeviceHeading(): DeviceHeadingState {
  const [heading, setHeading] = useState<number | null>(null)
  const [status, setStatus] = useState<CompassStatus>('unavailable')
  const displayRef = useRef<number | null>(null)
  const lastPublishRef = useRef(0)
  const gotReadingRef = useRef(false)
  const tiltRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let mounted = true
    let fallbackTimer: number | null = null
    const isIOS = getDeviceProfile().isIOS
    let preferAbsoluteOnly = false

    const applyStatus = (next: CompassStatus) => {
      if (!mounted) return
      setStatus(next)
    }

    const publishDisplay = (value: number) => {
      if (!mounted) return
      const quantized = quantizeHeading(value, getDeviceProfile().isIOS ? 5 : 3)
      displayRef.current = quantized
      setHeading(quantized)
      gotReadingRef.current = true
    }

    const ingestOrientation = (event: DeviceOrientationEvent) => {
      if (!isIOS && preferAbsoluteOnly && event.absolute !== true) return

      const beta = event.beta
      const gamma = event.gamma
      const edgeTilt = isCompassTiltUnreliable(beta, gamma)
      const level = isCompassLevelOrientation(beta, gamma)

      const raw = resolveOrientationHeading(event)
      if (raw == null) return

      if (event.absolute === true) preferAbsoluteOnly = true

      const smoothFactor = edgeTilt ? EDGE_SMOOTH_FACTOR : level ? LEVEL_SMOOTH_FACTOR : SMOOTH_FACTOR
      const display = displayRef.current
      const smoothed = display == null ? raw : smoothHeading(display, raw, smoothFactor)
      const now = performance.now()

      if (!shouldPublishHeading(display, smoothed, now, lastPublishRef.current)) return

      lastPublishRef.current = now
      publishDisplay(smoothed)

      if (edgeTilt) {
        if (!tiltRef.current) {
          tiltRef.current = true
          applyStatus('level')
        }
      } else if (level) {
        tiltRef.current = false
        applyStatus('level')
      } else {
        if (tiltRef.current) tiltRef.current = false
        applyStatus('active')
      }
    }

    if (isIOS) {
      window.addEventListener('deviceorientation', ingestOrientation as EventListener, {
        passive: true,
      })
    } else {
      window.addEventListener('deviceorientationabsolute', ingestOrientation as EventListener, {
        passive: true,
      })
      window.addEventListener('deviceorientation', ingestOrientation as EventListener, {
        passive: true,
      })
    }

    fallbackTimer = window.setTimeout(() => {
      if (!mounted || gotReadingRef.current) return
      applyStatus('unavailable')
      setHeading(null)
    }, 2500)

    return () => {
      mounted = false
      window.removeEventListener('deviceorientation', ingestOrientation as EventListener)
      window.removeEventListener('deviceorientationabsolute', ingestOrientation as EventListener)
      if (fallbackTimer != null) window.clearTimeout(fallbackTimer)
    }
  }, [])

  const cardinal = useMemo(() => {
    if (heading == null || status === 'unavailable') return '—'
    return headingToCardinal(heading)
  }, [heading, status])

  return { heading, status, cardinal }
}
