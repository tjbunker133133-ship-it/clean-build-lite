import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}

async function clickBalancedMap(page: Page) {
  const placed = await page.evaluate(() => {
    const map = (window as {
      __hudMap?: {
        getCenter: () => { lat: number; lng: number }
        getCanvas: () => HTMLCanvasElement
        project: (lngLat: [number, number]) => { x: number; y: number }
        fire: (type: string, data: object) => void
      }
    }).__hudMap
    if (!map) return false
    const center = map.getCenter()
    const lngLat = { lat: center.lat, lng: center.lng }
    const point = map.project([lngLat.lng, lngLat.lat])
    const canvas = map.getCanvas()
    map.fire('click', {
      lngLat,
      point,
      originalEvent: { target: canvas, preventDefault: () => {}, stopPropagation: () => {} },
    })
    return true
  })
  if (!placed) {
    const canvas = page.locator('[data-balanced-layer] .maplibregl-canvas').first()
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Balanced map canvas has no bounding box')
    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.4)
  }
  await sleep(300)
}

const BALANCED_SEED = {
  uiPrefs: {
    keepWaypointToolArmed: true,
    activeLayer: 'outdoor',
  },
  osgRoute: { waypoints: [] as unknown[] },
}

async function seedBalanced(page: Page) {
  await page.context().addInitScript((seed) => {
    localStorage.setItem('hud_ui_prefs_v1', JSON.stringify(seed.uiPrefs))
    localStorage.setItem('hud_osg_route_v1', JSON.stringify(seed.osgRoute))
  }, BALANCED_SEED)
  await page.goto('/?mode=hybrid&e2e=1', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__HUD_RUNTIME__?.mode === 'hybrid', { timeout: 25_000 })
  await page.waitForSelector('[data-balanced-layer][data-balanced-active="true"]', { timeout: 25_000 })
  await page.waitForSelector('[data-balanced-layer] .maplibregl-canvas', { timeout: 25_000 })
  await page.waitForSelector('[data-balanced-quick-actions]', { timeout: 25_000 })
  await page.waitForFunction(() => !!(window as unknown as { __hudMap?: unknown }).__hudMap, { timeout: 15_000 })
  await sleep(800)
}

async function dismissBanners(page: Page) {
  const dismiss = page.locator('button:has-text("DISMISS")').first()
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click()
    await sleep(200)
  }
}

async function armWaypointDrop(page: Page) {
  await page.waitForFunction(
    () => typeof (window as { __hudE2E?: { setBalancedTool?: (t: string) => void } }).__hudE2E?.setBalancedTool === 'function',
    { timeout: 15_000 },
  )
  await page.evaluate(() => {
    ;(window as { __hudE2E?: { setBalancedTool?: (t: string) => void } }).__hudE2E!.setBalancedTool!('waypoint')
  })
  await page.waitForFunction(
    () => document.querySelector('[data-balanced-layer]')?.getAttribute('data-balanced-tool') === 'waypoint',
    { timeout: 15_000 },
  )
  const pinBtn = page.locator('[data-balanced-layer] button:has-text("Pin")').first()
  if (await pinBtn.isVisible().catch(() => false)) {
    await pinBtn.click()
    await sleep(200)
  }
}

async function getWaypointCount(page: Page) {
  return page.evaluate(() => {
    const readKey = (key: string) => {
      const raw = localStorage.getItem(key)
      if (!raw) return 0
      try {
        return (JSON.parse(raw) as { waypoints?: unknown[] }).waypoints?.length ?? 0
      } catch {
        return 0
      }
    }
    const osg = readKey('hud_osg_route_v1')
    return osg > 0 ? osg : readKey('tactical_hud_app_state_v1')
  })
}

test.describe('Balanced workflow ownership', () => {
  test.beforeEach(async ({ page }) => {
    await seedBalanced(page)
    await dismissBanners(page)
    await armWaypointDrop(page)
  })

  test('measure mode activates and cancels without placing waypoints', async ({ page }) => {
    const before = await getWaypointCount(page)

    await page.locator('[data-balanced-layer] button:has-text("Measure")').first().click()
    await expect(page.locator('[data-balanced-layer]')).toHaveAttribute('data-balanced-tool', 'measure')
    await sleep(300)

    const canvas = page.locator('[data-balanced-layer] .maplibregl-canvas').first()
    const box = await canvas.boundingBox()
    if (!box) throw new Error('no canvas')
    await page.evaluate(() => {
      const map = (window as {
        __hudMap?: {
          getCenter: () => { lat: number; lng: number }
          getCanvas: () => HTMLCanvasElement
          project: (lngLat: [number, number]) => { x: number; y: number }
          fire: (t: string, d: object) => void
        }
      }).__hudMap
      if (!map) return
      const c = map.getCenter()
      const lngLat = { lat: c.lat, lng: c.lng }
      const point = map.project([lngLat.lng, lngLat.lat])
      const canvas = map.getCanvas()
      map.fire('click', {
        lngLat,
        point,
        originalEvent: { target: canvas, preventDefault: () => {}, stopPropagation: () => {} },
      })
    })
    await sleep(400)

    const afterTap = await getWaypointCount(page)
    expect(afterTap).toBe(before)

    await page.locator('[data-balanced-layer] button:has-text("Measure")').first().click()
    await expect(page.locator('[data-balanced-layer]')).toHaveAttribute('data-balanced-tool', 'inspect')
  })

  test('delete confirmation stays open until explicit cancel', async ({ page }) => {
    await clickBalancedMap(page)
    await sleep(800)

    await page.waitForFunction(() => {
      const readKey = (key: string) => {
        const raw = localStorage.getItem(key)
        if (!raw) return 0
        try {
          return (JSON.parse(raw) as { waypoints?: unknown[] }).waypoints?.length ?? 0
        } catch {
          return 0
        }
      }
      const count = readKey('hud_osg_route_v1') || readKey('tactical_hud_app_state_v1')
      return count > 0
    }, { timeout: 10000 })

    const clearBtn = page.locator('[data-testid="clear-all"]').first()
    await expect(clearBtn).toBeVisible({ timeout: 10000 })
    await clearBtn.click()

    const dialog = page.locator('[data-testid="hud-confirm-dialog"]')
    await expect(dialog).toBeVisible()
    await sleep(600)
    await expect(dialog).toBeVisible()

    await page.locator('[data-testid="hud-confirm-cancel"]').click()
    await expect(dialog).toBeHidden()

    const count = await getWaypointCount(page)
    expect(count).toBeGreaterThan(0)
  })

  test('measure completes and releases interaction for radial reopen', async ({ page }) => {
    await page.locator('[data-balanced-layer] button:has-text("Measure")').first().click()
    await expect(page.locator('[data-balanced-layer]')).toHaveAttribute('data-balanced-tool', 'measure')

    const fireMapClick = () =>
      page.evaluate(() => {
        const map = (window as {
          __hudMap?: {
            getCenter: () => { lat: number; lng: number }
            getCanvas: () => HTMLCanvasElement
            project: (lngLat: [number, number]) => { x: number; y: number }
            fire: (t: string, d: object) => void
          }
        }).__hudMap
        if (!map) return false
        const c = map.getCenter()
        const lngLat = { lat: c.lat + 0.001, lng: c.lng + 0.001 }
        const point = map.project([lngLat.lng, lngLat.lat])
        map.fire('click', {
          lngLat,
          point,
          originalEvent: { target: map.getCanvas(), preventDefault: () => {}, stopPropagation: () => {} },
        })
        return true
      })

    await fireMapClick()
    await sleep(200)
    await fireMapClick()
    await sleep(400)

    await expect(page.locator('[data-balanced-layer]')).toHaveAttribute('data-balanced-tool', 'measure')
    await expect(page.locator('[data-testid="map-measure-readout"]')).toBeVisible({ timeout: 5000 })
    await page.waitForFunction(
      () => {
        const snap = (window as { __OPERATIONAL_GRAPH__?: () => { interaction: { pointerOwner: string } } }).__OPERATIONAL_GRAPH__?.()
        return snap?.interaction.pointerOwner === 'map'
      },
      { timeout: 5000 },
    )
  })

  test('waypoint panel path drops after panel toggle arms tool', async ({ page }) => {
    const before = await getWaypointCount(page)
    await page.locator('[data-balanced-layer] button:has-text("Waypoints")').first().click()
    await expect(page.locator('[data-balanced-panel="waypoints"]')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('[data-balanced-layer]')).toHaveAttribute('data-balanced-tool', 'waypoint')
    await clickBalancedMap(page)
    await page.waitForFunction(
      (prev) => {
        const readKey = (key: string) => {
          const raw = localStorage.getItem(key)
          if (!raw) return 0
          try {
            return (JSON.parse(raw) as { waypoints?: unknown[] }).waypoints?.length ?? 0
          } catch {
            return 0
          }
        }
        const count = readKey('hud_osg_route_v1') || readKey('tactical_hud_app_state_v1')
        return count > prev
      },
      before,
      { timeout: 10000 },
    )
  })

  test('layers panel opens from top bar', async ({ page }) => {
    await page.locator('[data-balanced-layer] button:has-text("Layers")').first().click()
    await expect(page.locator('[data-balanced-panel="overlays"]')).toBeVisible({ timeout: 5000 })
  })

  test('route tool opens route panel', async ({ page }) => {
    await page.locator('[data-balanced-layer] button:has-text("Route")').first().click()
    await expect(page.locator('[data-balanced-panel="route"]')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('[data-balanced-layer]')).toHaveAttribute('data-balanced-tool', 'route')
  })
})
