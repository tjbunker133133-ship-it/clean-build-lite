/// <reference types="vite/client" />

declare const __BUILD_ID__: string

declare module '*.css';
declare module 'virtual:pwa-register' {
  export function registerSW(options?: {
    immediate?: boolean
    onNeedRefresh?: () => void
    onOfflineReady?: () => void
  }): () => void
}

interface ERLDevBridge {
  instance: import('./hud/modernMode/erl/EnvironmentalRelationshipLayer').EnvironmentalRelationshipLayer
  state: () => import('./hud/modernMode/erl/types').ERLState
  simulate: (
    snap: Partial<import('./hud/modernMode/erl/types').FIMRuntimeSnapshot>,
    patch?: import('./hud/modernMode/erl/types').ERLSimulationPatch,
  ) => void
  clear: () => void
  activate: () => void
  handleSOSArmed: () => void
}

interface Window {
  __erl?: ERLDevBridge
}