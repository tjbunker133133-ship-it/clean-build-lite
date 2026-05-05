import HudPanel from './HudPanel'
import { useAppContext } from '../context/AppContext'
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

  return (
    <HudPanel
      panelId="layers"
      title="Base layers"
      initialPos={{ x: 16, y: 60 }}
      initialWidth={168}
      minHeight={200}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {LAYERS.map((layer) => {
          const active = activeLayer === layer.id

          return (
            <button
              key={layer.id}
              type="button"
              data-no-drag
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
