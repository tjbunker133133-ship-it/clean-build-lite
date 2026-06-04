/** Ground-truth sensor sample — never overwritten by snapping. */
export type RawGpsPoint = {
  lat: number
  lng: number
  accuracy: number | null
  heading: number | null
  speed: number | null
  timestampMs: number
  source?: 'gps' | 'cached' | 'ip'
}

/** Road/path corrected sample — stored separately from raw. */
export type SnappedTrackPoint = {
  snappedLat: number
  snappedLng: number
  snappedRoadName: string | null
  confidenceScore: number
  snapDistanceMeters: number
  sourceProvider: SnapProviderId
  rawTimestampMs: number
  processedAtMs: number
}

export type SnapProviderId =
  | 'maplibre-local'
  | 'osrm'
  | 'graphhopper'
  | 'valhalla'
  | 'mapbox'
  | 'none'

export type SnapPipelinePhase =
  | 'idle'
  | 'raw_capture'
  | 'gps_validation'
  | 'snap_request'
  | 'snap_validation'
  | 'accepted'
  | 'rejected'
  | 'deferred'

export type DualTrackSample = {
  raw: RawGpsPoint
  snapped: SnappedTrackPoint | null
  phase: SnapPipelinePhase
}
