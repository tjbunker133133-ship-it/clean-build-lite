import { useMemo } from 'react'
import HudPanel from './HudPanel'
import { useAppContext } from '../context/AppContext'
import type { WaypointType } from '../types'
import { formatDistance, haversineDistance, totalRouteDistance } from '../lib/haversine'

export default function WaypointTypePanel() {
  const {
    state,
    setPendingType,
    setNextWaypointLabel,
    setKeepWaypointToolArmed,
    setClearLabelAfterDrop,
    setShowMapLabels,
    setShowMapDistances,
  } = useAppContext()
  const {
    pendingWaypointType,
    waypoints,
    nextWaypointLabel,
    keepWaypointToolArmed,
    clearLabelAfterDrop,
    showMapLabels,
    showMapDistances,
  } = state
  const selectedType = pendingWaypointType
  const routeDistance = useMemo(
    () =>
      totalRouteDistance(
        waypoints.map((w) => ({ lat: w.lat, lng: w.lng })),
      ),
    [waypoints],
  )
  const legCount = Math.max(0, waypoints.length - 1)
  const armedType = selectedType === 'default' ? 'DISARMED' : selectedType.toUpperCase()

  const types: { key: WaypointType; label: string; color: string; icon: string }[] = [
    { key: 'water', label: 'Water', color: '#38bdf8', icon: '💧' },
    { key: 'camp', label: 'Camp', color: '#34d399', icon: '⛺' },
    { key: 'rest', label: 'Rest Stop', color: '#fbbf24', icon: '☕' },
    { key: 'finish', label: 'End Flag', color: '#f472b6', icon: '🏁' },
  ]

  return (
    <HudPanel
      panelId="waypoints"
      title="Waypoint type"
      initialPos={{ x: 20, y: 420 }}
      initialWidth={360}
      minHeight={72}
    >
      <div style={{ marginBottom: 8, fontSize: 11, color: '#9fb0c7' }}>
        Arm a waypoint type below. Placement is blocked while this panel is docked.
      </div>
      <div
        style={{
          marginBottom: 10,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          borderRadius: 999,
          border: selectedType === 'default' ? '1px solid #4b5563' : '1px solid #0ea5e9',
          background: selectedType === 'default'
            ? 'linear-gradient(180deg,#1b2028,#151920)'
            : 'linear-gradient(180deg,#08202d,#08151e)',
          color: selectedType === 'default' ? '#94a3b8' : '#7dd3fc',
          fontSize: 11,
          letterSpacing: '0.05em',
          fontWeight: 700,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: selectedType === 'default' ? '#6b7280' : '#22d3ee',
            boxShadow: selectedType === 'default' ? 'none' : '0 0 8px #22d3eeaa',
          }}
        />
        ARMED: {armedType}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 10,
        }}
      >
        {types.map((t) => {
          const active = selectedType === t.key

          return (
            <button
              key={t.key}
              type="button"
              data-no-drag
              onClick={() => setPendingType(t.key)}
              style={{
                padding: '9px 12px',
                borderRadius: 10,
                border: active ? `1px solid ${t.color}` : '1px solid #31363f',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                minHeight: 40,
                minWidth: 96,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: active
                  ? `linear-gradient(180deg, ${t.color}22, ${t.color}12)`
                  : 'linear-gradient(180deg, #1f232a, #161a20)',
                color: active ? t.color : '#d5dde7',
                boxShadow: active ? `0 0 14px ${t.color}55, inset 0 0 0 1px ${t.color}22` : 'inset 0 0 0 1px #00000022',
                transition: 'all .16s ease',
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          )
        })}
        <button
          type="button"
          data-no-drag
          onClick={() => setPendingType('default')}
          style={{
            padding: '9px 12px',
            borderRadius: 10,
            border: selectedType === 'default' ? '1px solid #94a3b8' : '1px solid #31363f',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            minHeight: 40,
            minWidth: 96,
            background: selectedType === 'default'
              ? 'linear-gradient(180deg, #94a3b833, #94a3b822)'
              : 'linear-gradient(180deg, #1f232a, #161a20)',
            color: selectedType === 'default' ? '#e2e8f0' : '#d5dde7',
          }}
        >
          Disarm
        </button>
      </div>
      <div style={{ marginBottom: 10, display: 'grid', gap: 8 }}>
        <label style={{ fontSize: 11, color: '#b8c4d8', display: 'grid', gap: 6 }}>
          Next waypoint label (optional)
          <input
            type="text"
            value={nextWaypointLabel}
            onChange={(e) => setNextWaypointLabel(e.target.value)}
            maxLength={64}
            placeholder="e.g. Water Cache Alpha"
            style={{
              background: '#151a22',
              color: '#e5f0ff',
              border: '1px solid #2b3340',
              borderRadius: 8,
              padding: '8px 10px',
              minHeight: 36,
            }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, color: '#b8c4d8', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={keepWaypointToolArmed}
              onChange={(e) => setKeepWaypointToolArmed(e.target.checked)}
            />
            Keep tool armed after drop
          </label>
          <label style={{ fontSize: 11, color: '#b8c4d8', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={clearLabelAfterDrop}
              onChange={(e) => setClearLabelAfterDrop(e.target.checked)}
            />
            Clear custom label after drop
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, color: '#b8c4d8', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={showMapLabels}
              onChange={(e) => setShowMapLabels(e.target.checked)}
            />
            Show labels on map
          </label>
          <label style={{ fontSize: 11, color: '#b8c4d8', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={showMapDistances}
              onChange={(e) => setShowMapDistances(e.target.checked)}
            />
            Show segment distances
          </label>
        </div>
      </div>
      <div
        style={{
          borderTop: '1px solid #2b3340',
          paddingTop: 8,
          fontSize: 12,
          lineHeight: 1.4,
          color: '#a7b4c8',
        }}
      >
        {waypoints.length < 2 ? (
          <div>Route distance: — (add 2+ points)</div>
        ) : (
          <>
            <div style={{ color: '#dbe8ff' }}>
              Route distance:{' '}
              <strong style={{ color: '#5eead4' }}>{formatDistance(routeDistance.miles)}</strong>{' '}
              <span style={{ color: '#93c5fd' }}>({Math.round(routeDistance.feet).toLocaleString()} ft)</span>
            </div>
            <div>
              Legs: <strong style={{ color: '#93c5fd' }}>{legCount}</strong> · Total points:{' '}
              <strong style={{ color: '#93c5fd' }}>{waypoints.length}</strong>
            </div>
            <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', borderTop: '1px solid #253041', paddingTop: 6 }}>
              {waypoints.map((wp, idx) => {
                const leg =
                  idx > 0
                    ? haversineDistance(
                        waypoints[idx - 1].lat,
                        waypoints[idx - 1].lng,
                        wp.lat,
                        wp.lng,
                      )
                    : null
                return (
                  <div
                    key={wp.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '3px 0',
                      fontSize: 11,
                    }}
                  >
                    <span style={{ color: '#d5dde7' }}>
                      {idx + 1}. {wp.label}
                    </span>
                    <span style={{ color: leg ? '#81f7dd' : '#64748b' }}>
                      {leg ? `${formatDistance(leg.miles)} (${Math.round(leg.feet).toLocaleString()} ft)` : 'START'}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </HudPanel>
  )
}
