import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchOverpassGeojson, resetOverpassQueueForTests } from './overpass'

const bbox = { south: 39.5, west: -105.2, north: 39.7, east: -105.0 }
const OVERPASS_STAGGER_MS = 1_000

describe('overpass fetch queue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetOverpassQueueForTests()
  })

  afterEach(() => {
    resetOverpassQueueForTests()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('staggers starts and caps concurrent Overpass POSTs', async () => {
    const startTimes: number[] = []
    let inFlight = 0
    let maxInFlight = 0

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        startTimes.push(Date.now())
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 100))
        inFlight--
        return new Response(JSON.stringify({ elements: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const p1 = fetchOverpassGeojson('bike_paths', bbox)
    const p2 = fetchOverpassGeojson('mines', bbox)
    const p3 = fetchOverpassGeojson('camping', bbox)

    await vi.runAllTimersAsync()
    await Promise.all([p1, p2, p3])

    expect(startTimes).toHaveLength(3)
    expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(OVERPASS_STAGGER_MS)
    expect(maxInFlight).toBeLessThanOrEqual(1)
  })
})
