import { registerPlugin } from '@capacitor/core'
import type { HudMissionLinkPlugin } from './definitions'

export * from './definitions'

export const HudMissionLink = registerPlugin<HudMissionLinkPlugin>('HudMissionLink', {
  web: () => import('./web').then((m) => new m.HudMissionLinkWeb()),
})
