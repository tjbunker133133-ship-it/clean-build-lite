import HudPanel from './HudPanel'
import { useAppContext } from '../context/AppContext'
import { useMapContext } from '../context/MapContext'
import type { LayerType } from '../types'

const LAYERS: { id: LayerType; label: string }[] = [
  { id: 'streets', label: 'Streets' },
  { id: 'topo', label: 'Topo' },
  { id: 'outdoor', label: 'Outdoor' },
  { id: 'satellite', label: 'Satellite' },
]

export default function LayerPanel() {
  const { state, setLayer } = useAppContext()
  const { activeLayer } = state
  const { status: mapStatus } = useMapContext()
  const mapBusy = mapStatus === 'initial'

  return (
    <HudPanel
      panelId="layers"
      title="Base layers"
      initialPos={{ x: 16, y: 60 }}
      initialWidth={168}
      minHeight={200}
    >
      <div
        role="group"
        aria-label="Basemap preset"
        aria-busy={mapBusy}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          opacity: mapBusy ? 0.92 : 1,
          transition: 'opacity 160ms ease',
        }}
      >
        {LAYERS.map((layer) => {
          const active = activeLayer === layer.id
          const title =
            active && mapBusy
              ? `${layer.label} — loading map…`
              : `${layer.label} basemap`

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
                fontSize: 11,
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
                minHeight: 40,
              }}
            >
              {layer.label.toUpperCase()}
            </button>
          )
        })}
      </div>
    </HudPanel>
  )
}
