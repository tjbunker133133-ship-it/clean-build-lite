/**
 * Minimal field drift — barely perceptible parallax on pan.
 */

import { useEffect, useRef, useState } from 'react'
import { useMapContext } from '../../context/MapContext'
import { useHudPresentation } from '../../context/HudPresentationContext'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { cssTransition } from '../../perception/motion/motionLanguage'

export function ModernFieldMotionLayer() {
  const { mode } = useHudPresentation()
  const { map } = useMapContext()
  const reducedMotion = useReducedMotion()
  const [shift, setShift] = useState({ x: 0, y: 0 })
  const prevRef = useRef<{ lng: number; lat: number } | null>(null)

  useEffect(() => {
    if (!map || mode !== 'immersive' || reducedMotion) {
      setShift({ x: 0, y: 0 })
      return
    }

    const onMove = () => {
      const center = map.getCenter()
      const prev = prevRef.current
      let x = 0
      let y = 0
      if (prev) {
        x = Math.max(-2, Math.min(2, (center.lng - prev.lng) * -6))
        y = Math.max(-2, Math.min(2, (center.lat - prev.lat) * 8))
      }
      prevRef.current = { lng: center.lng, lat: center.lat }
      setShift({ x, y })
    }

    map.on('move', onMove)
    return () => {
      map.off('move', onMove)
    }
  }, [map, mode, reducedMotion])

  if (mode !== 'immersive') return null

  return (
    <div
      data-modern-field-motion
      aria-hidden
      className="hud-pointer-pass-through"
      style={{
        transform: reducedMotion ? undefined : `translate(${shift.x}px, ${shift.y}px)`,
        transition: cssTransition('transform', 'atmospheric', { reducedMotion }),
        background: 'radial-gradient(ellipse 90% 70% at 50% 50%, rgba(72, 108, 148, 0.04) 0%, transparent 70%)',
        opacity: 0.4,
        mixBlendMode: 'soft-light',
      }}
    />
  )
}

export default ModernFieldMotionLayer
