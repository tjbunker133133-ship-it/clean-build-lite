import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_STAMP': JSON.stringify(new Date().toISOString()),
    __BUILD_ID__: JSON.stringify(new Date().toISOString()),
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
        // Precache includes index.html so installed PWAs can cold-open offline after at least one
        // online visit. Deployment mismatch is still handled by runtime deploymentFreshness when online.
        globPatterns: ['**/*.{html,js,css,svg,png,ico,webp,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/[^/?]+\.[a-zA-Z0-9]+$/],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        importScripts: ['/sw-message-handler.js'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(?:api\.maptiler\.com|tiles\.maptiler\.com)\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'hud-maptiler-v1',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'hud-osm-tiles-v1',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
  build: {
    // Tactical HUD includes a large mapping runtime bundle (MapLibre + worker graph).
    // Keep warning signal focused on true regressions rather than known map-core size.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/maplibre-gl') ||
            id.includes('node_modules/@mapbox/') ||
            id.includes('node_modules/pbf') ||
            id.includes('node_modules/supercluster') ||
            id.includes('node_modules/kdbush') ||
            id.includes('node_modules/geojson-vt')
          ) {
            return 'map-core'
          }
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react')) return 'react-core'
          if (id.includes('node_modules/@supabase/')) return 'supabase-core'
          if (id.includes('node_modules')) return 'vendor'
          return undefined
        },
      },
    },
  },
})