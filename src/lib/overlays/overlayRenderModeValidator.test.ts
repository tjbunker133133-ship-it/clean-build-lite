import { describe, it, expect, vi } from 'vitest'
import {
  validateOverlayDefinition,
  validateOverlayCatalog,
  assertSituationalNoZoomGate,
} from './overlayRenderModeValidator'
import type { EnvironmentalOverlayDef } from '../environmentalOverlays/types'
import * as forensics from '../../runtime/runtimeForensics'

// Spy on forensics tracing
const traceOverlaySpy = vi.spyOn(forensics, 'traceOverlay').mockImplementation(() => {})

describe('validateOverlayDefinition', () => {
  it('validates correct situational overlay without minZoom', () => {
    const def: EnvironmentalOverlayDef = {
      id: 'fire_firms',
      label: 'Active fire',
      hint: 'NASA FIRMS',
      delivery: 'raster-wms',
      onlinePreferred: true,
      offlineCacheable: false,
      attribution: 'NASA',
      renderMode: 'situational',
    }

    const result = validateOverlayDefinition(def)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('validates correct situational overlay with minZoom (warning)', () => {
    const def: EnvironmentalOverlayDef = {
      id: 'relief_usgs',
      label: 'Shaded relief',
      hint: 'USGS',
      delivery: 'raster-wms',
      onlinePreferred: true,
      offlineCacheable: false,
      attribution: 'USGS',
      renderMode: 'situational',
      minZoom: 6, // Legacy minZoom - allowed but discouraged
    }

    const result = validateOverlayDefinition(def)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('situational overlay has minZoom')
    expect(result.warnings[0]).toContain('will be ignored')
  })

  it('validates correct detail overlay with minZoom', () => {
    const def: EnvironmentalOverlayDef = {
      id: 'hiking_trails',
      label: 'Hiking paths',
      hint: 'OSM trails',
      delivery: 'geojson-overpass',
      onlinePreferred: false,
      offlineCacheable: true,
      attribution: 'OSM',
      renderMode: 'detail',
      minZoom: 9,
    }

    const result = validateOverlayDefinition(def)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('fails when renderMode is missing', () => {
    const def = {
      id: 'test_overlay' as const,
      label: 'Test',
      hint: 'Test overlay',
      delivery: 'geojson-overpass' as const,
      onlinePreferred: false,
      offlineCacheable: true,
      attribution: 'Test',
      minZoom: 8,
    } as unknown as EnvironmentalOverlayDef

    // Force undefined renderMode
    def.renderMode = undefined as any

    const result = validateOverlayDefinition(def)

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('renderMode is required')
  })

  it('fails when renderMode is invalid', () => {
    const def = {
      id: 'test_overlay' as const,
      label: 'Test',
      hint: 'Test overlay',
      delivery: 'geojson-overpass' as const,
      onlinePreferred: false,
      offlineCacheable: true,
      attribution: 'Test',
      minZoom: 8,
      renderMode: 'invalid_mode' as any,
    } as unknown as EnvironmentalOverlayDef

    const result = validateOverlayDefinition(def)

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('invalid renderMode')
    expect(result.errors[0]).toContain('invalid_mode')
  })

  it('fails when detail overlay is missing minZoom', () => {
    const def: EnvironmentalOverlayDef = {
      id: 'bike_paths',
      label: 'Bike paths',
      hint: 'OSM cycleways',
      delivery: 'geojson-overpass',
      onlinePreferred: false,
      offlineCacheable: true,
      attribution: 'OSM',
      renderMode: 'detail',
      // minZoom is missing - should fail
    }

    const result = validateOverlayDefinition(def)

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('detail overlays MUST have minZoom')
  })

  it('fails when detail overlay has negative minZoom', () => {
    const def: EnvironmentalOverlayDef = {
      id: 'mines',
      label: 'Mines',
      hint: 'Mine features',
      delivery: 'geojson-overpass',
      onlinePreferred: false,
      offlineCacheable: true,
      attribution: 'OSM',
      renderMode: 'detail',
      minZoom: -1,
    }

    const result = validateOverlayDefinition(def)

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('minZoom must be a number >= 0')
  })

  it('fails when detail overlay has non-numeric minZoom', () => {
    const def = {
      id: 'camping' as const,
      label: 'Camping',
      hint: 'Campgrounds',
      delivery: 'geojson-overpass' as const,
      onlinePreferred: false,
      offlineCacheable: true,
      attribution: 'OSM',
      renderMode: 'detail' as const,
      minZoom: '8' as any, // String instead of number
    } as unknown as EnvironmentalOverlayDef

    const result = validateOverlayDefinition(def)

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('minZoom must be a number >= 0')
  })

  it('accepts detail overlay with minZoom of 0', () => {
    const def: EnvironmentalOverlayDef = {
      id: 'public_lands',
      label: 'Public lands',
      hint: 'Federal lands',
      delivery: 'raster-wms',
      onlinePreferred: true,
      offlineCacheable: false,
      attribution: 'USGS',
      renderMode: 'detail',
      minZoom: 0,
    }

    const result = validateOverlayDefinition(def)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })
})

describe('validateOverlayCatalog', () => {
  it('validates a complete valid catalog', () => {
    const catalog: EnvironmentalOverlayDef[] = [
      {
        id: 'fire_firms',
        label: 'Active fire',
        hint: 'NASA FIRMS',
        delivery: 'raster-wms',
        onlinePreferred: true,
        offlineCacheable: false,
        attribution: 'NASA',
        renderMode: 'situational',
      },
      {
        id: 'hiking_trails',
        label: 'Hiking paths',
        hint: 'OSM trails',
        delivery: 'geojson-overpass',
        onlinePreferred: false,
        offlineCacheable: true,
        attribution: 'OSM',
        renderMode: 'detail',
        minZoom: 9,
      },
    ]

    const result = validateOverlayCatalog(catalog)

    expect(result.valid).toBe(true)
    expect(result.totalErrors).toBe(0)
    expect(result.totalWarnings).toBe(0)
    expect(result.blockingErrors).toHaveLength(0)
  })

  it('collects multiple errors from catalog', () => {
    const catalog: EnvironmentalOverlayDef[] = [
      {
        id: 'overlay_1',
        label: 'Overlay 1',
        hint: 'Test',
        delivery: 'geojson-overpass',
        onlinePreferred: false,
        offlineCacheable: true,
        attribution: 'Test',
        renderMode: 'detail',
        // Missing minZoom
      },
      {
        id: 'overlay_2',
        label: 'Overlay 2',
        hint: 'Test',
        delivery: 'geojson-overpass',
        onlinePreferred: false,
        offlineCacheable: true,
        attribution: 'Test',
        // Missing renderMode
      } as any,
    ]

    const result = validateOverlayCatalog(catalog)

    expect(result.valid).toBe(false)
    expect(result.totalErrors).toBe(2)
    expect(result.blockingErrors.length).toBeGreaterThan(0)
  })

  it('counts warnings but does not block', () => {
    const catalog = [
      {
        id: 'fire_firms' as const, // Use valid ID for type safety
        label: 'Test',
        hint: 'Test',
        delivery: 'raster-wms' as const,
        onlinePreferred: true,
        offlineCacheable: false,
        attribution: 'Test',
        renderMode: 'situational' as const,
        minZoom: 5, // Warning: situational with minZoom
      },
    ] as unknown as EnvironmentalOverlayDef[]

    const result = validateOverlayCatalog(catalog)

    expect(result.valid).toBe(true) // Valid because warnings don't block
    expect(result.totalWarnings).toBe(1)
    expect(result.totalErrors).toBe(0)
  })

  it('returns per-overlay results', () => {
    const catalog = [
      {
        id: 'fire_firms' as const, // Use valid situational ID
        label: 'Valid',
        hint: 'Test',
        delivery: 'raster-wms' as const,
        onlinePreferred: true,
        offlineCacheable: false,
        attribution: 'Test',
        renderMode: 'situational' as const,
      },
      {
        id: 'hiking_trails' as const, // Use valid detail ID
        label: 'Valid Detail',
        hint: 'Test',
        delivery: 'geojson-overpass' as const,
        onlinePreferred: false,
        offlineCacheable: true,
        attribution: 'Test',
        renderMode: 'detail' as const,
        minZoom: 8,
      },
    ] as unknown as EnvironmentalOverlayDef[]

    const result = validateOverlayCatalog(catalog)

    expect(result.results.size).toBe(2)
    expect(result.results.get('fire_firms')?.valid).toBe(true)
    expect(result.results.get('hiking_trails')?.valid).toBe(true)
  })
})

describe('assertSituationalNoZoomGate', () => {
  it('does nothing when renderMode is detail', () => {
    // Should not throw or log
    expect(() => {
      assertSituationalNoZoomGate('hiking_trails', 'detail', true)
    }).not.toThrow()
  })

  it('does nothing when zoom check is not performed', () => {
    // Should not throw or log
    expect(() => {
      assertSituationalNoZoomGate('fire_firms', 'situational', false)
    }).not.toThrow()
  })

  it('throws when situational overlay is zoom-gated in development', () => {
    // In the actual implementation, this throws in DEV mode
    // Since we can't easily mock import.meta.env, we test the throw behavior
    // by noting that the current test environment likely has DEV=true
    expect(() => {
      assertSituationalNoZoomGate('fire_firms', 'situational', true)
    }).toThrow('Situational overlay "fire_firms" is being zoom-gated')
  })

  it('detects zoom gate violation with correct trace parameters', () => {
    // Reset spy to ensure we only see this call
    traceOverlaySpy.mockClear()
    
    try {
      assertSituationalNoZoomGate('test_overlay', 'situational', true)
    } catch {
      // Expected to throw in test environment
    }

    expect(traceOverlaySpy).toHaveBeenCalledWith(
      'overlay_situational_misuse_warning',
      expect.objectContaining({
        overlayId: 'test_overlay',
        renderMode: 'situational',
        violation: 'zoom_gate_applied_to_situational',
      })
    )
  })
})
