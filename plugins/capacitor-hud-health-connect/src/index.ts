import { registerPlugin } from '@capacitor/core'
import type { HudHealthConnectPlugin } from './definitions'

export * from './definitions'

export const HudHealthConnect = registerPlugin<HudHealthConnectPlugin>('HudHealthConnect', {
  web: () => import('./web').then((m) => new m.HudHealthConnectWeb()),
})
