import type { CommandDescriptor, CommandResult } from '../../hooks/useHudCommands'
import { ENVIRONMENTAL_OVERLAY_CATALOG, ENVIRONMENTAL_OVERLAY_IDS } from './catalog'
import type { EnvironmentalOverlayId } from './types'

const ok = (message: string): CommandResult => ({ ok: true, message })
const fail = (message: string): CommandResult => ({ ok: false, message })

/** Extra voice phrases beyond auto-generated show/hide lines. */
const OVERLAY_VOICE_ON: Partial<Record<EnvironmentalOverlayId, string[]>> = {
  fire_firms: ['show fire map', 'fire layer on', 'active fire layer'],
  relief_usgs: ['show relief', 'terrain shading on', 'shaded relief on'],
  forest_usfs: ['forest overlay on', 'show national forest'],
  public_lands: ['public lands on', 'federal lands on', 'blm lands on'],
  bike_paths: ['bike paths on', 'show bike paths', 'cycleways on'],
  abandoned_rail: ['abandoned rail on', 'show abandoned railways'],
  mines: ['mines overlay on', 'show mines'],
  hiking_trails: ['hiking trails on', 'hiking paths on', 'show hiking trails'],
}

const OVERLAY_VOICE_OFF: Partial<Record<EnvironmentalOverlayId, string[]>> = {
  fire_firms: ['hide fire map', 'fire layer off', 'active fire layer off'],
  relief_usgs: ['hide relief', 'terrain shading off'],
  forest_usfs: ['forest overlay off'],
  public_lands: ['public lands off', 'federal lands off'],
  bike_paths: ['bike paths off', 'hide bike paths'],
  abandoned_rail: ['abandoned rail off'],
  mines: ['mines overlay off'],
  hiking_trails: ['hiking trails off', 'hiking paths off'],
}

export type OverlayVoiceCommandDeps = {
  setEnabled: (id: EnvironmentalOverlayId, enabled: boolean) => { applied: boolean; error?: string }
  raiseLayersPanel: () => void
}

export function buildOverlayVoiceCommands(deps: OverlayVoiceCommandDeps): CommandDescriptor[] {
  const { setEnabled, raiseLayersPanel } = deps
  const cmds: CommandDescriptor[] = [
    {
      id: 'map layers panel',
      label: 'Open map & display panel',
      aliases: ['open map layers', 'layers panel', 'map display panel', 'map panel'],
      paletteVisible: true,
      group: 'Map overlays',
      run: () => {
        raiseLayersPanel()
        return ok('Map and display panel opened. Toggle situational overlays there.')
      },
    },
    {
      id: 'hide all overlays',
      label: 'Turn off all situational overlays',
      aliases: ['clear overlays', 'all overlays off', 'overlays off'],
      group: 'Map overlays',
      run: () => {
        for (const id of ENVIRONMENTAL_OVERLAY_IDS) setEnabled(id, false)
        return ok('All situational overlays off.')
      },
    },
  ]

  const paletteVisibleOverlays = new Set<EnvironmentalOverlayId>([
    'fire_firms',
    'bike_paths',
    'hiking_trails',
  ])

  for (const def of ENVIRONMENTAL_OVERLAY_CATALOG) {
    const slug = def.id.replace(/_/g, ' ')
    const onExtra = OVERLAY_VOICE_ON[def.id] ?? []
    const offExtra = OVERLAY_VOICE_OFF[def.id] ?? []

    cmds.push({
      id: `overlay ${def.id} on`,
      label: `Overlay on: ${def.label}`,
      aliases: [`show ${slug}`, `${slug} on`, ...onExtra],
      paletteVisible: paletteVisibleOverlays.has(def.id),
      group: 'Map overlays',
      run: () => {
        const result = setEnabled(def.id, true)
        if (!result.applied) {
          return fail(result.error ?? `${def.label} could not be enabled.`)
        }
        return ok(`${def.label} overlay on.`)
      },
    })

    cmds.push({
      id: `overlay ${def.id} off`,
      label: `Overlay off: ${def.label}`,
      aliases: [`hide ${slug}`, `${slug} off`, ...offExtra],
      group: 'Map overlays',
      run: () => {
        setEnabled(def.id, false)
        return ok(`${def.label} overlay off.`)
      },
    })
  }

  return cmds
}
