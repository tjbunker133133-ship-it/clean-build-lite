/**
 * ModernFieldPresence — primary environmental field overlay (immersive only).
 * Renders above substrate veil; procedural + tile field expression unified visually.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useMapContext } from '../../context/MapContext'
import { useHudPresentation } from '../../context/HudPresentationContext'
import { computeFieldState, FIELD_TILE_EXPRESSION_MIN } from '../../lib/fieldIntentModel'
import { getFieldIntent, subscribeFieldIntent } from '../../lib/fieldIntentStore'
import { RadarAtmosphericNoise } from './RadarAtmosphericNoise'
import { useModernSituational } from './ModernSituationalContext'

export function ModernFieldPresence() {
  const { mode } = useHudPresentation()
  const situational = useModernSituational()
  const { map } = useMapContext()
  const fieldIntent = useSyncExternalStore(subscribeFieldIntent, getFieldIntent)
  const fieldState = useMemo(() => computeFieldState(fieldIntent), [fieldIntent])
  const [mapZoom, setMapZoom] = useState(10)

  useEffect(() => {
    if (!map || mode !== 'immersive') return
    const sync = () => setMapZoom(map.getZoom())
    sync()
    map.on('zoom', sync)
    map.on('moveend', sync)
    return () => {
      map.off('zoom', sync)
      map.off('moveend', sync)
    }
  }, [map, mode])

  const zoomBand =
    mapZoom >= 14 ? 'street' as const
    : mapZoom >= 10 ? 'mid' as const
    : 'regional' as const

  if (mode !== 'immersive') return null
  if (situational.sensory.suppressDecor || situational.focus === 'emergency') return null

  return (
    <RadarAtmosphericNoise
      state={fieldState}
      proceduralOnly={fieldState.tileExpression < FIELD_TILE_EXPRESSION_MIN}
      zoomBand={zoomBand}
    />
  )
}

export default ModernFieldPresence
