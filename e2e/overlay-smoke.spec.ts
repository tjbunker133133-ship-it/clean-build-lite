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

async function waitForBasemapSettled(page: Page, timeout = 35_000) {
  await page.waitForFunction(
    () => {
      const map = (window as {
        __hudMap?: {
          isStyleLoaded?: () => boolean
          getStyle?: () => { layers?: unknown[] } | null
        }
      }).__hudMap
      return Boolean(map?.isStyleLoaded?.() && (map.getStyle?.()?.layers?.length ?? 0) > 0)
    },
    { timeout },
  )
}

async function waitForMapReady(page: Page, timeout = 30000) {
  await waitForBasemapSettled(page, timeout)
}

async function bootHybrid(page: Page) {
  await page.goto('/?mode=hybrid&e2e=1', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__HUD_RUNTIME__ != null, { timeout: 20_000 })
  await waitForMapReady(page).catch(() => undefined)
}

async function setBasemapLayer(page: Page, layerId: string) {
  await page.evaluate((layer) => {
    const e2e = (window as { __hudE2E?: { setLayer?: (id: string) => void } }).__hudE2E
    e2e?.setLayer?.(layer)
  }, layerId)
}

async function setOverlayEnabled(page: Page, overlayId: string, enabled: boolean) {
  await page.evaluate(
    ({ id, on }) => {
      const ctx = (window as {
        __hudOverlayContext?: {
          setEnabled?: (overlayId: string, enabled: boolean) => void
          setToggle?: (overlayId: string, enabled: boolean) => void
        }
      }).__hudOverlayContext
      if (ctx?.setEnabled) ctx.setEnabled(id, on)
      else if (ctx?.setToggle) ctx.setToggle(id, on)
    },
    { id: overlayId, on: enabled },
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
    await bootHybrid(page)
    await clearForensics(page)
  })

  for (const layer of BASE_LAYERS) {
    test(`switch to ${layer} layer and verify render`, async ({ page }) => {
      const beforeState = await getMapState(page)
      expect(beforeState.styleLoaded).toBe(true)

      await setBasemapLayer(page, layer)
      await expect.poll(async () => {
        const state = await getMapState(page)
        return state.styleLoaded === true && (state.layerIds?.length ?? 0) > 0
      }, { timeout: 35_000 }).toBe(true)
    })
  }
})

test.describe('Overlay Toggle Validation', () => {
  test.beforeEach(async ({ page }) => {
    await bootHybrid(page)
    await clearForensics(page)
  })

  for (const overlay of OVERLAYS) {
    test(`toggle ${overlay.id} overlay - enable, verify, disable, cleanup`, async ({ page }) => {
      const beforeState = await getMapState(page)

      await setOverlayEnabled(page, overlay.id, true)

      await page.waitForTimeout(3000)

      const forensics = await getForensics(page)
      const overlayTraces = (forensics as { overlay?: Array<{ event: string; details?: { overlayId?: string } }> }).overlay || []

      const activationTrace = overlayTraces.find(
        (t) =>
          (t.event === 'overlay_enabled' || t.event === 'resilient_sync_activate') &&
          t.details?.overlayId === overlay.id,
      )

      if (!overlay.requiresKey) {
        expect(activationTrace).toBeTruthy()
      }

      const mapState = await getMapState(page)
      if (!overlay.requiresKey) {
        expect(mapState.layerIds.length).toBeGreaterThanOrEqual(beforeState.layerIds?.length || 0)
      }

      await setOverlayEnabled(page, overlay.id, false)

      await page.waitForTimeout(1000)

      const forensicsAfter = await getForensics(page)
      const overlayTracesAfter = (forensicsAfter as { overlay?: Array<{ event: string; details?: { overlayId?: string } }> }).overlay || []
      const cleanupTrace = overlayTracesAfter.find(
        (t) =>
          (t.event === 'overlay_disabled' ||
            t.event === 'cleanup_called' ||
            t.event === 'resilient_sync_deactivate') &&
          t.details?.overlayId === overlay.id,
      )

      expect(cleanupTrace).toBeTruthy()

      const activationCount = overlayTracesAfter.filter(
        (t) =>
          (t.event === 'overlay_enabled' || t.event === 'resilient_sync_activate') &&
          t.details?.overlayId === overlay.id,
      ).length

      expect(activationCount).toBeLessThanOrEqual(1)
    })
  }
})

test.describe('Rapid Toggle Stress Test', () => {
  test('rapid overlay toggle stress - no leaks or accumulation', async ({ page }) => {
    await bootHybrid(page)
    await clearForensics(page)

    const initialState = await getMapState(page)
    const initialLayerCount = initialState.layerIds?.length || 0

    // Rapid toggle sequence
    const toggleSequence = [
      'bike_paths', 'mines', 'camping', 'hiking_trails', 'abandoned_rail',
      'bike_paths', 'mines', 'camping', 'hiking_trails', 'abandoned_rail',
    ]

    for (const overlayId of toggleSequence) {
      await setOverlayEnabled(page, overlayId, true)
      await page.waitForTimeout(100)
      await setOverlayEnabled(page, overlayId, false)
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
    await bootHybrid(page)

    await setOverlayEnabled(page, 'bike_paths', true)

    await page.waitForTimeout(2000)

    // Simulate offline
    await context.setOffline(true)

    await setOverlayEnabled(page, 'mines', true)

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

    await setOverlayEnabled(page, 'bike_paths', false)
    await setOverlayEnabled(page, 'mines', false)
  })

  test('slow network handling', async ({ page }) => {
    await bootHybrid(page)
    await clearForensics(page)

    // Enable slow network simulation via CDP
    const client = await page.context().newCDPSession(page)
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 500,
      downloadThroughput: 50000, // ~50kbps
      uploadThroughput: 50000,
    })

    await setOverlayEnabled(page, 'bike_paths', true)

    await page.waitForTimeout(5000)

    const forensics = await getForensics(page)
    const overlayTraces = (forensics as { overlay?: Array<{ event: string }> }).overlay || []

    const progressTraces = overlayTraces.filter(
      (t) =>
        t.event === 'render_seed_complete' ||
        t.event === 'overlay_enabled' ||
        t.event === 'fetch_started' ||
        t.event === 'ready_committed',
    )

    expect(progressTraces.length).toBeGreaterThan(0)

    // Restore network
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })

    await setOverlayEnabled(page, 'bike_paths', false)
  })
})

test.describe('Visibility/Background Test', () => {
  test('tab visibility change handling', async ({ page }) => {
    await bootHybrid(page)
    await clearForensics(page)

    await setOverlayEnabled(page, 'camping', true)

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

    await setOverlayEnabled(page, 'camping', false)
  })
})

test.describe('Memory and Leak Detection', () => {
  test('no listener accumulation after repeated mount/unmount', async ({ page }) => {
    await bootHybrid(page)
    await clearForensics(page)

    // Get initial listener count
    const initialListenerCount = await page.evaluate(() => {
      return (window as any).__hudCompassListeners || 0
    })

    // Enable/disable overlays multiple times
    for (let i = 0; i < 5; i++) {
      await setOverlayEnabled(page, 'bike_paths', true)
      await setOverlayEnabled(page, 'mines', true)
      await page.waitForTimeout(500)
      await setOverlayEnabled(page, 'bike_paths', false)
      await setOverlayEnabled(page, 'mines', false)
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
    await bootHybrid(page)
    await clearForensics(page)

    for (let i = 0; i < 10; i++) {
      await setOverlayEnabled(page, 'bike_paths', true)
      await page.waitForTimeout(200)
      await setOverlayEnabled(page, 'bike_paths', false)
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
    await bootHybrid(page)
    await waitForBasemapSettled(page, 30_000)
    await clearForensics(page)

    const results: Record<string, { passed: boolean; errors: string[] }> = {}

    for (const layer of BASE_LAYERS) {
      const errors: string[] = []
      try {
        await setBasemapLayer(page, layer)
        const settled = await page
          .waitForFunction(
            async () => {
              const map = (window as { __hudMap?: { isStyleLoaded?: () => boolean; getStyle?: () => { layers?: unknown[] } } }).__hudMap
              return Boolean(map?.isStyleLoaded?.() && (map.getStyle?.()?.layers?.length ?? 0) > 0)
            },
            { timeout: 35_000 },
          )
          .then(() => true)
          .catch(() => false)
        if (!settled) errors.push('Map style not loaded')
        results[`base-${layer}`] = { passed: errors.length === 0, errors }
      } catch (e) {
        errors.push(String(e))
        results[`base-${layer}`] = { passed: false, errors }
      }
    }

    for (const overlay of OVERLAYS) {
      const errors: string[] = []
      try {
        await setOverlayEnabled(page, overlay.id, true)
        await page.waitForTimeout(2000)

        const forensics = await getForensics(page)
        const overlayTraces = (forensics as { overlay?: Array<{ event: string; details?: { overlayId?: string } }> }).overlay || []

        const activated = overlayTraces.some(
          (t) =>
            (t.event === 'overlay_enabled' || t.event === 'resilient_sync_activate') &&
            t.details?.overlayId === overlay.id,
        )

        if (!activated && !overlay.requiresKey) {
          errors.push('No activation trace found')
        }

        await setOverlayEnabled(page, overlay.id, false)
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