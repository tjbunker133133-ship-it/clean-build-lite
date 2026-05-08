import { useAppContext } from '../context/AppContext'
import { useMapContext } from '../context/MapContext'
import type { LayerType } from '../types'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchGapSm, touchMinTarget } from './tokens'

const LAYERS: { id: LayerType; label: string }[] = [
  { id: 'streets', label: 'Streets' },
  { id: 'topo', label: 'Topo' },
  { id: 'outdoor', label: 'Outdoor' },
  { id: 'satellite', label: 'Satellite' },
]

export function LayerPanelBody() {
  const { state, setLayer } = useAppContext()
  const { activeLayer } = state
  const { status: mapStatus } = useMapContext()
  const mapBusy = mapStatus === 'initial'
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const gapSm = touchGapSm(isMobile)
  const tapMin = Math.max(touchMinTarget(isMobile), 48)

  return (
    <div
      role="group"
      aria-label="Basemap preset"
      aria-busy={mapBusy}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: gapSm,
        opacity: mapBusy ? 0.92 : 1,
        transition: 'opacity 160ms ease',
      }}
    >
      {LAYERS.map((layer) => {
        const active = activeLayer === layer.id
        const title =
          active && mapBusy ? `${layer.label} — loading map…` : `${layer.label} basemap`

        return (
          <button
            key={layer.id}
            type="button"
            data-no-drag
            aria-pressed={active}
            title={title}
            onClick={() => setLayer(layer.id)}
            style={{
              padding: '8px 10px',
              fontSize: fontSm,
              cursor: 'pointer',
              borderRadius: 4,
              border: active
                ? '1px solid rgba(199,206,198,0.65)'
                : '1px solid rgba(255,255,255,0.16)',
              background: active ? 'rgba(199,206,198,0.14)' : 'rgba(6,6,6,0.6)',
              color: active ? '#c7cec6' : '#aeb4ad',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.05em',
              textAlign: 'left',
              minHeight: tapMin,
              minWidth: tapMin,
            }}
          >
            {layer.label.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}
