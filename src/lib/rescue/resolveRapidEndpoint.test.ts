import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  deriveSendRescueEmailUrl,
  isSendRescueEmailEndpoint,
  SEND_RESCUE_EMAIL_PATH,
} from './resolveRapidEndpoint'

describe('resolveRapidEndpoint', () => {
  it('resolves in priority order inside resolveRapidEndpointMeta', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/rescue/resolveRapidEndpoint.ts'), 'utf8')
    const metaStart = src.indexOf('export function resolveRapidEndpointMeta')
    expect(metaStart).toBeGreaterThan(-1)
    const body = src.slice(metaStart)
    const rescuePos = body.indexOf("readViteEnv('VITE_RESCUE_EMAIL_URL')")
    const derivedPos = body.indexOf('deriveSendRescueEmailUrl(readViteEnv')
    const rapidPos = body.indexOf("readViteEnv('VITE_RAPID_ENDPOINT_URL')")
    const heartbeatPos = body.indexOf('readHeartbeatFnUrlFromLocalStorage')
    expect(rescuePos).toBeGreaterThan(-1)
    expect(derivedPos).toBeGreaterThan(-1)
    expect(rapidPos).toBeGreaterThan(-1)
    expect(heartbeatPos).toBeGreaterThan(-1)
    expect(rescuePos).toBeLessThan(derivedPos)
    expect(derivedPos).toBeLessThan(rapidPos)
    expect(rapidPos).toBeLessThan(heartbeatPos)
  })

  it('SOS, Deadman, and Check-in panels import the shared resolver', () => {
    for (const file of ['SOSPanel.tsx', 'DeadManPanel.tsx', 'CheckInPanel.tsx']) {
      const src = readFileSync(join(process.cwd(), 'src/hud', file), 'utf8')
      expect(src).toContain("from '../lib/rescue/resolveRapidEndpoint'")
      expect(src).not.toMatch(/function resolveRapidEndpoint\(\): string \{/)
    }
  })

  it('accepts only send-rescue-email URLs', () => {
    const base = 'https://example.supabase.co'
    expect(isSendRescueEmailEndpoint(`${base}${SEND_RESCUE_EMAIL_PATH}`)).toBe(true)
    expect(isSendRescueEmailEndpoint(`${base}/functions/v1/rapid-endpoint`)).toBe(false)
    expect(isSendRescueEmailEndpoint('')).toBe(false)
  })

  it('derives canonical rescue URL from supabase project URL', () => {
    expect(deriveSendRescueEmailUrl('https://proj.supabase.co/')).toBe(
      `https://proj.supabase.co${SEND_RESCUE_EMAIL_PATH}`,
    )
  })

  it('prefers derived send-rescue-email over legacy rapid-endpoint paths', () => {
    expect(
      isSendRescueEmailEndpoint('https://proj.supabase.co/functions/v1/rapid-endpoint'),
    ).toBe(false)
    expect(deriveSendRescueEmailUrl('https://proj.supabase.co')).toContain('send-rescue-email')
  })
})
