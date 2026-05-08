import { useCallback, useRef } from 'react'
import { useCockpit } from '../context/CockpitContext'

/**
 * Edge swipe targets (fluid tactile): both edges open the Situation (positional) hub.
 * Touch-first; narrow zones avoid stealing map pan.
 */
export default function CockpitEdgeZones() {
  const { raisePanel, updatePanel } = useCockpit()
  const edge = useRef({ active: false, edge: null as 'L' | 'R' | null, x0: 0, y0: 0 })

  const onTouchStart = useCallback((e: React.TouchEvent, side: 'L' | 'R') => {
    if (e.touches.length !== 1) return
    edge.current = {
      active: true,
      edge: side,
      x0: e.touches[0].clientX,
      y0: e.touches[0].clientY,
    }
  }, [])

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!edge.current.active || !edge.current.edge) return
      const t = e.changedTouches[0]
      const dx = t.clientX - edge.current.x0
      const dy = t.clientY - edge.current.y0
      edge.current.active = false
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy)) return
      if (edge.current.edge === 'L' && dx > 0) {
        updatePanel('positional', { minimized: false })
        raisePanel('positional')
      }
      if (edge.current.edge === 'R' && dx < 0) {
        updatePanel('positional', { minimized: false })
        raisePanel('positional')
      }
      edge.current.edge = null
    },
    [raisePanel, updatePanel],
  )

  return (
    <>
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: 0,
          top: 48,
          bottom: 80,
          width: 28,
          zIndex: 150,
          touchAction: 'pan-y',
          pointerEvents: 'auto',
        }}
        onTouchStart={(e) => onTouchStart(e, 'L')}
        onTouchEnd={onTouchEnd}
      />
      <div
        aria-hidden
        style={{
          position: 'fixed',
          right: 0,
          top: 48,
          bottom: 80,
          width: 28,
          zIndex: 150,
          touchAction: 'pan-y',
          pointerEvents: 'auto',
        }}
        onTouchStart={(e) => onTouchStart(e, 'R')}
        onTouchEnd={onTouchEnd}
      />
    </>
  )
}
