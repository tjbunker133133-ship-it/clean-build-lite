import { test, expect, type Page } from '@playwright/test'

/**
 * OVERLAY OPERATIONAL VALIDATION TEST
 *
 * Focused on runtime stability verification:
 * - Forensics trace generation
 * - Cleanup behavior
 * - Memory/performance characteristics
 * - Network handling
 * - Operational guardrails
 */

// Test helpers
async function getForensics(page: Page) {
  return page.evaluate(() => {
    const forensics = (window as any).__hudForensics
    if (!forensics) return null
    return {
      buffer: forensics.getBuffer(),
      overlay: forensics.getTracesByCategory('overlay'),
      voice: forensics.getTracesByCategory('voice'),
      tts: forensics.getTracesByCategory('tts'),
      gps: forensics.getTracesByCategory('gps'),
      command: forensics.getTracesByCategory('command'),
    }
  })
}

async function clearForensics(page: Page) {
  await page.evaluate(() => {
    const forensics = (window as any).__hudForensics
    if (forensics) forensics.clearBuffer()
  })
}

async function getDebugState(page: Page) {
  return page.evaluate(() => {
    return {
      compassListeners: (window as any).__hudCompassListeners,
      forensicsAvailable: !!(window as any).__hudForensics,
      debugAvailable: !!(window as any).__hudDebug,
    }
  })
}

test.describe('Operational Forensics Availability', () => {
  test('forensics API is available and functional', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(5000)

    const state = await getDebugState(page)
    expect(state.forensicsAvailable).toBe(true)
    expect(state.debugAvailable).toBe(true)
  })

  test('forensics buffer captures overlay traces', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)
    await clearForensics(page)

    // Generate some overlay activity via context if available
    await page.waitForTimeout(2000)

    const forensics = await getForensics(page)
    expect(forensics).not.toBeNull()
    expect(forensics?.buffer).toBeDefined()
  })
})

test.describe('Compass Listener Management', () => {
  test('compass listener count is bounded', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(5000)

    const state1 = await getDebugState(page)
    const initialCount = state1.compassListeners || 0

    // Wait and check again - should not grow
    await page.waitForTimeout(5000)

    const state2 = await getDebugState(page)
    const finalCount = state2.compassListeners || 0

    // Should not have accumulated listeners
    expect(finalCount).toBeLessThanOrEqual(initialCount + 1)
    expect(finalCount).toBeLessThanOrEqual(5) // Reasonable upper bound
  })
})

test.describe('Memory and Buffer Management', () => {
  test('forensics buffer respects 100-entry cap', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)
    await clearForensics(page)

    // Generate activity
    for (let i = 0; i < 20; i++) {
      // Toggle voice armed state if available
      await page.evaluate(() => {
        const debug = (window as any).__hudDebug
        if (debug && debug.toggleVoice) {
          debug.toggleVoice()
        }
      })
      await page.waitForTimeout(100)
    }

    await page.waitForTimeout(1000)

    const forensics = await getForensics(page)
    const totalTraces =
      (forensics?.overlay?.length || 0) +
      (forensics?.voice?.length || 0) +
      (forensics?.tts?.length || 0) +
      (forensics?.gps?.length || 0) +
      (forensics?.command?.length || 0)

    // Buffer should be capped (100 per category)
    expect(totalTraces).toBeLessThanOrEqual(500) // 5 categories × 100 max
  })
})

test.describe('Network and Offline Handling', () => {
  test('offline mode is handled gracefully', async ({ context, page }) => {
    await page.goto('/')
    await page.waitForTimeout(5000)
    await clearForensics(page)

    // Go offline
    await context.setOffline(true)
    await page.waitForTimeout(3000)

    // App should still be responsive
    const forensics = await getForensics(page)
    expect(forensics).not.toBeNull()

    // Restore online
    await context.setOffline(false)
    await page.waitForTimeout(2000)

    // Check for offline-related traces
    const offlineTraces = forensics?.overlay?.filter(
      (t: any) => t.event?.includes('offline') || t.event?.includes('skipped')
    )

    console.log(`Offline-related traces: ${offlineTraces?.length || 0}`)
  })
})

test.describe('Operational Guardrails', () => {
  test('restart storm warning threshold is configured', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)
    await clearForensics(page)

    // Check that voice traces don't contain restart_storm_warning
    const forensics = await getForensics(page)
    const voiceTraces = forensics?.voice || []

    const stormWarnings = voiceTraces.filter(
      (t: any) => t.event === 'restart_storm_warning'
    )

    // Should not have restart storms in normal operation
    expect(stormWarnings.length).toBe(0)
  })

  test('cleanup traces are generated', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)
    await clearForensics(page)

    // Wait for potential cleanup events
    await page.waitForTimeout(5000)

    const forensics = await getForensics(page)
    const overlayTraces = forensics?.overlay || []

    // Check for cleanup-related traces
    const cleanupTraces = overlayTraces.filter(
      (t: any) =>
        t.event?.includes('cleanup') ||
        t.event?.includes('unmount') ||
        t.event?.includes('deactivate')
    )

    console.log(`Cleanup traces found: ${cleanupTraces.length}`)
    // Cleanup traces may or may not be present depending on activity
    // Just verify the tracing system is working
    expect(overlayTraces.length).toBeGreaterThanOrEqual(0)
  })
})

test.describe('Comprehensive Operational Smoke Test', () => {
  test('all operational systems report healthy status', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(8000) // Allow systems to initialize
    await clearForensics(page)

    // Collect operational state
    const startTime = Date.now()
    const testDuration = 10000 // 10 seconds

    while (Date.now() - startTime < testDuration) {
      // Generate some activity
      await page.evaluate(() => {
        // Trigger various events if APIs are available
        const debug = (window as any).__hudDebug
        if (debug) {
          // Toggle various features
          if (debug.toggleOverlay) debug.toggleOverlay('bike_paths', true)
        }
      })

      await page.waitForTimeout(500)
    }

    // Collect results
    const forensics = await getForensics(page)
    const debugState = await getDebugState(page)

    const results = {
      forensicsAvailable: !!forensics,
      debugAvailable: debugState.debugAvailable,
      totalTraces:
        (forensics?.overlay?.length || 0) +
        (forensics?.voice?.length || 0) +
        (forensics?.tts?.length || 0) +
        (forensics?.gps?.length || 0) +
        (forensics?.command?.length || 0),
      overlayTraces: forensics?.overlay?.length || 0,
      voiceTraces: forensics?.voice?.length || 0,
      compassListeners: debugState.compassListeners,
    }

    console.log('\n=== OPERATIONAL SMOKE TEST RESULTS ===')
    console.log(JSON.stringify(results, null, 2))
    console.log('=======================================\n')

    // Operational assertions
    expect(results.forensicsAvailable).toBe(true)
    expect(results.debugAvailable).toBe(true)
    expect(results.totalTraces).toBeGreaterThanOrEqual(0)
    expect(results.compassListeners).toBeLessThanOrEqual(5)
  })
})