import React, { type ReactNode, useEffect, useRef } from 'react'
import { useCockpit } from '../context/CockpitContext'
import { screenHueFilter } from '../lib/cockpitScreenHue'
import { subscribeRuntimeSnapshot } from '../runtime/runtimeSnapshot'

/** Wraps all HUD layers except the map. Display modes tint via `#display-mode-overlay` (no shell filter). */
export default function CockpitHudShell({ children }: { children: ReactNode }) {
  const { mapInteractionBlocked, prefs } = useCockpit()
  const shellRef = useRef<HTMLDivElement>(null)
  const lastWakeAtRef = useRef<number | null>(null)

  /**
   * Wake-word acknowledgement pulse — driven ONLY by `wakeWordDetectedAt`
   * in the runtime snapshot (set when VoicePanel's wake-word gate passes).
   * Imperative class toggle + CSS animationend: zero React state, no panel churn.
   */
  useEffect(() => {
    return subscribeRuntimeSnapshot((snap) => {
      const t = snap.wakeWordDetectedAt
      if (t == null || t === lastWakeAtRef.current) return
      lastWakeAtRef.current = t
      const el = shellRef.current
      if (!el) return
      el.classList.remove('hud-wake-ack')
      requestAnimationFrame(() => {
        el.classList.add('hud-wake-ack')
        const onEnd = () => {
          el.classList.remove('hud-wake-ack')
          el.removeEventListener('animationend', onEnd)
        }
        el.addEventListener('animationend', onEnd, { once: true })
      })
    })
  }, [])

  return (
    <div
      ref={shellRef}
      className="cockpit-hud-shell"
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
