import { chromium, webkit } from 'playwright'

const URL = 'https://clean-build-lite-xn62.vercel.app'

async function run() {
  const browser = await webkit.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()
  await page.goto(URL, { waitUntil: 'networkidle' })

  await page.waitForSelector('.cockpit-panel', { timeout: 15000 })
  const panelCount = await page.locator('.cockpit-panel').count()

  const panel = page.locator('.cockpit-panel').first()
  const header = panel.locator('[role="banner"]').first()
  const before = await panel.boundingBox()
  if (!before) throw new Error('No panel bounding box before drag')

  const startX = Math.round(before.x + Math.min(40, before.width / 2))
  const startY = Math.round(before.y + 22)
  const endX = startX + 120
  const endY = startY + 40
  await page.evaluate(
    ({ sx, sy, ex, ey }) => {
      const header = document.querySelector('.cockpit-panel [role="banner"]')
      if (!header) return
      const common = {
        pointerId: 1,
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerType: 'touch',
        isPrimary: true,
      }
      header.dispatchEvent(new PointerEvent('pointerdown', { ...common, clientX: sx, clientY: sy, button: 0 }))
      header.dispatchEvent(new PointerEvent('pointermove', { ...common, clientX: sx + 4, clientY: sy + 4, button: 0 }))
      document.dispatchEvent(new PointerEvent('pointermove', { ...common, clientX: ex, clientY: ey, button: 0 }))
      document.dispatchEvent(new PointerEvent('pointerup', { ...common, clientX: ex, clientY: ey, button: 0 }))
    },
    { sx: startX, sy: startY, ex: endX, ey: endY },
  )
  await page.waitForTimeout(250)

  const after = await panel.boundingBox()
  if (!after) throw new Error('No panel bounding box after drag')
  const moved = Math.abs(after.x - before.x) > 8 || Math.abs(after.y - before.y) > 8

  // Try dock left
  const leftStartX = after.x + Math.min(30, after.width / 2)
  const leftStartY = after.y + 22
  await page.mouse.move(leftStartX, leftStartY)
  await page.mouse.down()
  await page.mouse.move(2, leftStartY, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(300)

  const transform = await panel.evaluate((el) => getComputedStyle(el).transform || '')
  const dockedLikely = transform && transform !== 'none'

  // Check major runtime errors
  const errors = []
  page.on('pageerror', (err) => errors.push(String(err)))

  console.log(
    JSON.stringify(
      {
        ok: moved && panelCount > 0,
        panelCount,
        moved,
        dockedLikely,
        runtimeErrors: errors.slice(0, 5),
      },
      null,
      2,
    ),
  )

  await context.close()
  await browser.close()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
