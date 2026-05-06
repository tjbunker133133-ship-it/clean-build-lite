import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_STAMP': JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['hud-icon.svg'],
      manifest: {
        name: 'Tactical HUD',
        short_name: 'TacticalHUD',
        description: 'Mobile tactical navigation HUD',
        theme_color: '#0a0c0d',
        background_color: '#0a0c0d',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/hud-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp}'],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl')) return 'map-core'
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react')) return 'react-core'
          if (id.includes('node_modules')) return 'vendor'
          return undefined
        },
      },
    },
  },
})