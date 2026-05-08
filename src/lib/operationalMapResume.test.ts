import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveMapBootView } from './operationalMapResume'

function mockStorage(initial: Record<string, string>) {
  const map = { ...initial }
  const ls = {
    getItem: vi.fn((k: string) => (k in map ? map[k] : null)),
    setItem: vi.fn((k: string, v: string) => {
      map[k] = String(v)
    }),
    removeItem: vi.fn((k: string) => {
      delete map[k]
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(map)) delete map[k]
    }),
  }
  vi.stubGlobal('localStorage', ls as unknown as Storage)
  return { map, ls }
}

describe('operationalMapResume', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('prefers fresh operational resume over viewport', () => {
    const now = Date.now()
    mockStorage({
      hud_operational_map_resume_v1: JSON.stringify({
        v: 1,
        lat: 40,
        lng: -106,
        zoom: 12,
        bearing: 0,
        pitch: 0,
        ts: now,
      }),
      hud_map_viewport_v1: JSON.stringify({
        lng: -100,
        lat: 35,
        zoom: 8,
        bearing: 0,
        pitch: 0,
        ts: now,
      }),
    })
    const b = resolveMapBootView()
    expect(b.kind).toBe('resume')
    expect(b.lat).toBe(40)
    expect(b.lng).toBe(-106)
    expect(b.zoom).toBe(12)
  })

  it('falls back to viewport when resume missing', () => {
    const now = Date.now()
    mockStorage({
      hud_map_viewport_v1: JSON.stringify({
        lng: -101,
        lat: 36,
        zoom: 9,
        bearing: 1,
        pitch: 2,
        ts: now,
      }),
    })
    const b = resolveMapBootView()
    expect(b.kind).toBe('viewport')
    expect(b.lat).toBe(36)
    expect(b.zoom).toBe(9)
    expect(b.bearing).toBe(1)
    expect(b.pitch).toBe(2)
  })

  it('falls back to last known GPS when resume and viewport missing', () => {
    mockStorage({
      lastKnownLocation: JSON.stringify({ lat: 38.5, lng: -107.2, timestamp: Date.now() }),
    })
    const b = resolveMapBootView()
    expect(b.kind).toBe('gps_seed')
    expect(b.lat).toBe(38.5)
    expect(b.lng).toBe(-107.2)
    expect(b.zoom).toBe(14)
  })

  it('uses static default when nothing stored', () => {
    mockStorage({})
    const b = resolveMapBootView()
    expect(b.kind).toBe('static')
    expect(b.lat).toBe(39.5501)
    expect(b.lng).toBe(-105.7821)
  })
})
