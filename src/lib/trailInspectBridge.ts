/** Tier 2 bridge: MapCanvas dispatches map taps; NavigationHud registers the handler. */

export type TrailInspectTapHandler = (lat: number, lng: number) => void

let handler: TrailInspectTapHandler | null = null

export function setTrailInspectTapHandler(fn: TrailInspectTapHandler | null): void {
  handler = fn
}

export function dispatchTrailInspectTap(lat: number, lng: number): void {
  if (!handler) return
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  handler(lat, lng)
}
