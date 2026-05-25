import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import project from './projects/hud-v1/project.json'

const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  new Date().toISOString()

export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_STAMP': JSON.stringify(buildId),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(project.version),
    'import.meta.env.VITE_APP_NAME': JSON.stringify(project.displayName),
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['hud-icon.svg'],
      manifest: {
        name: project.displayName,
        short_name: project.shortName,
        description: `${project.displayName} — mobile tactical navigation HUD`,
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
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/functions\//, /^\/api\//],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        importScripts: ['/sw-message-handler.js'],
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