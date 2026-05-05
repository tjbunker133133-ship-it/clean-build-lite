import React, { useMemo, type ReactNode } from 'react'
import { useCockpit } from '../context/CockpitContext'
import { screenHueFilter } from '../lib/cockpitScreenHue'

/** Wraps all HUD layers except the map so screen hue filters tactical chrome only. */
export default function CockpitHudShell({ children }: { children: ReactNode }) {
  const { prefs, mapInteractionBlocked } = useCockpit()
  const hue = useMemo(
    () => screenHueFilter(prefs.screen_hue, prefs),
    [prefs],
  )
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        pointerEvents: 'none',
        ...hue,
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
