/**
 * Light substrate veil — subtle edge grounding only.
 */

import { useEffect, useState } from 'react'
import { useMapContext } from '../../context/MapContext'
import { useHudPresentation } from '../../context/HudPresentationContext'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { cssTransition } from '../../perception/motion/motionLanguage'

type ZoomBand = 'street' | 'mid' | 'regional'

function zoomBand(zoom: number): ZoomBand {
  if (zoom >= 14) return 'street'
  if (zoom >= 10) return 'mid'
  return 'regional'
}

export function ModernSubstrateVeil() {
  const { mode } = useHudPresentation()
  const { map } = useMapContext()
  const reducedMotion = useReducedMotion()
  const [band, setBand] = useState<ZoomBand>('mid')

  useEffect(() => {
    if (!map || mode !== 'immersive') return
    const sync = () => {
      const next = zoomBand(map.getZoom())
      setBand(next)
      document.documentElement.setAttribute('data-modern-zoom', next)
    }
    sync()
    map.on('zoom', sync)
    map.on('moveend', sync)
    return () => {
      map.off('zoom', sync)
      map.off('moveend', sync)
      document.documentElement.removeAttribute('data-modern-zoom')
    }
  }, [map, mode])

  if (mode !== 'immersive') return null

  const edgeSoftness = band === 'street' ? 0.1 : band === 'mid' ? 0.08 : 0.06

  return (
    <div
      data-modern-substrate-veil
      aria-hidden
      className="hud-pointer-pass-through"
      style={{
        background: `radial-gradient(ellipse 120% 90% at 50% 48%, transparent 62%, rgba(8, 12, 18, ${edgeSoftness}) 100%)`,
        opacity: 0.55,
        transition: cssTransition('opacity', 'atmospheric', { reducedMotion }),
      }}
    />
  )
}

export default ModernSubstrateVeil
