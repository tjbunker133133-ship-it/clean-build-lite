import { describe, expect, it } from 'vitest'
import {
  evaluateCompassHealth,
  evaluateLayoutHealth,
  evaluateOverlayHealth,
  evaluateRouteHealth,
  evaluateSnapHealth,
  aggregateTier2Usability,
} from './evaluators'

describe('hudConsistency evaluators', () => {
  it('flags missing polyline when waypoints exist without geometry', () => {
    const r = evaluateRouteHealth({
      waypointCount: 3,
      snapEnabled: false,
      pinLineFeatureCount: 0,
      trailLineFeatureCount: 0,
      trailLegCount: 2,
      trailLegTrailModeCount: 0,
    })
    expect(r.level).toBe('missing')
    expect(r.routeRenderMode).toBe('none')
    expect(r.warnings).toContain('missing_polyline_despite_waypoints')
  })

  it('prefers trail render mode when trail geometry present', () => {
    const r = evaluateRouteHealth({
      waypointCount: 3,
      snapEnabled: true,
      pinLineFeatureCount: 0,
      trailLineFeatureCount: 1,
      trailLegCount: 2,
      trailLegTrailModeCount: 2,
    })
    expect(r.routeRenderMode).toBe('trail')
    expect(r.level).toBe('ok')
  })

  it('uses fallback straight when pin line present', () => {
    const r = evaluateRouteHealth({
      waypointCount: 2,
      snapEnabled: false,
      pinLineFeatureCount: 1,
      trailLineFeatureCount: 0,
      trailLegCount: 1,
      trailLegTrailModeCount: 0,
    })
    expect(r.routeRenderMode).toBe('fallback_straight')
  })

  it('detects vector trails present but toggle disabled', () => {
    const s = evaluateSnapHealth({
      toggleCapable: false,
      toggleEnabled: false,
      zoom: 14,
      minSnapZoom: 12,
      styleHasVectorTrails: true,
      overlaySnapLayersActive: false,
      mapPresent: true,
    })
    expect(s.eligibility).toBe('available')
    expect(s.warnings).toContain('vector_data_present_toggle_disabled')
    expect(s.level).toBe('degraded')
  })

  it('classifies overlay fallback snap eligibility', () => {
    const s = evaluateSnapHealth({
      toggleCapable: true,
      toggleEnabled: false,
      zoom: 13,
      minSnapZoom: 12,
      styleHasVectorTrails: false,
      overlaySnapLayersActive: true,
      mapPresent: true,
    })
    expect(s.eligibility).toBe('fallback_only')
    expect(s.snap_status_reason).toBe('overlay_path_fallback')
  })

  it('flags silent overlay failure', () => {
    const o = evaluateOverlayHealth([
      { id: 'bike_paths', toggle: true, loading: false, error: null, layerOnMap: false },
    ])
    expect(o.level).toBe('degraded')
    expect(o.warnings.some((w) => w.startsWith('overlay_silent_failure'))).toBe(true)
    expect(o.layerStatus.bike_paths.status).toBe('pending')
  })

  it('detects overlapping panels', () => {
    const l = evaluateLayoutHealth({
      panels: {
        a: { x: 10, y: 60, w: 280, h: 200, docked: true },
        b: { x: 20, y: 80, w: 280, h: 200, docked: true },
      },
      vw: 390,
      vh: 844,
      isMobile: true,
    })
    expect(l.level).toBe('overlapping')
    expect(l.overlapCount).toBeGreaterThan(0)
  })

  it('flags quadrant jump on compass', () => {
    const c = evaluateCompassHealth({
      heading: 180,
      status: 'active',
      nowMs: 10_000,
      lastHeading: 10,
      lastChangeMs: 9_000,
      lastQuadrantJumpMs: null,
    })
    expect(c.level).toBe('unstable')
    expect(c.warnings).toContain('quadrant_jump')
  })

  it('allows level status with heading as degraded not blocked', () => {
    const c = evaluateCompassHealth({
      heading: 45,
      status: 'level',
      nowMs: 5_000,
      lastHeading: 44,
      lastChangeMs: 4_900,
      lastQuadrantJumpMs: null,
    })
    expect(c.level).toBe('ok')
  })

  it('aggregates domain health into overall usability', () => {
    expect(
      aggregateTier2Usability({
        compass: 'ok',
        route: 'ok',
        snap: 'ok',
        overlay: 'ok',
        layout: 'ok',
      }),
    ).toBe('ok')
    expect(
      aggregateTier2Usability({
        compass: 'degraded',
        route: 'ok',
        snap: 'ok',
        overlay: 'ok',
        layout: 'ok',
      }),
    ).toBe('degraded')
    expect(
      aggregateTier2Usability({
        compass: 'unstable',
        route: 'missing',
        snap: 'blocked',
        overlay: 'ok',
        layout: 'overlapping',
      }),
    ).toBe('unstable')
  })
})
