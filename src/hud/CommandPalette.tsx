import { useEffect, useMemo, useState } from 'react'
import { useHudCommands } from '../hooks/useHudCommands'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontMd, touchGapSm, touchMinTarget } from './tokens'

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { commands, dispatch } = useHudCommands()

  // Same registry the voice layer uses; palette only surfaces commands marked
  // `paletteVisible` to keep the UI focused.
  const visible = useMemo(() => commands.filter((c) => c.paletteVisible), [commands])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return visible
    return visible.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.aliases ?? []).some((a) => a.includes(q)),
    )
  }, [query, visible])

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

  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontMd = touchFontMd(isMobile)
  const gapSm = touchGapSm(isMobile)
  const tapMin = touchMinTarget(isMobile)

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
            minHeight: Math.max(tapMin, 42),
            borderRadius: 8,
            border: '1px solid rgba(199,206,198,0.3)',
            background: 'rgba(14,16,17,0.9)',
            color: '#d9e1d9',
            padding: '0 12px',
            fontSize: fontMd,
          }}
        />
        <div style={{ marginTop: 10, display: 'grid', gap: gapSm, maxHeight: 360, overflowY: 'auto' }}>
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                void dispatch(c.id, 'ui')
                setOpen(false)
              }}
              style={{
                minHeight: tapMin,
                borderRadius: 8,
                border: '1px solid rgba(199,206,198,0.22)',
                background: 'rgba(12,14,15,0.85)',
                color: '#b6c1b8',
                textAlign: 'left',
                padding: '0 12px',
                cursor: 'pointer',
                fontSize: fontMd,
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
