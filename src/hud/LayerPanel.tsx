import { useAppContext } from '../context/AppContext'

export default function LayerPanel() {
  const { baseLayer, setBaseLayer } = useAppContext()

  const LAYERS = [
    { id: 'streets', label: 'Streets' },
    { id: 'topo', label: 'Topo' },
    { id: 'outdoor', label: 'Outdoor' },
    { id: 'satellite', label: 'Satellite' },
  ]

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        left: 16,
        zIndex: 300,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'rgba(0,0,0,0.6)',
        padding: 10,
        borderRadius: 6,
        backdropFilter: 'blur(6px)',
      }}
    >
      {LAYERS.map((layer) => {
        const active = baseLayer === layer.id

        return (
          <button
            key={layer.id}
            onClick={() => setBaseLayer(layer.id as any)}
            style={{
              padding: '6px 10px',
              fontSize: 11,
              cursor: 'pointer',
              borderRadius: 4,
              border: active
                ? '1px solid #00ffaa'
                : '1px solid rgba(255,255,255,0.2)',
              background: active ? '#00ffaa22' : '#000a',
              color: active ? '#00ffaa' : '#ccc',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.05em',
              textAlign: 'left',
            }}
          >
            {layer.label.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}