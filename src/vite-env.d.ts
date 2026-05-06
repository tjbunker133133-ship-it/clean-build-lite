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