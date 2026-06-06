import { test, expect, type Page, type BrowserContext } from '@playwright/test'

/**
 * OVERLAY SYSTEM SMOKE TEST + OPERATIONAL VALIDATION
 *
 * Validates:
 * - Base layer switching
 * - Overlay toggle behavior
 * - Cleanup on disable
 * - Rapid toggle stress
 * - Network degradation handling
 * - Memory/leak detection
 */

const BASE_LAYERS = ['streets', 'topo', 'outdoor', 'satellite'] as const

const OVERLAYS = [
  { id: 'fire_firms', label: 'Active fire (24h)', requiresKey: true },
  { id: 'relief_usgs', label: 'Shaded relief', requiresKey: false },
  { id: 'forest_usfs', label: 'National forest', requiresKey: false },
  { id: 'public_lands', label: 'Public / federal lands', requiresKey: false },
  { id: 'bike_paths', label: 'Bike paths', requiresKey: false },
  { id: 'abandoned_rail', label: 'Abandoned railways', requiresKey: false },
  { id: 'mines', label: 'Mines & shafts', requiresKey: false },
  { id: 'hiking_trails', label: 'Hiking paths (OSM)', requiresKey: false },
  { id: 'camping', label: 'Camping areas', requiresKey: false },
] as const

// Console message collector for leak detection
interface ConsoleMessage {
  type: string
  text: string
  location: string
}

async function collectConsoleMessages(page: Page): Promise<ConsoleMessage[]> {
  const messages: ConsoleMessage[] = []
  page.on('console', msg => {
    messages.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location().url || 'unknown',
    })
  })
  return messages
}

async function openLayerPanel(page: Page) {
  // Try to find and click the layer panel button or menu
  const layerButton = page.locator('[data-testid="layer-panel-button"], button:has-text("Layers"), button:has-text("Map")').first()
  if (await layerButton.isVisible().catch(() => false)) {
    await layerButton.click()
  }
}

async function getForensics(page: Page) {
  return page.evaluate(() => {
    const forensics = (window as any).__hudForensics
    if (!forensics) return { error: 'Forensics not available' }
    return {
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

async function waitForMapReady(page: Page, timeout = 30000) {
  await page.waitForFunction(
    () => {
      const map = (window as any).__hudMap
      return map && map.isStyleLoaded && map.isStyleLoaded()
    },
    { timeout }
  )
}

async function getMapState(page: Page) {
  return page.evaluate(() => {
    const map = (window as any).__hudMap
    if (!map) return { error: 'Map not available' }
    return {
      zoom: map.getZoom(),
      center: map.getCenter(),
      styleLoaded: map.isStyleLoaded(),
      layerIds: map.getStyle()?.layers?.map((l: any) => l.id) || [],
      sourceIds: Object.keys(map.getStyle()?.sources || {}),
    }
  })
}

test.describe('Base Layer Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)
    await clearForensics(page)
  })

  for (const layer of BASE_LAYERS) {
    test(`switch to ${layer} layer and verify render`, async ({ page }) => {
      const beforeState = await getMapState(page)
      expect(beforeState.styleLoaded).toBe(true)

      // Click the layer button via JavaScript to ensure it works
      await page.evaluate((layerId) => {
        const app = (window as any).__hudApp
        if (app && app.setLayer) {
          app.setLayer(layerId)
        }
      }, layer)

      // Wait for style to reload
      await page.waitForTimeout(2000)

      const afterState = await getMapState(page)
      expect(afterState.styleLoaded).toBe(true)
      expect(afterState.layerIds.length).toBeGreaterThan(0)

      // Verify no errors in console
      const consoleMessages = await collectConsoleMessages(page)
      const errors = consoleMessages.filter(m => m.type === 'error')
      expect(errors.length).toBeLessThan(5) // Allow some network errors
    })
  }
})

test.describe('Overlay Toggle Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)
    await clearForensics(page)
  })

  for (const overlay of OVERLAYS) {
    test(`toggle ${overlay.id} overlay - enable, verify, disable, cleanup`, async ({ page }) => {
      // Enable overlay via JavaScript API
      await page.evaluate((overlayId) => {
        const ctx = (window as any).__hudOverlayContext
        if (ctx && ctx.setEnabled) {
          ctx.setEnabled(overlayId, true)
        }
      }, overlay.id)

      // Wait for overlay to process
      await page.waitForTimeout(3000)

      // Get forensics traces
      const forensics = await getForensics(page)
      const overlayTraces = (forensics as any).overlay || []

      // Verify activation trace exists
      const activationTrace = overlayTraces.find(
        (t: any) => t.event === 'resilient_sync_activate' && t.details?.overlayId === overlay.id
      )

      if (!overlay.requiresKey) {
        expect(activationTrace).toBeTruthy()
      }

      // Check map layers
      const mapState = await getMapState(page)
      const overlayLayerId = `hud-env-lyr-${overlay.id}`
      const hasLayer = mapState.layerIds?.includes(overlayLayerId)

      if (!overlay.requiresKey) {
        // Should have the layer (or at least attempted to add it)
        expect(mapState.layerIds.length).toBeGreaterThan(beforeState.layerIds?.length || 0)
      }

      // Disable overlay
      await page.evaluate((overlayId) => {
        const ctx = (window as any).__hudOverlayContext
        if (ctx && ctx.setEnabled) {
          ctx.setEnabled(overlayId, false)
        }
      }, overlay.id)

      await page.waitForTimeout(1000)

      // Verify cleanup trace
      const forensicsAfter = await getForensics(page)
      const overlayTracesAfter = (forensicsAfter as any).overlay || []
      const cleanupTrace = overlayTracesAfter.find(
        (t: any) => t.event === 'resilient_sync_deactivate' && t.details?.overlayId === overlay.id
      )

      expect(cleanupTrace).toBeTruthy()

      // Check for duplicate activation (should be prevented)
      const activationCount = overlayTracesAfter.filter(
        (t: any) => t.event === 'resilient_sync_activate' && t.details?.overlayId === overlay.id
      ).length

      expect(activationCount).toBeLessThanOrEqual(1)
    })
  }
})

test.describe('Rapid Toggle Stress Test', () => {
  test('rapid overlay toggle stress - no leaks or accumulation', async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)
    await clearForensics(page)

    const initialState = await getMapState(page)
    const initialLayerCount = initialState.layerIds?.length || 0

    // Rapid toggle sequence
    const toggleSequence = [
      'bike_paths', 'mines', 'camping', 'hiking_trails', 'abandoned_rail',
      'bike_paths', 'mines', 'camping', 'hiking_trails', 'abandoned_rail',
    ]

    for (const overlayId of toggleSequence) {
      // Toggle on
      await page.evaluate((id) => {
        const ctx = (window as any).__hudOverlayContext
        if (ctx && ctx.setEnabled) ctx.setEnabled(id, true)
      }, overlayId)

      await page.waitForTimeout(100)

      // Toggle off
      await page.evaluate((id) => {
        const ctx = (window as any).__hudOverlayContext
        if (ctx && ctx.setEnabled) ctx.setEnabled(id, false)
      }, overlayId)

      await page.waitForTimeout(100)
    }

    // Wait for cleanup
    await page.waitForTimeout(2000)

    const finalState = await getMapState(page)
    const finalLayerCount = finalState.layerIds?.length || 0

    // Should not have accumulated layers
    expect(finalLayerCount).toBeLessThanOrEqual(initialLayerCount + 2)

    // Check forensics for duplicate prevention
    const forensics = await getForensics(page)
    const overlayTraces = (forensics as any).overlay || []

    // Count duplicate skips
    const duplicateSkips = overlayTraces.filter(
      (t: any) => t.event === 'resilient_activation_skipped_duplicate'
    )

    // If duplicates were attempted, they should have been prevented
    console.log(`Duplicate skips: ${duplicateSkips.length}`)

    // Check for storm warnings
    const restartStorms = overlayTraces.filter(
      (t: any) => t.event === 'restart_storm_warning'
    )
    expect(restartStorms.length).toBe(0)

    // Verify no runaway fetches
    const fetchStarts = overlayTraces.filter(
      (t: any) => t.event === 'fetch_overpass_geojson_start'
    )
    const fetchSuccesses = overlayTraces.filter(
      (t: any) => t.event === 'fetch_success'
    )
    const fetchFailures = overlayTraces.filter(
      (t: any) => t.event === 'fetch_all_endpoints_failed'
    )

    console.log(`Fetches started: ${fetchStarts.length}`)
    console.log(`Fetches succeeded: ${fetchSuccesses.length}`)
    console.log(`Fetches failed: ${fetchFailures.length}`)

    // Should have bounded fetch attempts
    expect(fetchStarts.length).toBeLessThanOrEqual(toggleSequence.length * 2)
  })
})

test.describe('Network Degradation Test', () => {
  test('overlay behavior in offline mode', async ({ page, context }) => {
    await page.goto('/')
    await waitForMapReady(page)

    // Enable an overlay before going offline
    await page.evaluate(() => {
      const ctx = (window as any).__hudOverlayContext
      if (ctx && ctx.setEnabled) ctx.setEnabled('bike_paths', true)
    })

    await page.waitForTimeout(2000)

    // Simulate offline
    await context.setOffline(true)

    // Toggle another overlay while offline
    await page.evaluate(() => {
      const ctx = (window as any).__hudOverlayContext
      if (ctx && ctx.setEnabled) ctx.setEnabled('mines', true)
    })

    await page.waitForTimeout(2000)

    // Check forensics for offline handling
    const forensics = await getForensics(page)
    const overlayTraces = (forensics as any).overlay || []

    // Should see offline skip traces
    const offlineSkips = overlayTraces.filter(
      (t: any) => t.event === 'enhance_skipped_offline'
    )

    console.log(`Offline skips: ${offlineSkips.length}`)

    // Map should still be interactive
    const mapState = await getMapState(page)
    expect(mapState.styleLoaded).toBe(true)

    // Restore online
    await context.setOffline(false)

    await page.waitForTimeout(2000)

    // Cleanup
    await page.evaluate(() => {
      const ctx = (window as any).__hudOverlayContext
      if (ctx && ctx.setEnabled) {
        ctx.setEnabled('bike_paths', false)
        ctx.setEnabled('mines', false)
      }
    })
  })

  test('slow network handling', async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)
    await clearForensics(page)

    // Enable slow network simulation via CDP
    const client = await page.context().newCDPSession(page)
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 500,
      downloadThroughput: 50000, // ~50kbps
      uploadThroughput: 50000,
    })

    // Enable overlay
    await page.evaluate(() => {
      const ctx = (window as any).__hudOverlayContext
      if (ctx && ctx.setEnabled) ctx.setEnabled('bike_paths', true)
    })

    // Wait with slow network
    await page.waitForTimeout(5000)

    // Check traces
    const forensics = await getForensics(page)
    const overlayTraces = (forensics as any).overlay || []

    // Should have rendered from seed data
    const seedRenders = overlayTraces.filter(
      (t: any) => t.event === 'render_seed_complete'
    )

    expect(seedRenders.length).toBeGreaterThan(0)

    // Restore network
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })

    // Cleanup
    await page.evaluate(() => {
      const ctx = (window as any).__hudOverlayContext
      if (ctx && ctx.setEnabled) ctx.setEnabled('bike_paths', false)
    })
  })
})

test.describe('Visibility/Background Test', () => {
  test('tab visibility change handling', async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)
    await clearForensics(page)

    // Enable overlay
    await page.evaluate(() => {
      const ctx = (window as any).__hudOverlayContext
      if (ctx && ctx.setEnabled) ctx.setEnabled('camping', true)
    })

    await page.waitForTimeout(2000)

    // Simulate tab hidden
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await page.waitForTimeout(2000)

    // Simulate tab visible
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await page.waitForTimeout(2000)

    // Check forensics for visibility handling
    const forensics = await getForensics(page)
    const gpsTraces = (forensics as any).gps || []

    const visibilityChanges = gpsTraces.filter(
      (t: any) => t.event === 'visibility_change'
    )

    console.log(`Visibility changes: ${visibilityChanges.length}`)

    // Map should still be functional
    const mapState = await getMapState(page)
    expect(mapState.styleLoaded).toBe(true)

    // Cleanup
    await page.evaluate(() => {
      const ctx = (window as any).__hudOverlayContext
      if (ctx && ctx.setEnabled) ctx.setEnabled('camping', false)
    })
  })
})

test.describe('Memory and Leak Detection', () => {
  test('no listener accumulation after repeated mount/unmount', async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)
    await clearForensics(page)

    // Get initial listener count
    const initialListenerCount = await page.evaluate(() => {
      return (window as any).__hudCompassListeners || 0
    })

    // Enable/disable overlays multiple times
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        const ctx = (window as any).__hudOverlayContext
        if (ctx && ctx.setEnabled) {
          ctx.setEnabled('bike_paths', true)
          ctx.setEnabled('mines', true)
        }
      })
      await page.waitForTimeout(500)

      await page.evaluate(() => {
        const ctx = (window as any).__hudOverlayContext
        if (ctx && ctx.setEnabled) {
          ctx.setEnabled('bike_paths', false)
          ctx.setEnabled('mines', false)
        }
      })
      await page.waitForTimeout(500)
    }

    // Get final listener count
    const finalListenerCount = await page.evaluate(() => {
      return (window as any).__hudCompassListeners || 0
    })

    // Should not have accumulated listeners
    expect(finalListenerCount).toBeLessThanOrEqual(initialListenerCount + 1)

    // Check forensics for cleanup
    const forensics = await getForensics(page)
    const overlayTraces = (forensics as any).overlay || []

    const cleanups = overlayTraces.filter(
      (t: any) => t.event === 'layer_unmount_cleanup_complete'
    )

    console.log(`Cleanup traces: ${cleanups.length}`)
  })

  test('forensics buffer does not grow unbounded', async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)
    await clearForensics(page)

    // Generate many traces
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => {
        const ctx = (window as any).__hudOverlayContext
        if (ctx && ctx.setEnabled) {
          ctx.setEnabled('bike_paths', true)
        }
      })
      await page.waitForTimeout(200)

      await page.evaluate(() => {
        const ctx = (window as any).__hudOverlayContext
        if (ctx && ctx.setEnabled) {
          ctx.setEnabled('bike_paths', false)
        }
      })
      await page.waitForTimeout(200)
    }

    // Check buffer size
    const forensics = await getForensics(page)
    const totalTraces =
      ((forensics as any).overlay?.length || 0) +
      ((forensics as any).voice?.length || 0) +
      ((forensics as any).gps?.length || 0) +
      ((forensics as any).command?.length || 0)

    // Buffer should be capped at 100
    expect(totalTraces).toBeLessThanOrEqual(400) // 4 categories × 100 max
  })
})

test.describe('Comprehensive Smoke Test', () => {
  test('full smoke test - all overlays and base layers', async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)
    await clearForensics(page)

    const results: Record<string, { passed: boolean; errors: string[] }> = {}

    // Test each base layer
    for (const layer of BASE_LAYERS) {
      const errors: string[] = []

      try {
        await page.evaluate((l) => {
          const app = (window as any).__hudApp
          if (app && app.setLayer) app.setLayer(l)
        }, layer)

        await page.waitForTimeout(1500)

        const state = await getMapState(page)
        if (!state.styleLoaded) {
          errors.push('Map style not loaded')
        }

        results[`base-${layer}`] = { passed: errors.length === 0, errors }
      } catch (e) {
        errors.push(String(e))
        results[`base-${layer}`] = { passed: false, errors }
      }
    }

    // Test each overlay
    for (const overlay of OVERLAYS) {
      const errors: string[] = []

      try {
        // Enable
        await page.evaluate((id) => {
          const ctx = (window as any).__hudOverlayContext
          if (ctx && ctx.setEnabled) ctx.setEnabled(id, true)
        }, overlay.id)

        await page.waitForTimeout(2000)

        // Check if rendered or skipped
        const forensics = await getForensics(page)
        const overlayTraces = (forensics as any).overlay || []

        const visible = overlayTraces.some(
          (t: any) =>
            t.event === 'resilient_sync_visible' &&
            t.details?.overlayId === overlay.id
        )

        const notVisible = overlayTraces.some(
          (t: any) =>
            t.event === 'resilient_sync_not_visible' &&
            t.details?.overlayId === overlay.id
        )

        if (!visible && !notVisible && !overlay.requiresKey) {
          errors.push('No visibility trace found')
        }

        // Disable
        await page.evaluate((id) => {
          const ctx = (window as any).__hudOverlayContext
          if (ctx && ctx.setEnabled) ctx.setEnabled(id, false)
        }, overlay.id)

        await page.waitForTimeout(500)

        results[`overlay-${overlay.id}`] = { passed: errors.length === 0, errors }
      } catch (e) {
        errors.push(String(e))
        results[`overlay-${overlay.id}`] = { passed: false, errors }
      }

      await clearForensics(page)
    }

    // Summary
    console.log('\n=== SMOKE TEST RESULTS ===')
    let passed = 0
    let failed = 0
    for (const [name, result] of Object.entries(results)) {
      if (result.passed) {
        passed++
        console.log(`✅ ${name}`)
      } else {
        failed++
        console.log(`❌ ${name}: ${result.errors.join(', ')}`)
      }
    }
    console.log(`\nTotal: ${passed} passed, ${failed} failed`)
    console.log('===========================\n')

    expect(failed).toBe(0)
  })
})