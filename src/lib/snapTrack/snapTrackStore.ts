import type { DualTrackSample, RawGpsPoint, SnappedTrackPoint } from './types'

const DEFAULT_RAW_CAP = 512
const DEFAULT_SNAP_CAP = 512

export class DualTrackStore {
  private raw: RawGpsPoint[] = []
  private snapped: SnappedTrackPoint[] = []
  private samples: DualTrackSample[] = []

  constructor(
    private readonly rawCap = DEFAULT_RAW_CAP,
    private readonly snapCap = DEFAULT_SNAP_CAP,
    private readonly sampleCap = DEFAULT_RAW_CAP,
  ) {}

  appendRaw(point: RawGpsPoint): void {
    this.raw.push(point)
    if (this.raw.length > this.rawCap) this.raw.shift()
  }

  appendSnapped(point: SnappedTrackPoint): void {
    this.snapped.push(point)
    if (this.snapped.length > this.snapCap) this.snapped.shift()
  }

  recordSample(sample: DualTrackSample): void {
    this.samples.push(sample)
    if (this.samples.length > this.sampleCap) this.samples.shift()
    this.appendRaw(sample.raw)
    if (sample.snapped) this.appendSnapped(sample.snapped)
  }

  getRecentRaw(count = 32): RawGpsPoint[] {
    return this.raw.slice(-count)
  }

  getRecentSnapped(count = 32): SnappedTrackPoint[] {
    return this.snapped.slice(-count)
  }

  getRecentSamples(count = 32): DualTrackSample[] {
    return this.samples.slice(-count)
  }

  reset(): void {
    this.raw = []
    this.snapped = []
    this.samples = []
  }
}

/** Process-wide store for diagnostics / future breadcrumb render. */
export const globalSnapTrackStore = new DualTrackStore()
