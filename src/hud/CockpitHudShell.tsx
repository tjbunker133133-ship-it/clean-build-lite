import React, { type ReactNode, useEffect, useRef } from 'react'
import { useCockpit } from '../context/CockpitContext'
import { screenHueFilter } from '../lib/cockpitScreenHue'
import { subscribeRuntimeSnapshot } from '../runtime/runtimeSnapshot'

/** Wraps all HUD layers except the map. Display modes tint via `#display-mode-overlay` (no shell filter). */
export default function CockpitHudShell({ children }: { children: ReactNode }) {
  const { mapInteractionBlocked, prefs } = useCockpit()
  const shellRef = useRef<HTMLDivElement>(null)
  const lastWakeAtRef = useRef<number | null>(null)
  const lastUiActionTsRef = useRef<number>(0)

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
      onClickCapture={(e) => {
        const target = e.target as HTMLElement | null
        if (!target) return
        const control = target.closest('button, [role="button"], input[type="checkbox"], input[type="radio"], input[type="range"], select')
        if (!control) return
        const now = Date.now()
        // Suppress accidental duplicate logs from nested click surfaces.
        if (now - lastUiActionTsRef.current < 80) return
        lastUiActionTsRef.current = now
        const el = control as HTMLElement
        const name =
          el.getAttribute('data-ui-action') ||
          el.getAttribute('aria-label') ||
          (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 64) ||
          el.getAttribute('id') ||
          el.tagName.toLowerCase()
        if (import.meta.env.DEV) console.log('[UI ACTION]', name)
      }}
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
