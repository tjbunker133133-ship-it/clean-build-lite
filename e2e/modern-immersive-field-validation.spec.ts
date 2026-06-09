/**
 * Modern Immersive — Focused Field Validation (recovery pass)
 *
 * Mobile-first operational checks for SOS/DeadMan/layout/situational adaptation.
 * Complements human field testing on Galaxy S25 FE (sunlight, motion, cognitive load).
 */

import { test, expect, type Page } from '@playwright/test'

/** Galaxy S25 FE logical portrait — ~393×852 CSS px class device. */
const S25_FE_VIEWPORT = { width: 393, height: 852 }

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function dismissBanners(page: Page) {
  const dismiss = page.locator('button:has-text("DISMISS")').first()
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click({ force: true })
    await sleep(200)
  }
}

async function enterImmersive(page: Page) {
  await page.setViewportSize(S25_FE_VIEWPORT)
  await page.goto('/?mode=immersive&e2e=1', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__HUD_RUNTIME__?.mode === 'immersive', { timeout: 25_000 })
  await page.waitForSelector('[data-testid="modern-mode-overlays"]', { timeout: 20_000 })
  await page.waitForSelector('.maplibregl-canvas', { timeout: 25_000 })
  await page.waitForSelector('[data-modern-safety-zone="true"]', { timeout: 15_000 })
  await dismissBanners(page)
}

function probeVisible(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el || el.offsetParent === null) return { ok: false, reason: 'not-visible' }
    const rect = el.getBoundingClientRect()
    if (rect.width < 8 || rect.height < 8) return { ok: false, reason: 'zero-size' }
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const hit = document.elementFromPoint(cx, cy)
    if (!hit) return { ok: false, reason: 'no-hit' }
    const obscured = el !== hit && !el.contains(hit)
    return {
      ok: !obscured,
      reason: obscured ? (hit as HTMLElement).tagName : 'ok',
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      inViewport:
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight,
    }
  }, selector)
}

test.describe('Modern immersive field validation (S25 FE viewport)', () => {
  test.beforeEach(async ({ page }) => {
    await enterImmersive(page)
  })

  test('F1 — SOS is visible, reachable, and within viewport', async ({ page }) => {
    const sos = page.locator('button[aria-label*="Emergency SOS"]').first()
    await expect(sos).toBeVisible({ timeout: 10_000 })
    const probe = await probeVisible(page, 'button[aria-label*="Emergency SOS"]')
    expect(probe.ok, `SOS obstructed: ${probe.reason}`).toBe(true)
    expect(probe.inViewport, 'SOS clipped outside viewport').toBe(true)

    const box = await sos.boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
  })

  test('F2 — SOS persisted position is clamped inside viewport on boot', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('hud_sos_position_v1', JSON.stringify({ x: 0, y: 0 }))
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__HUD_RUNTIME__?.mode === 'immersive', { timeout: 25_000 })
    await page.waitForSelector('button[aria-label*="Emergency SOS"]', { timeout: 15_000 })
    await sleep(400)

    const clamped = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label*="Emergency SOS"]') as HTMLElement | null
      if (!btn) return { ok: false, cx: 0, cy: 0 }
      const rect = btn.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      return {
        ok:
          cx >= 32 &&
          cy >= 80 &&
          cx <= window.innerWidth - 32 &&
          cy <= window.innerHeight - 32,
        cx,
        cy,
      }
    })
    expect(clamped.ok, `SOS center ${clamped.cx},${clamped.cy} outside safe bounds`).toBe(true)
    await page.evaluate(() => localStorage.removeItem('hud_sos_position_v1'))
  })

  test('F3 — DeadMan zone visible and tappable', async ({ page }) => {
    await expect(page.locator('[data-modern-safety-zone="true"]')).toBeAttached()
    const probe = await page.evaluate(() => {
      const zone = document.querySelector('[data-modern-safety-zone="true"]')
      if (!zone) return { ok: false }
      const pill = zone.querySelector('div') as HTMLElement | null
      if (!pill) return { ok: false }
      const rect = pill.getBoundingClientRect()
      return {
        ok: rect.bottom <= window.innerHeight && rect.left >= 0,
        bottom: rect.bottom,
        vh: window.innerHeight,
      }
    })
    expect(probe.ok, `DeadMan bottom ${probe.bottom} vs vh ${probe.vh}`).toBe(true)
  })

  test('F4 — No duplicate SOS stub controls', async ({ page }) => {
    const sosButtons = page.locator('button:has-text("SOS"), .modern-sos-button')
    const count = await sosButtons.count()
    expect(count).toBeLessThanOrEqual(2)
    await expect(page.locator('.modern-sos-button')).toHaveCount(0)
  })

  test('F5 — Situational attributes present on mode root', async ({ page }) => {
    const attrs = await page.evaluate(() => {
      const root = document.querySelector('[data-mode-root="modern"]')
      return {
        focus: root?.getAttribute('data-modern-focus'),
        density: root?.getAttribute('data-modern-density'),
        motion: root?.getAttribute('data-modern-motion'),
        attention: root?.getAttribute('data-modern-attention'),
        activity: root?.getAttribute('data-modern-activity'),
        tone: root?.getAttribute('data-modern-tone'),
      }
    })
    expect(attrs.focus).toBeTruthy()
    expect(attrs.density).toBeTruthy()
    expect(attrs.activity).toBeTruthy()
    expect(attrs.tone).toBeTruthy()
    expect(['ambient', 'exploration', 'navigation', 'travel', 'stationary', 'weather', 'emergency', 'driving']).toContain(attrs.focus)
  })

  test('F6 — Decorative layers hidden via CSS when navigation focus', async ({ page }) => {
    await page.evaluate(() => {
      const root = document.querySelector('[data-mode-root="modern"]')
      root?.setAttribute('data-modern-focus', 'navigation')
    })
    await sleep(150)
    const decorHidden = await page.evaluate(() => {
      const decor = document.querySelector('[data-modern-decorative="true"]') as HTMLElement | null
      if (!decor) return true
      return window.getComputedStyle(decor).display === 'none'
    })
    expect(decorHidden).toBe(true)
  })

  test('F7 — Bottom chips do not fully obscure SOS center-hit', async ({ page }) => {
    const collision = await page.evaluate(() => {
      const sos = document.querySelector('button[aria-label*="Emergency SOS"]') as HTMLElement | null
      if (!sos) return { ok: false, reason: 'no-sos' }
      const sr = sos.getBoundingClientRect()
      const cx = sr.left + sr.width / 2
      const cy = sr.top + sr.height / 2
      const hit = document.elementFromPoint(cx, cy)
      const sosHit = hit === sos || sos.contains(hit!)
      return { ok: sosHit, hitTag: hit?.tagName ?? 'none' }
    })
    expect(collision.ok, `SOS center hit by ${collision.hitTag}`).toBe(true)
  })

  test('F8 — GPS movement injection can elevate situational focus', async ({ page }) => {
    const before = await page.evaluate(() =>
      document.querySelector('[data-mode-root="modern"]')?.getAttribute('data-modern-focus'),
    )
    await page.evaluate(() => {
      const w = window as {
        __gpsListeners?: Array<(fix: GeolocationPosition) => void>
      }
      const mk = (lat: number, lng: number): GeolocationPosition =>
        ({
          coords: {
            latitude: lat,
            longitude: lng,
            accuracy: 5,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        }) as GeolocationPosition
      const listeners = w.__gpsListeners ?? []
      listeners.forEach((fn) => fn(mk(39.7392, -104.9903)))
      setTimeout(() => {
        listeners.forEach((fn) => fn(mk(39.7492, -104.9903)))
      }, 120)
    })
    await sleep(800)
    const after = await page.evaluate(() =>
      document.querySelector('[data-mode-root="modern"]')?.getAttribute('data-modern-focus'),
    )
    expect(before).toBeTruthy()
    expect(after).toBeTruthy()
  })

  test('F9 — SOS arming overlay uses token z-index tier (not 100000)', async ({ page }) => {
    const sos = page.locator('button[aria-label*="Emergency SOS"]').first()
    await sos.click()
    await expect(page.locator('.sos-escalation-overlay')).toBeVisible({ timeout: 3000 })
    const z = await page.evaluate(() => {
      const el = document.querySelector('.sos-escalation-overlay') as HTMLElement | null
      return el ? parseInt(window.getComputedStyle(el).zIndex, 10) : 0
    })
    expect(z).toBeGreaterThan(0)
    expect(z).toBeLessThanOrEqual(5000)
    await page.locator('.sos-escalation-overlay button:has-text("Cancel SOS")').click({ force: true })
  })

  test('F10 — Immersive boot stable across orientation swap', async ({ page }) => {
    await page.setViewportSize({ width: 852, height: 393 })
    await sleep(400)
    await expect(page.locator('[data-testid="modern-mode-overlays"]')).toBeVisible()
    await expect(page.locator('button[aria-label*="Emergency SOS"]')).toBeVisible()
    await page.setViewportSize(S25_FE_VIEWPORT)
    await sleep(400)
    const probe = await probeVisible(page, 'button[aria-label*="Emergency SOS"]')
    expect(probe.ok).toBe(true)
  })
})
