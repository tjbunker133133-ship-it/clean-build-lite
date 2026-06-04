import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSnapDiagnosticEvents, resetSnapDiagnosticsForTests } from './snapDiagnostics'
import {
  observeWaypointDropAfterCommit,
  resetWaypointSnapBridgeForTests,
} from './waypointSnapBridge'
import * as snapFlags from './snapFeatureFlags'
import { resetSnapFeatureFlagsCacheForTests } from './snapFeatureFlags'

describe('waypointSnapBridge', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetSnapFeatureFlagsCacheForTests()
    resetSnapDiagnosticsForTests()
    resetWaypointSnapBridgeForTests()
  })

  it('records tier1 outcome when diagnostics on and pipeline off', () => {
    vi.stubEnv('VITE_ENABLE_SNAP_PIPELINE', 'false')
    vi.stubEnv('VITE_ENABLE_SNAP_DIAGNOSTICS', 'true')
    resetSnapFeatureFlagsCacheForTests()

    observeWaypointDropAfterCommit({
      getMap: () => null,
      tapLat: 39.74,
      tapLng: -105.0,
      tier1: {
        committed: true,
        source: 'raw',
        lat: 39.74,
        lng: -105.0,
        rawLat: 39.74,
        rawLng: -105.0,
        snapDistanceMeters: null,
        tier1SnapAttempted: false,
        tier1SnapAccepted: false,
      },
    })

    const events = getSnapDiagnosticEvents()
    expect(events.some((e) => e.kind === 'waypoint_snap')).toBe(true)
  })

  it('skips work when diagnostics and pipeline disabled', () => {
    resetSnapDiagnosticsForTests()
    vi.spyOn(snapFlags, 'readSnapFeatureFlags').mockReturnValue({
      pipelineEnabled: false,
      validationEnabled: true,
      diagnosticsEnabled: false,
    })

    observeWaypointDropAfterCommit({
      getMap: () => null,
      tapLat: 1,
      tapLng: 2,
      tier1: {
        committed: true,
        source: 'raw',
        lat: 1,
        lng: 2,
        rawLat: 1,
        rawLng: 2,
        snapDistanceMeters: null,
        tier1SnapAttempted: false,
        tier1SnapAccepted: false,
      },
    })

    expect(getSnapDiagnosticEvents()).toHaveLength(0)
  })
})
