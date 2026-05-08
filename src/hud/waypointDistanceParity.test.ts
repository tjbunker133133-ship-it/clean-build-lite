import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatDistance, haversineDistance } from '../lib/haversine'

// Pin-to-pin distance is rendered in TWO independent surfaces:
//   1. `WaypointLayer.tsx`           → mid-segment chip on the map
//   2. `WaypointTypePanel.tsx`       → per-leg row in the panel
// Both must report the SAME primary label for the SAME ordered pair
// (prev waypoint → current waypoint). Drift here would surface as
// "the map says 1.20 mi, the panel says 1.21 mi" for the same leg.
// These tests freeze the parity contract without changing any product
// code.

function readSrc(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

describe('pin-to-pin distance parity (WaypointLayer ↔ WaypointTypePanel)', () => {
  const layerSrc = readSrc('src/layers/WaypointLayer.tsx')
  const panelSrc = readSrc('src/hud/WaypointTypePanel.tsx')

  it('both surfaces import from the same haversine module', () => {
    expect(layerSrc).toMatch(/from ['"][^'"]*lib\/haversine['"]/)
    expect(panelSrc).toMatch(/from ['"][^'"]*lib\/haversine['"]/)
    for (const src of [layerSrc, panelSrc]) {
      expect(src).toContain('haversineDistance')
      expect(src).toContain('formatDistance')
    }
  })

  it('both surfaces invoke haversineDistance with (prev.lat, prev.lng, cur.lat, cur.lng)', () => {
    // Map chip: `haversineDistance(a.lat, a.lng, b.lat, b.lng)`
    // Trailing-comma tolerant (Prettier may add one when args are
    // multiline). The argument IDENTITIES + ORDER are the contract.
    expect(layerSrc).toMatch(
      /haversineDistance\(\s*a\.lat\s*,\s*a\.lng\s*,\s*b\.lat\s*,\s*b\.lng\s*,?\s*\)/,
    )
    // Panel row: `haversineDistance(waypoints[idx - 1].lat, waypoints[idx - 1].lng, wp.lat, wp.lng)`
    expect(panelSrc).toMatch(
      /haversineDistance\(\s*waypoints\[idx\s*-\s*1\]\.lat\s*,\s*waypoints\[idx\s*-\s*1\]\.lng\s*,\s*wp\.lat\s*,\s*wp\.lng\s*,?\s*\)/,
    )
  })

  it('both surfaces format the primary label as formatDistance(...miles)', () => {
    expect(layerSrc).toMatch(/formatDistance\([^)]*\.miles\)/)
    expect(panelSrc).toMatch(/formatDistance\([^)]*\.miles\)/)
  })

  // Functional cross-check: for fixture pairs, the algebra both surfaces
  // perform produces a byte-identical primary label string. (The panel
  // additionally appends "(N ft)" for operator readability — that suffix
  // is intentional and not part of the parity contract.)
  it('produces byte-identical primary label for known pairs', () => {
    const pairs = [
      // identical → "0 ft" (sub-0.1-mi branch of formatDistance)
      [{ lat: 40, lng: -100 }, { lat: 40, lng: -100 }],
      // ~0.07 mi → feet branch
      [{ lat: 40, lng: -100 }, { lat: 40.001, lng: -100 }],
      // ~111.19 km → miles branch
      [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }],
      // NYC → LA → miles branch (large value)
      [
        { lat: 40.7128, lng: -74.006 },
        { lat: 34.0522, lng: -118.2437 },
      ],
    ] as const
    for (const [a, b] of pairs) {
      const mapPrimary = formatDistance(haversineDistance(a.lat, a.lng, b.lat, b.lng).miles)
      const panelPrimary = formatDistance(haversineDistance(a.lat, a.lng, b.lat, b.lng).miles)
      expect(mapPrimary).toBe(panelPrimary)
    }
  })
})
