/**
 * ModernUserLocatorLayer — Modern Layer Only
 *
 * Field-grade operational locator replacing the classic red circle in immersive mode.
 * GPU/CSS only — no extra map sources.
 */

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import { useHudPresentation } from '../context/HudPresentationContext'
import { useGPS } from '../hooks/useGPS'
import { useDeviceHeading } from '../hooks/useDeviceHeading'
import { useMovementEngine } from '../hooks/useMovementEngine'
import { useReducedMotion } from '../hooks/useReducedMotion'

const MARKER_CLASS = 'hud-modern-user-locator'

function accuracyRingPx(accuracyM: number | null): number {
  if (accuracyM == null || accuracyM <= 0) return 28
  return Math.min(56, Math.max(22, Math.round(accuracyM * 0.55)))
}

function createLocatorElement(
  headingDeg: number,
  hasHeading: boolean,
  accuracyM: number | null,
  reducedMotion: boolean,
): HTMLDivElement {
  const root = document.createElement('div')
  root.className = MARKER_CLASS
  root.setAttribute('data-testid', 'modern-user-locator')
  root.style.width = '64px'
  root.style.height = '64px'
  root.style.position = 'relative'
  root.style.pointerEvents = 'none'

  const accuracy = document.createElement('div')
  accuracy.style.position = 'absolute'
  accuracy.style.top = '50%'
  accuracy.style.left = '50%'
  const ringPx = accuracyRingPx(accuracyM)
  accuracy.style.width = `${ringPx}px`
  accuracy.style.height = `${ringPx}px`
  accuracy.style.transform = 'translate(-50%, -50%)'
  accuracy.style.borderRadius = '50%'
  accuracy.style.border = '1.5px solid rgba(0, 255, 180, 0.35)'
  accuracy.style.background = 'rgba(0, 255, 180, 0.06)'
  accuracy.style.boxShadow = '0 0 12px rgba(0, 255, 180, 0.15)'

  const pulse = document.createElement('div')
  pulse.style.position = 'absolute'
  pulse.style.top = '50%'
  pulse.style.left = '50%'
  pulse.style.width = '20px'
  pulse.style.height = '20px'
  pulse.style.transform = 'translate(-50%, -50%)'
  pulse.style.borderRadius = '50%'
  pulse.style.border = '2px solid rgba(0, 255, 180, 0.55)'
  if (!reducedMotion) {
    pulse.style.animation = 'hudLocatorPulse 2.8s ease-out infinite'
  }

  const wedge = document.createElement('div')
  wedge.style.position = 'absolute'
  wedge.style.top = '50%'
  wedge.style.left = '50%'
  wedge.style.width = '0'
  wedge.style.height = '0'
  wedge.style.transform = `translate(-50%, -50%) rotate(${headingDeg}deg)`
  wedge.style.borderLeft = '7px solid transparent'
  wedge.style.borderRight = '7px solid transparent'
  wedge.style.borderBottom = '14px solid rgba(0, 255, 180, 0.75)'
  wedge.style.marginTop = '-18px'
  wedge.style.opacity = hasHeading ? '0.9' : '0.25'
  wedge.style.filter = 'drop-shadow(0 0 4px rgba(0,255,180,0.4))'

  const core = document.createElement('div')
  core.style.position = 'absolute'
  core.style.top = '50%'
  core.style.left = '50%'
  core.style.width = '10px'
  core.style.height = '10px'
  core.style.transform = 'translate(-50%, -50%)'
  core.style.borderRadius = '50%'
  core.style.background = 'rgba(255, 255, 255, 0.95)'
  core.style.border = '2px solid rgba(0, 255, 180, 0.9)'
  core.style.boxShadow = '0 0 8px rgba(0, 255, 180, 0.5)'

  root.appendChild(accuracy)
  root.appendChild(pulse)
  root.appendChild(wedge)
  root.appendChild(core)

  if (!document.getElementById('hud-locator-keyframes')) {
    const style = document.createElement('style')
    style.id = 'hud-locator-keyframes'
    style.textContent = `
      @keyframes hudLocatorPulse {
        0% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.7; }
        70% { transform: translate(-50%, -50%) scale(1.35); opacity: 0; }
        100% { transform: translate(-50%, -50%) scale(1.35); opacity: 0; }
      }
    `
    document.head.appendChild(style)
  }

  return root
}

function updateLocatorElement(
  el: HTMLElement,
  headingDeg: number,
  hasHeading: boolean,
  accuracyM: number | null,
) {
  const wedge = el.children[2] as HTMLElement | undefined
  const accuracy = el.children[0] as HTMLElement | undefined
  if (wedge) {
    wedge.style.transform = `translate(-50%, -50%) rotate(${headingDeg}deg)`
    wedge.style.opacity = hasHeading ? '0.9' : '0.25'
  }
  if (accuracy) {
    const ringPx = accuracyRingPx(accuracyM)
    accuracy.style.width = `${ringPx}px`
    accuracy.style.height = `${ringPx}px`
  }
}

export function ModernUserLocatorLayer() {
  const { map } = useMapContext()
  const { mode } = useHudPresentation()
  const gps = useGPS()
  const deviceHeading = useDeviceHeading()
  const movement = useMovementEngine()
  const reducedMotion = useReducedMotion()

  const resolvedHeading = deviceHeading.heading ?? movement.headingDeg
  const hasHeading = deviceHeading.heading != null
    ? deviceHeading.status === 'active' || deviceHeading.status === 'level'
    : movement.hasHeading
  const isMoving = movement.state === 'moving_slow' || movement.state === 'moving_fast'
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const elRef = useRef<HTMLDivElement | null>(null)

  const isImmersive = mode === 'immersive'

  useEffect(() => {
    if (!map || !isImmersive) {
      markerRef.current?.remove()
      markerRef.current = null
      elRef.current = null
      return
    }
    if (gps.lat == null || gps.lng == null) return

    if (!markerRef.current) {
      const el = createLocatorElement(
        resolvedHeading,
        hasHeading,
        gps.accuracy,
        reducedMotion,
      )
      elRef.current = el
      markerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([gps.lng, gps.lat])
        .addTo(map)
      return
    }

    markerRef.current.setLngLat([gps.lng, gps.lat])
    if (elRef.current) {
      updateLocatorElement(
        elRef.current,
        resolvedHeading,
        hasHeading,
        gps.accuracy,
      )
      if (isMoving && elRef.current.children[1]) {
        const pulse = elRef.current.children[1] as HTMLElement
        pulse.style.borderColor = 'rgba(0, 255, 180, 0.75)'
      }
    }
  }, [
    map,
    isImmersive,
    gps.lat,
    gps.lng,
    gps.accuracy,
    resolvedHeading,
    hasHeading,
    isMoving,
    reducedMotion,
  ])

  useEffect(() => {
    return () => {
      markerRef.current?.remove()
      markerRef.current = null
      elRef.current = null
    }
  }, [])

  return null
}

export default ModernUserLocatorLayer
