import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('resolveRapidEndpoint', () => {
  it('references VITE_RESCUE_EMAIL_URL before VITE_RAPID_ENDPOINT_URL', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/rescue/resolveRapidEndpoint.ts'), 'utf8')
    const rescuePos = src.indexOf('VITE_RESCUE_EMAIL_URL')
    const rapidPos = src.indexOf('VITE_RAPID_ENDPOINT_URL')
    const heartbeatPos = src.indexOf('heartbeatFnUrl')
    expect(rescuePos).toBeGreaterThan(-1)
    expect(rapidPos).toBeGreaterThan(-1)
    expect(heartbeatPos).toBeGreaterThan(-1)
    expect(rescuePos).toBeLessThan(rapidPos)
    expect(rapidPos).toBeLessThan(heartbeatPos)
  })

  it('SOS, Deadman, and Check-in panels import the shared resolver', () => {
    for (const file of ['SOSPanel.tsx', 'DeadManPanel.tsx', 'CheckInPanel.tsx']) {
      const src = readFileSync(join(process.cwd(), 'src/hud', file), 'utf8')
      expect(src).toContain("from '../lib/rescue/resolveRapidEndpoint'")
      expect(src).not.toMatch(/function resolveRapidEndpoint\(\): string \{/)
    }
  })
})
