/**
 * Soft runtime guardrails for field-proven Balanced features.
 * Logs only in DEV — never throws in production paths.
 */

import { useEffect } from 'react'
import {
  getMapInteractionSnapshot,
  subscribeMapInteraction,
} from '../../../lib/mapInteractionController'

const GUARDRAIL_TAG = '[BALANCED_SOFT_GUARDRAIL]'

export function logBalancedSoftGuardrail(
  feature: string,
  ok: boolean,
  detail?: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) return
  const payload = { feature, ok, ...detail }
  if (ok) {
    console.log(GUARDRAIL_TAG, payload)
  } else {
    console.warn(GUARDRAIL_TAG, payload)
  }
}

interface SoftGuardrailOptions {
  enabled?: boolean
}

export function useBalancedSoftGuardrails(options: SoftGuardrailOptions = {}): void {
  const { enabled = false } = options

  useEffect(() => {
    if (!enabled) return

    const verify = () => {
      const layer = document.querySelector('[data-balanced-layer][data-balanced-active="true"]')
      if (!layer) return

      const snapshot = getMapInteractionSnapshot()

      logBalancedSoftGuardrail('waypoint_drop_controls', Boolean(
        document.querySelector('[data-balanced-panel="waypoints"]') ||
        layer.getAttribute('data-balanced-tool') === 'waypoint',
      ))

      logBalancedSoftGuardrail('route_panel_clear', Boolean(
        document.querySelector('[data-testid="balanced-route-clear"]') ||
        document.querySelector('[data-balanced-panel="route"] button'),
      ), { routePanelVisible: Boolean(document.querySelector('[data-balanced-panel="route"]')) })

      logBalancedSoftGuardrail('waypoint_label_toggles', Boolean(
        document.querySelector('[data-testid="toggle-waypoint-labels"]') &&
        document.querySelector('[data-testid="toggle-waypoint-distances"]'),
      ), { waypointsPanelVisible: Boolean(document.querySelector('[data-balanced-panel="waypoints"]')) })

      if (snapshot.measurePoints.length >= 2) {
        logBalancedSoftGuardrail('measure_persisted', Boolean(
          document.querySelector('[data-testid="map-measure-readout"]') ||
          document.querySelector('[data-testid="map-measure-point-0"]'),
        ), { points: snapshot.measurePoints.length })
      }

      logBalancedSoftGuardrail('checkin_mission_separation', Boolean(
        document.querySelector('[data-balanced-sheet="checkin"]') === null ||
        document.querySelector('[data-balanced-sheet="mission"]') === null,
      ))
    }

    verify()
    const unsub = subscribeMapInteraction(verify)
    const timer = window.setInterval(verify, 8000)
    return () => {
      unsub()
      window.clearInterval(timer)
    }
  }, [enabled])
}

export default useBalancedSoftGuardrails
