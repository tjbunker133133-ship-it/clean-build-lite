import { useAppContext } from '../context/AppContext'

export default function WaypointTypePanel() {
  const { state, setPendingType } = useAppContext()

  const active = state.pendingWaypointType

  const button = (type: 'camp' | 'water' | 'poi', label: string) => (
    <button
      onClick={() => setPendingType(type)}
      style={{
        padding: '8px 10px',
        margin: 4,
        borderRadius: 6,
        border: '1px solid #00E5FF',
        background: active === type ? '#00E5FF' : '#111',
        color: active === type ? '#000' : '#00E5FF',
        cursor: 'pointer',
        fontWeight: 'bold',
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      style={{
        position: 'absolute',
        top: 120,
        right: 10,
        zIndex: 1000,
        background: '#0f0f1a',
        padding: 10,
        borderRadius: 8,
        border: '1px solid #00E5FF',
      }}
    >
      <div style={{ marginBottom: 6, color: '#aaa', fontSize: 12 }}>
        Waypoint Type
      </div>

      {button('camp', '🏕 Camp')}
      {button('water', '💧 Water')}
      {button('poi', '📍 POI')}
    </div>
  )
}