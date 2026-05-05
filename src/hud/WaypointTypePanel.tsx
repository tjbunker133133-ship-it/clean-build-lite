import { useAppContext } from '../context/AppContext'

export default function WaypointTypePanel() {
  const ctx = useAppContext()

  const selectedType = ctx.selectedType ?? 'default'

  // tolerate BOTH possible API versions
  const setType =
    (ctx as any).setSelectedType ||
    (ctx as any).setPendingType ||
    (() => {})

  const types = [
    { key: 'default', label: 'POI', color: '#ff3b3b' },
    { key: 'camp', label: 'Camp', color: '#22c55e' },
    { key: 'water', label: 'Water', color: '#3b82f6' },
  ] as const

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        left: 20,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
        padding: '10px 12px',
        borderRadius: 10,
        display: 'flex',
        gap: 8,
      }}
    >
      {types.map((t) => {
        const active = selectedType === t.key

        return (
          <button
            key={t.key}
            onClick={() => setType(t.key)}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              background: active ? t.color : '#222',
              color: active ? '#000' : '#fff',
              boxShadow: active ? `0 0 6px ${t.color}` : 'none',
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}