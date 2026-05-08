import type { CockpitPanelRect } from '../types/cockpit'

type PanelMap = Record<string, CockpitPanelRect>

type OpenContactConfigArgs = {
  source: 'deadman' | 'sos' | 'voice' | 'other'
  panels: PanelMap
  updatePanel: (id: string, patch: Partial<CockpitPanelRect>) => void
  raisePanel: (id: string) => void
}

export function openContactConfig({
  source,
  panels,
  updatePanel,
  raisePanel,
}: OpenContactConfigArgs): void {
  const preflight = panels.preflight
  const nextZ = Math.max(400, ...Object.values(panels).map((p) => p.z)) + 1
  const stateBefore = preflight
    ? {
        docked: preflight.docked,
        minimized: preflight.minimized,
        x: preflight.x,
        y: preflight.y,
        z: preflight.z,
      }
    : null

  updatePanel('preflight', {
    docked: false,
    minimized: false,
    x: preflight?.x ?? 16,
    y: preflight?.y ?? 72,
    z: nextZ,
  })
  raisePanel('preflight')

  console.log('[ContactConfig]', {
    source,
    handlerExists: true,
    functionExists: typeof openContactConfig === 'function',
    stateBefore,
    stateAfter: {
      docked: false,
      minimized: false,
      x: preflight?.x ?? 16,
      y: preflight?.y ?? 72,
      z: nextZ,
    },
    modalMounted: Boolean(preflight),
    navigationAttempted: false,
  })

  window.dispatchEvent(
    new CustomEvent('hud:contact-config-opened', {
      detail: {
        source,
        stateBefore,
        stateAfter: {
          docked: false,
          minimized: false,
          x: preflight?.x ?? 16,
          y: preflight?.y ?? 72,
          z: nextZ,
        },
      },
    }),
  )
}

