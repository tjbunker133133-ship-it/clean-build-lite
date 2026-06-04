import { describe, expect, it, vi } from 'vitest'
import stationaryFixture from './fixtures/stationary-drift-replay.json'
import { SnapPipeline } from './snapPipeline'
import type { SnapProvider } from './snapProvider'
import type { RawGpsPoint, SnappedTrackPoint } from './types'

const mockSnapped: SnappedTrackPoint = {
  snappedLat: 39.73925,
  snappedLng: -104.99025,
  snappedRoadName: 'path',
  confidenceScore: 0.82,
  snapDistanceMeters: 6,
  sourceProvider: 'maplibre-local',
  rawTimestampMs: 0,
  processedAtMs: 0,
}

function mockProvider(): SnapProvider {
  return {
    id: 'maplibre-local',
    isAvailable: () => true,
    snap: vi.fn(async (req) => ({
      ...mockSnapped,
      rawTimestampMs: req.raw.timestampMs,
      processedAtMs: req.raw.timestampMs + 50,
    })),
  }
}

describe('snapPipeline replay', () => {
  it('replays fixture and defers poor-accuracy tail', async () => {
    const pipeline = new SnapPipeline({ provider: mockProvider() })
    const base = Date.now()
    let accepted = 0
    let deferred = 0

    for (const row of stationaryFixture as Array<{
      lat: number
      lng: number
      accuracy: number
      heading: number | null
      speed: number
      timestampMs: number
    }>) {
      const raw: RawGpsPoint = {
        lat: row.lat,
        lng: row.lng,
        accuracy: row.accuracy,
        heading: row.heading,
        speed: row.speed,
        timestampMs: base + row.timestampMs,
      }
      const result = await pipeline.process(raw)
      if (result.phase === 'accepted') accepted++
      if (result.phase === 'deferred') deferred++
    }

    expect(accepted).toBeGreaterThan(0)
    expect(deferred).toBeGreaterThan(0)
  })
})
