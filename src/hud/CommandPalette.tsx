import { useEffect, useMemo, useState } from 'react'
import { useCockpit } from '../context/CockpitContext'
import { useMapContext } from '../context/MapContext'
import { useGPS } from '../hooks/useGPS'

type Action = { id: string; label: string; run: () => void }

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { map } = useMapContext()
  const gps = useGPS()
  const { setScreenHue, resetLayout, raisePanel, updatePanel } = useCockpit()

  const actions = useMemo<Action[]>(
    () => [
      {
        id: 'center',
        label: 'Center map on GPS',
        run: () => {
          if (!map || gps.lat == null || gps.lng == null) return
          map.easeTo({ center: [gps.lng, gps.lat], duration: 700, essential: true })
        },
      },
      {
        id: 'weather-refresh',
        label: 'Refresh weather now',
        run: () => window.dispatchEvent(new CustomEvent('hud:weather-refresh')),
      },
      { id: 'mode-low', label: 'Display mode: low light', run: () => setScreenHue('low_light') },
      { id: 'mode-red', label: 'Display mode: red tactical', run: () => setScreenHue('red_tactical') },
      { id: 'mode-bright', label: 'Display mode: bright day', run: () => setScreenHue('bright_day') },
      { id: 'layout-reset', label: 'Reset panel layout', run: () => resetLayout() },
      {
        id: 'open-weather',
        label: 'Open weather panel',
        run: () => {
          updatePanel('weather', { docked: false, minimized: false })
          raisePanel('weather')
        },
      },
      {
        id: 'open-location',
        label: 'Open location panel',
        run: () => {
          updatePanel('location', { docked: false, minimized: false })
          raisePanel('location')
        },
      },
      {
        id: 'open-voice',
        label: 'Open voice panel',
        run: () => {
          updatePanel('voice', { docked: false, minimized: false })
          raisePanel('voice')
        },
      },
    ],
    [gps.lat, gps.lng, map, raisePanel, resetLayout, setScreenHue, updatePanel],
  )

  const filtered = actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120000,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 80,
      }}
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(620px, 92vw)',
          borderRadius: 12,
          border: '1px solid rgba(199,206,198,0.35)',
          background: 'rgba(10,12,13,0.95)',
          boxShadow: '0 14px 42px rgba(0,0,0,0.5)',
          padding: 12,
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a command..."
          style={{
            width: '100%',
            minHeight: 42,
            borderRadius: 8,
            border: '1px solid rgba(199,206,198,0.3)',
            background: 'rgba(14,16,17,0.9)',
            color: '#d9e1d9',
            padding: '0 12px',
          }}
        />
        <div style={{ marginTop: 10, display: 'grid', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
          {filtered.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                a.run()
                setOpen(false)
              }}
              style={{
                minHeight: 38,
                borderRadius: 8,
                border: '1px solid rgba(199,206,198,0.22)',
                background: 'rgba(12,14,15,0.85)',
                color: '#b6c1b8',
                textAlign: 'left',
                padding: '0 10px',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
