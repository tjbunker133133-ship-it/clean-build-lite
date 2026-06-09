import type { LayerType } from '../../types'

export type OperationalSessionPhase = 'idle' | 'planning' | 'navigating'

export type OperationalSession = {
  routeName: string
  phase: OperationalSessionPhase
  showLabels: boolean
  showDistances: boolean
  corridorEnabled: boolean
  corridorWidthM: number
  /** First-run Modern basemap preference applied */
  modernBasemapInitialized: boolean
  modernPreferredBasemap: LayerType
  /** First-run terrain/satellite immersive bootstrap */
  modernImmerseBootstrapped: boolean
}

export const DEFAULT_OPERATIONAL_SESSION: OperationalSession = {
  routeName: 'Field route',
  phase: 'idle',
  showLabels: true,
  showDistances: true,
  corridorEnabled: true,
  corridorWidthM: 400,
  modernBasemapInitialized: false,
  modernPreferredBasemap: 'satellite',
  modernImmerseBootstrapped: false,
}
