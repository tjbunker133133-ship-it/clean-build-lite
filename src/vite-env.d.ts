/// <reference types="vite/client" />

declare module '*.css';
declare module 'virtual:pwa-register' {
  export function registerSW(options?: { immediate?: boolean }): () => void
}