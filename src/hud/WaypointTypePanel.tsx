import { useMemo } from 'react'
import HudPanel from './HudPanel'
import { useAppContext } from '../context/AppContext'
import { getDeviceProfile } from '../runtime/deviceProfile'
import {
  touchFontSm as touchFontSmFn,
  touchGapMd as touchGapMdFn,
  touchGapSm as touchGapSmFn,
  touchMinTarget as touchMinTargetFn,
} from './tokens'
import type { WaypointType } from '../types'
import { formatDistance, haversineDistance, totalRouteDistance } from '../lib/haversine'
import { tier1Debug } from '../lib/tier1DebugLog'

/** Water / Camp / Rest / End only — CLEAR ROUTE is a separate command button (not a waypoint type). */
type RouteTypeTile = { id: WaypointType; label: string; icon: string; color: string }

const ROUTE_TYPE_TILES: RouteTypeTile[] = [
  { id: 'water', label: 'Water', icon: '💧', color: '#38bdf8' },
  { id: 'camp', label: 'Camp', icon: '⛺', color: '#34d399' },
  { id: 'rest', label: 'Rest Stop', icon: '☕', color: '#fbbf24' },
  { id: 'finish', label: 'End Flag', icon: '🏁', color: '#f472b6' },
]

export default function WaypointTypePanel() {
  const {
    state,
    setPendingType,
    setNextWaypointLabel,
    setKeepWaypointToolArmed,
    setClearLabelAfterDrop,
    setShowMapLabels,
    setShowMapDistances,
    setSnapToTrail,
  } = useAppContext()
  const {
    pendingWaypointType,
    waypoints,
    nextWaypointLabel,
    keepWaypointToolArmed,
    clearLabelAfterDrop,
    showMapLabels,
    showMapDistances,
    snapToTrailEnabled,
    trailSnapAssistCapable,
  } = state
  const selectedType = pendingWaypointType
  const routeDistance = useMemo(
    () =>
      totalRouteDistance(
        waypoints.map((w) => ({ lat: w.lat, lng: w.lng })),
      ),
    [waypoints],
  )
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const gapMd = touchGapMdFn(isMobile)
  const gapSm = touchGapSmFn(isMobile)
  const tapMin = touchMinTargetFn(isMobile)
  const btnMin = (px: number) => Math.max(tapMin, px)
  const labelPx = (px: number) => Math.max(touchFontSmFn(isMobile), px)
  const legCount = Math.max(0, waypoints.length - 1)
  const armedType = selectedType === 'default' ? 'DISARMED' : selectedType.toUpperCase()

  function handleRouteTypeClick(item: RouteTypeTile) {
    setPendingType(item.id)
  }

  const clearRouteDockedBtn = (
    <button
      type="button"
      data-no-drag
      data-testid="waypoint-clear-route-docked"
      className="waypoint-clear"
      title="Clear entire route"
      aria-label="Clear entire route"
      disabled={waypoints.length === 0}
        onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        tier1Debug('waypoint', 'clear-route-click')
        ;(window as Window & { __FORCE_CLEAR_ROUTE__?: () => void }).__FORCE_CLEAR_ROUTE__?.()
      }}
      style={{
        minHeight: btnMin(28),
        padding: '4px 8px',
        borderRadius: 6,
        fontSize: labelPx(10),
        fontWeight: 800,
        letterSpacing: '0.08em',
        lineHeight: 1.2,
        minWidth: 72,
        background: '#ef4444',
        color: '#fff',
        border: '2px solid #fbbf24',
      }}
    >
      CLR
    </button>
  )

  return (
    <HudPanel
      panelId="waypoints"
      title="Waypoint type"
      initialPos={{ x: 20, y: 420 }}
      initialWidth={360}
      minHeight={72}
      dockedHeaderTrailing={clearRouteDockedBtn}
    >
      <div style={{ marginBottom: gapMd, fontSize: labelPx(11), color: '#9fb0c7' }}>
        Arm a waypoint type below. Placement is blocked while this panel is docked.
      </div>
      <div style={{ marginBottom: gapMd, fontSize: labelPx(10), color: '#94a3b8', lineHeight: 1.35 }}>
        <strong style={{ color: '#fca5a5' }}>CLEAR ROUTE</strong> (red/yellow) removes all pins — not a waypoint type.
      </div>
      <div
        style={{
          marginBottom: Math.max(gapMd, 10),
          display: 'inline-flex',
          alignItems: 'center',
          gap: gapMd,
          padding: '4px 8px',
          borderRadius: 999,
          border: selectedType === 'default' ? '1px solid #4b5563' : '1px solid #0ea5e9',
          background: selectedType === 'default'
            ? 'linear-gradient(180deg,#1b2028,#151920)'
            : 'linear-gradient(180deg,#08202d,#08151e)',
          color: selectedType === 'default' ? '#94a3b8' : '#7dd3fc',
          fontSize: labelPx(11),
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
          gap: gapMd,
          marginBottom: Math.max(gapMd, 10),
          alignItems: 'center',
        }}
      >
        {ROUTE_TYPE_TILES.map((item) => {
          const active = selectedType === item.id

          return (
            <button
              key={item.id}
              type="button"
              data-no-drag
              onClick={() => handleRouteTypeClick(item)}
              style={{
                padding: '9px 12px',
                borderRadius: 10,
                border: active ? `1px solid ${item.color}` : '1px solid #31363f',
                cursor: 'pointer',
                fontSize: labelPx(12),
                fontWeight: 600,
                minHeight: btnMin(40),
                minWidth: 96,
                display: 'inline-flex',
                alignItems: 'center',
                gap: gapMd,
                background: active
                  ? `linear-gradient(180deg, ${item.color}22, ${item.color}12)`
                  : 'linear-gradient(180deg, #1f232a, #161a20)',
                color: active ? item.color : '#d5dde7',
                boxShadow: active ? `0 0 14px ${item.color}55, inset 0 0 0 1px ${item.color}22` : 'inset 0 0 0 1px #00000022',
                transition: 'all .16s ease',
              }}
            >
              <span style={{ fontSize: labelPx(14), lineHeight: 1 }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          )
        })}

        <div
          style={{ marginTop: Math.max(gapMd, 10), width: '100%', flexBasis: '100%' }}
          data-no-drag
        >
          <button
            type="button"
            id="__FORCE_CLEAR_ROUTE__"
            data-no-drag
            style={{
              width: '100%',
              minHeight: btnMin(44),
              padding: '12px',
              background: 'red',
              color: 'white',
              fontWeight: 'bold',
              border: '2px solid yellow',
              zIndex: 9999,
            }}
            onClick={() => {
              ;(window as Window & { __FORCE_CLEAR_ROUTE__?: () => void }).__FORCE_CLEAR_ROUTE__?.()
            }}
          >
            🧹 CLEAR ROUTE
          </button>
        </div>

        <button
          type="button"
          data-no-drag
          onClick={() => setPendingType('default')}
          style={{
            padding: '9px 12px',
            borderRadius: 10,
            border: selectedType === 'default' ? '1px solid #94a3b8' : '1px solid #31363f',
            cursor: 'pointer',
            fontSize: labelPx(12),
            fontWeight: 600,
            minHeight: btnMin(40),
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
      <div style={{ marginBottom: Math.max(gapMd, 10), display: 'grid', gap: gapMd }}>
        <label style={{ fontSize: labelPx(11), color: '#b8c4d8', display: 'grid', gap: gapSm }}>
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
              minHeight: btnMin(36),
            }}
          />
        </label>
        <div style={{ display: 'flex', gap: gapMd, flexWrap: 'wrap' }}>
          <label style={{ fontSize: labelPx(11), color: '#b8c4d8', display: 'inline-flex', alignItems: 'center', gap: gapSm }}>
            <input
              type="checkbox"
              checked={keepWaypointToolArmed}
              onChange={(e) => setKeepWaypointToolArmed(e.target.checked)}
            />
            Keep tool armed after drop
          </label>
          <label style={{ fontSize: labelPx(11), color: '#b8c4d8', display: 'inline-flex', alignItems: 'center', gap: gapSm }}>
            <input
              type="checkbox"
              checked={clearLabelAfterDrop}
              onChange={(e) => setClearLabelAfterDrop(e.target.checked)}
            />
            Clear custom label after drop
          </label>
        </div>
        <div style={{ display: 'flex', gap: gapMd, flexWrap: 'wrap' }}>
          <label style={{ fontSize: labelPx(11), color: '#b8c4d8', display: 'inline-flex', alignItems: 'center', gap: gapSm }}>
            <input
              type="checkbox"
              checked={showMapLabels}
              onChange={(e) => setShowMapLabels(e.target.checked)}
            />
            Show labels on map
          </label>
          <label style={{ fontSize: labelPx(11), color: '#b8c4d8', display: 'inline-flex', alignItems: 'center', gap: gapSm }}>
            <input
              type="checkbox"
              checked={showMapDistances}
              onChange={(e) => setShowMapDistances(e.target.checked)}
            />
            Show segment distances
          </label>
          <label
            title={
              trailSnapAssistCapable
                ? 'Preview only — choose Use Snapped or Use Raw after each drop.'
                : 'Unavailable until the map loads vector trails at zoom 12+.'
            }
            style={{
              fontSize: labelPx(11),
              color: trailSnapAssistCapable ? '#b8c4d8' : '#64748b',
              display: 'inline-flex',
              alignItems: 'center',
              gap: gapSm,
              opacity: trailSnapAssistCapable ? 1 : 0.72,
            }}
          >
            <input
              type="checkbox"
              checked={snapToTrailEnabled}
              onChange={(e) => setSnapToTrail(e.target.checked)}
              data-testid="snap-to-trail-toggle"
              disabled={!trailSnapAssistCapable}
            />
            Snap To Trail
          </label>
        </div>
        {!trailSnapAssistCapable ? (
          <div style={{ fontSize: labelPx(10), color: '#64748b', marginTop: -gapSm, marginBottom: gapSm }}>
            Trail snap needs vector layers at zoom 12+.
          </div>
        ) : null}
      </div>
      <div
        style={{
          borderTop: '1px solid #2b3340',
          paddingTop: gapMd,
          fontSize: labelPx(12),
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
            <div style={{ marginTop: gapMd, maxHeight: 180, overflowY: 'auto', borderTop: '1px solid #253041', paddingTop: gapSm }}>
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
                      gap: gapMd,
                      padding: '3px 0',
                      fontSize: labelPx(11),
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
