import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      VITE_MAPTILER_KEY: 'vitest-maptiler-key',
    },
  },
})
