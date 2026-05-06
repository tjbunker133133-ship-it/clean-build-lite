import React, { type ReactNode } from 'react'
import { useCockpit } from '../context/CockpitContext'
import { screenHueFilter } from '../lib/cockpitScreenHue'

/** Wraps all HUD layers except the map. Display modes tint via `#display-mode-overlay` (no shell filter). */
export default function CockpitHudShell({ children }: { children: ReactNode }) {
  const { mapInteractionBlocked, prefs } = useCockpit()
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        pointerEvents: 'none',
        ...screenHueFilter(prefs.screen_hue, prefs),
      }}
    >
      {mapInteractionBlocked && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 99,
            pointerEvents: 'auto',
            touchAction: 'none',
            background: 'transparent',
          }}
        />
      )}
      {children}
    </div>
  )
}
