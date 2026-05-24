import type { Map, Marker } from 'maplibre-gl'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { setWaypointMarkerTouchActive } from './waypointMarkerTouchGate'

/** MapLibre HTML-marker drag is flaky on iOS/WebKit; use pointer drag on coarse mobile field HUD. */
export function shouldUseWaypointPointerDrag(): boolean {
  const p = getDeviceProfile()
  return (
    p.interactionMode === 'mobile' &&
    (p.isCoarsePointer || p.isIOS || p.isAppleWebKit || p.isAndroid)
  )
}

function isDeleteBadgeTarget(target: EventTarget | null): boolean {
  return Boolean((target as HTMLElement | null)?.closest?.('.marker-badge'))
}

function clientPointToLngLat(map: Map, clientX: number, clientY: number) {
  const rect = map.getCanvas().getBoundingClientRect()
  return map.unproject([clientX - rect.left, clientY - rect.top])
}

export function bindWaypointMarkerPointerDrag(opts: {
  map: Map
  root: HTMLElement
  marker: Marker
  onCommit: (lng: number, lat: number) => void
}): void {
  const { map, root, marker, onCommit } = opts
  let dragging = false
  let activePointerId: number | null = null

  const finish = () => {
    if (!dragging) return
    dragging = false
    activePointerId = null
    root.classList.remove('marker--dragging')
    setWaypointMarkerTouchActive(false)
    try {
      map.dragPan.enable()
    } catch {
      /* ignore */
    }
    const pos = marker.getLngLat()
    onCommit(pos.lng, pos.lat)
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (isDeleteBadgeTarget(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    dragging = true
    activePointerId = e.pointerId
    root.classList.add('marker--dragging')
    setWaypointMarkerTouchActive(true)
    map.dragPan.disable()
    try {
      root.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || activePointerId !== e.pointerId) return
    e.preventDefault()
    e.stopPropagation()
    marker.setLngLat(clientPointToLngLat(map, e.clientX, e.clientY))
  }

  const onPointerUp = (e: PointerEvent) => {
    if (activePointerId !== e.pointerId) return
    e.preventDefault()
    e.stopPropagation()
    finish()
  }

  const onPointerCancel = (e: PointerEvent) => {
    if (activePointerId !== e.pointerId) return
    finish()
  }

  root.addEventListener('pointerdown', onPointerDown, { capture: true })
  root.addEventListener('pointermove', onPointerMove, { capture: true })
  root.addEventListener('pointerup', onPointerUp, { capture: true })
  root.addEventListener('pointercancel', onPointerCancel, { capture: true })
}

/** Suppress map pin-drop while pressing a marker (desktop MapLibre drag path). */
export function bindWaypointMarkerTouchSuppress(el: HTMLElement): void {
  const arm = (ev: Event) => {
    if (isDeleteBadgeTarget(ev.target)) return
    ev.stopPropagation()
    setWaypointMarkerTouchActive(true)
  }
  el.addEventListener('pointerdown', arm, { capture: true })
  el.addEventListener('touchstart', arm, { capture: true, passive: false })
}
