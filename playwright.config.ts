import { defineConfig, devices } from '@playwright/test'

/** Stale console/DOM contracts — opt-in via `--project=diagnostic`. */
const DIAGNOSTIC_SPECS = [
  '**/immersive-mode-runtime.spec.ts',
  '**/mode-resolution-diagnostic.spec.ts',
  '**/hud-unified-runtime.spec.ts',
  '**/immersive-mode-entry.spec.ts',
]

/**
 * Playwright configuration for HUD PWA smoke testing
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/**/*.spec.ts', 'tests/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader-webgl',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: DIAGNOSTIC_SPECS,
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
      testIgnore: DIAGNOSTIC_SPECS,
    },
    {
      name: 'diagnostic',
      use: { ...devices['Desktop Chrome'] },
      testMatch: DIAGNOSTIC_SPECS,
    },
  ],
  webServer: {
    command: 'node scripts/preview-hud.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})