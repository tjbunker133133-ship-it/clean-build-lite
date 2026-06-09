/**
 * Soft runtime guardrails for Balanced interaction quality.
 * Logs pointer/stacking conflicts in DEV — never throws in production paths.
 */

import { useEffect } from 'react'

const PANEL_CLOSE_SELECTORS = [
  '[data-testid="balanced-route-panel-close"]',
  '[data-testid="balanced-waypoint-panel-close"]',
] as const

function probeClickability(selector: string): { ok: boolean; blocker?: string } {
  const el = document.querySelector(selector) as HTMLElement | null
  if (!el || el.offsetParent === null) return { ok: true }

  const rect = el.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const hit = document.elementFromPoint(cx, cy)
  if (!hit) return { ok: false, blocker: 'no-hit-target' }
  if (el === hit || el.contains(hit)) return { ok: true }

  const tag = hit.tagName.toLowerCase()
  const id = hit.id ? `#${hit.id}` : ''
  const testId = hit.getAttribute('data-testid')
  const marker = testId ? `[data-testid="${testId}"]` : `${tag}${id}`
  return { ok: false, blocker: marker }
}

export function useBalancedInteractionGuard(options: { enabled?: boolean } = {}): void {
  const { enabled = false } = options

  useEffect(() => {
    if (!enabled) return

    const run = () => {
      const layer = document.querySelector('[data-balanced-layer][data-balanced-active="true"]')
      if (!layer) return

      for (const selector of PANEL_CLOSE_SELECTORS) {
        const result = probeClickability(selector)
        if (!result.ok) {
          console.warn('[BALANCED_INTERACTION_GUARD] Close control obstructed', {
            selector,
            blocker: result.blocker,
          })
        }
      }
    }

    run()
    const timer = window.setInterval(run, 4000)
    return () => window.clearInterval(timer)
  }, [enabled])
}
