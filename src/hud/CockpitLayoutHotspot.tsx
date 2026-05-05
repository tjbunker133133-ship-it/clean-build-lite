import { useCockpit } from '../context/CockpitContext'

/**
 * Double-tap / double-click this chrome hit target (44×44 min) to reset layout.
 * Stand-in for "double tap empty grid" where map consumes gestures.
 */
export default function CockpitLayoutHotspot() {
  const { resetLayout } = useCockpit()

  return (
    <button
      type="button"
      title="Double-click to reset panel layout (also Ctrl+Shift+0)"
      aria-label="Reset cockpit layout"
      onDoubleClick={() => resetLayout()}
      style={{
        position: 'fixed',
        left: 8,
        bottom: 8,
        width: 44,
        height: 44,
        zIndex: 160,
        borderRadius: 8,
        border: '1px solid rgba(0,229,255,0.25)',
        background: 'rgba(0,0,0,0.35)',
        color: 'rgba(0,229,255,0.7)',
        cursor: 'pointer',
        fontSize: 18,
        lineHeight: 1,
        pointerEvents: 'auto',
      }}
    >
      ⟲
    </button>
  )
}
