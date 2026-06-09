/**
 * Environmental Field Layer — Modern immersive mode only.
 *
 * FIM contract: fieldIntent is the sole control input.
 * All expression values come from computeFieldState(fieldIntent).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'
import { useHudPresentation } from '../context/HudPresentationContext'
import { useOperationalSession } from '../context/OperationalSessionContext'
import { useWeatherAtmosphere } from '../hooks/useWeatherAtmosphere'
import { useFieldIntentResolver } from '../hooks/useFieldIntentResolver'
import {
  computeFieldState,
  FIELD_TILE_EXPRESSION_MIN,
  type FieldState,
} from '../lib/fieldIntentModel'
import { getFieldIntent, subscribeFieldIntent } from '../lib/fieldIntentStore'
import {
  logModernGuardrailApplied,
  logModernGuardrailTransition,
} from '../lib/modernLayerGuardrails'
logModernGuardrailApplied('WeatherRadarLayer')

interface RadarFrame {
  time: number
  path: string
}

interface RainViewerApiResponse {
  host: string
  radar: {
    past: RadarFrame[]
    nowcast?: RadarFrame[]
  }
}

const RADAR_API_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const RADAR_SOURCE_ID = 'hud-weather-radar-source'
const RADAR_LAYER_ID = 'hud-weather-radar-layer'
const TILE_SIZE = 256
const COLOR_SCHEME = 4
const MAX_PAST_FRAMES = 6
const API_REFRESH_MS = 5 * 60 * 1000
/** Sustained radar outage before field intent drops to procedural (avoids boot flicker). */
const RADAR_SYSTEM_FAILURE_HOLD_MS = 12_000

type MapboxMap = maplibregl.Map

function buildTileUrl(host: string, path: string): string {
  const base = host.startsWith('//') ? `https:${host}` : host
  return `${base}${path}/${TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/1_1.png`
}

function findFirstLabelLayer(map: MapboxMap): string | undefined {
  const style = map.getStyle()
  if (!style?.layers) return undefined
  const label = style.layers.find(
    (l) =>
      l.type === 'symbol' &&
      typeof (l as { 'source-layer'?: string })['source-layer'] === 'string',
  )
  return label?.id
}

function fadeDurationForIntent(intent: FieldState['intent']): number {
  switch (intent) {
    case 'STREET_AWARE':
    case 'SYSTEM_FAILURE_PROCEDURAL':
    case 'STORM_INTENSIVE':
      return 520
    case 'NAVIGATION_ACTIVE':
      return 360
    default:
      return 280
  }
}

/** Visual-only atmospheric transform — dissolves radar grid into motion field. */
function atmosphericFieldPaint(state: FieldState): {
  opacity: number
  brightnessMin: number
  brightnessMax: number
  contrast: number
  saturation: number
} {
  const floor = 0.08
  const opacity = Math.min(0.22, Math.max(floor, state.effectiveOpacity * 0.32 + 0.06))
  return {
    opacity,
    brightnessMin: Math.max(state.brightnessMin, 0.28),
    brightnessMax: Math.min(state.brightnessMax, 0.82),
    contrast: Math.min(state.contrast, -0.38),
    saturation: Math.min(state.saturation - 0.45, -0.68),
  }
}

function applyFieldPaint(map: MapboxMap, state: FieldState): void {
  if (!map.getLayer(RADAR_LAYER_ID)) return
  const paint = atmosphericFieldPaint(state)
  try {
    map.setPaintProperty(RADAR_LAYER_ID, 'raster-opacity', paint.opacity)
    map.setPaintProperty(RADAR_LAYER_ID, 'raster-brightness-min', paint.brightnessMin)
    map.setPaintProperty(RADAR_LAYER_ID, 'raster-brightness-max', paint.brightnessMax)
    map.setPaintProperty(RADAR_LAYER_ID, 'raster-contrast', paint.contrast)
    map.setPaintProperty(RADAR_LAYER_ID, 'raster-saturation', paint.saturation)
    map.setPaintProperty(RADAR_LAYER_ID, 'raster-fade-duration', fadeDurationForIntent(state.intent))
  } catch {
    // style not ready
  }
}

function ensureRadarSource(map: MapboxMap, tileUrl: string, state: FieldState): void {
  if (!map.getSource(RADAR_SOURCE_ID)) {
    map.addSource(RADAR_SOURCE_ID, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: TILE_SIZE,
      attribution: '© RainViewer',
    })
  }
  if (!map.getLayer(RADAR_LAYER_ID)) {
    map.addLayer(
      {
        id: RADAR_LAYER_ID,
        type: 'raster',
        source: RADAR_SOURCE_ID,
        paint: (() => {
          const paint = atmosphericFieldPaint(state)
          return {
            'raster-opacity': paint.opacity,
            'raster-opacity-transition': { duration: 1200, delay: 0 },
            'raster-fade-duration': fadeDurationForIntent(state.intent),
            'raster-brightness-min': paint.brightnessMin,
            'raster-brightness-max': paint.brightnessMax,
            'raster-contrast': paint.contrast,
            'raster-saturation': paint.saturation,
          }
        })(),
      },
      findFirstLabelLayer(map),
    )
  } else {
    applyFieldPaint(map, state)
  }
}

function removeRadarLayers(map: MapboxMap): void {
  try {
    if (map.getLayer(RADAR_LAYER_ID)) map.removeLayer(RADAR_LAYER_ID)
    if (map.getSource(RADAR_SOURCE_ID)) map.removeSource(RADAR_SOURCE_ID)
  } catch {
    // style reset
  }
}

function updateRadarTiles(map: MapboxMap, tileUrl: string): void {
  const source = map.getSource(RADAR_SOURCE_ID)
  if (!source) return
  if ('setTiles' in source && typeof (source as unknown as { setTiles: unknown }).setTiles === 'function') {
    ;(source as unknown as { setTiles: (tiles: string[]) => void }).setTiles([tileUrl])
  }
}

function useRadarFrames(active: boolean) {
  const [frames, setFrames] = useState<RadarFrame[]>([])
  const [host, setHost] = useState('https://tilecache.rainviewer.com')
  const [fetchError, setFetchError] = useState<string | null>(null)

  const fetchFrames = useCallback(async () => {
    if (!active) return
    try {
      const res = await fetch(RADAR_API_URL, { cache: 'no-store' })
      if (!res.ok) throw new Error(`RainViewer ${res.status}`)
      const raw: unknown = await res.json()
      if (
        raw == null ||
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        !('radar' in raw)
      ) {
        throw new Error('RainViewer: unexpected API response')
      }
      const data = raw as RainViewerApiResponse
      const past = (data.radar.past ?? []).slice(-MAX_PAST_FRAMES)
      if (past.length === 0) throw new Error('RainViewer: no radar frames')
      const hostRaw = data.host ?? 'https://tilecache.rainviewer.com'
      setHost(hostRaw.startsWith('//') ? `https:${hostRaw}` : hostRaw)
      setFrames(past)
      setFetchError(null)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Field data unavailable')
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    void fetchFrames()
    const timer = window.setInterval(() => void fetchFrames(), API_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [active, fetchFrames])

  return { frames, host, fetchError }
}

/**
 * Radar fetch errors must not flip fieldIntent on the first failed request.
 * Requires empty frames AND sustained error (or cached frames suppress failure entirely).
 */
function useRadarSystemFailure(
  fetchError: string | null,
  frameCount: number,
  fieldActive: boolean,
): boolean {
  const [systemFailure, setSystemFailure] = useState(false)
  const holdTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }

    if (!fieldActive || frameCount > 0 || !fetchError) {
      setSystemFailure(false)
      return
    }

    holdTimerRef.current = window.setTimeout(() => {
      setSystemFailure(true)
      holdTimerRef.current = null
    }, RADAR_SYSTEM_FAILURE_HOLD_MS)

    return () => {
      if (holdTimerRef.current != null) {
        window.clearTimeout(holdTimerRef.current)
        holdTimerRef.current = null
      }
    }
  }, [fetchError, frameCount, fieldActive])

  return systemFailure
}

function useFrameAnimator(frames: RadarFrame[], active: boolean, frameIntervalMs: number) {
  const [frameIdx, setFrameIdx] = useState(0)
  const lastTickRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const visibleRef = useRef(document.visibilityState === 'visible')
  const intervalRef = useRef(frameIntervalMs)

  intervalRef.current = frameIntervalMs

  useEffect(() => {
    const onVis = () => { visibleRef.current = document.visibilityState === 'visible' }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    if (!active || frames.length < 2) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }

    const tick = (ts: number) => {
      rafRef.current = requestAnimationFrame(tick)
      if (!visibleRef.current) return
      if (ts - lastTickRef.current >= intervalRef.current) {
        lastTickRef.current = ts
        setFrameIdx((i) => (i + 1) % frames.length)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [active, frames.length])

  useEffect(() => {
    if (frames.length > 0) setFrameIdx(frames.length - 1)
  }, [frames.length])

  return frameIdx
}

export function WeatherRadarLayer() {
  const { map } = useMapContext()
  const { mode } = useHudPresentation()
  const { session } = useOperationalSession()
  const { state: appState } = useAppContext()
  const atmosphere = useWeatherAtmosphere()
  const isImmersive = mode === 'immersive'

  const fieldIntent = useSyncExternalStore(subscribeFieldIntent, getFieldIntent)
  const fieldState = useMemo(() => computeFieldState(fieldIntent), [fieldIntent])

  const [mapZoom, setMapZoom] = useState(10)

  const fieldActive = isImmersive && map != null

  useEffect(() => {
    if (!map || !isImmersive) return
    const syncZoom = () => setMapZoom(map.getZoom())
    syncZoom()
    map.on('zoom', syncZoom)
    map.on('moveend', syncZoom)
    return () => {
      map.off('zoom', syncZoom)
      map.off('moveend', syncZoom)
    }
  }, [map, isImmersive])

  const { frames, host, fetchError } = useRadarFrames(fieldActive)
  const systemFailure = useRadarSystemFailure(fetchError, frames.length, fieldActive)
  const storm =
    atmosphere.tone === 'storm' ||
    atmosphere.isThunderstorm ||
    atmosphere.level === 'intense'

  useFieldIntentResolver({
    immersive: isImmersive,
    zoom: mapZoom,
    navigating: session.phase === 'navigating',
    storm,
    emergency: appState.deadManActive,
    systemFailure,
  })

  const hasTileData = frames.length > 0 && !fetchError
  const expressTiles =
    hasTileData &&
    fieldState.tileExpression >= FIELD_TILE_EXPRESSION_MIN &&
    fieldIntent !== 'SYSTEM_FAILURE_PROCEDURAL'
  const proceduralOnly = !expressTiles

  const frameIdx = useFrameAnimator(
    frames,
    fieldActive && expressTiles,
    fieldState.frameIntervalMs,
  )

  const prevIntentRef = useRef<string | null>(null)
  useEffect(() => {
    if (!fieldActive) return
    const key = `${fieldIntent}:${fieldState.fieldPresence.toFixed(2)}`
    if (prevIntentRef.current === key) return
    prevIntentRef.current = key
    logModernGuardrailTransition('field-state', {
      intent: fieldIntent,
      presence: fieldState.fieldPresence.toFixed(2),
      tileExpression: fieldState.tileExpression.toFixed(2),
      noiseExpression: fieldState.noiseExpression.toFixed(2),
      proceduralOnly,
    })
  }, [fieldActive, fieldIntent, fieldState, proceduralOnly])

  useEffect(() => {
    if (!map || !isImmersive) return

    if (!expressTiles) {
      if (map.getLayer(RADAR_LAYER_ID)) {
        removeRadarLayers(map)
      }
      return
    }

    const apply = () => {
      const frame = frames[frames.length - 1]
      if (!frame) return
      const tileUrl = buildTileUrl(host, frame.path)
      ensureRadarSource(map, tileUrl, fieldState)
      applyFieldPaint(map, fieldState)
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('style.load', apply)
      return () => { map.off('style.load', apply) }
    }
  }, [map, isImmersive, expressTiles, frames, host, fieldState])

  useEffect(() => {
    if (!map || !isImmersive || !expressTiles) return

    const onStyleData = () => {
      if (!map.getLayer(RADAR_LAYER_ID)) {
        const frame = frames[frameIdx] ?? frames[frames.length - 1]
        if (!frame) return
        const tileUrl = buildTileUrl(host, frame.path)
        ensureRadarSource(map, tileUrl, fieldState)
      }
    }

    map.on('styledata', onStyleData)
    return () => { map.off('styledata', onStyleData) }
  }, [map, isImmersive, expressTiles, frames, host, frameIdx, fieldState])

  useEffect(() => {
    if (!map || !isImmersive || !expressTiles) return
    const frame = frames[frameIdx]
    if (!frame) return
    const tileUrl = buildTileUrl(host, frame.path)
    if (map.getSource(RADAR_SOURCE_ID)) {
      updateRadarTiles(map, tileUrl)
    }
  }, [map, isImmersive, expressTiles, frames, host, frameIdx])

  useEffect(() => {
    if (!map || !isImmersive || !map.getLayer(RADAR_LAYER_ID)) return
    applyFieldPaint(map, fieldState)
  }, [map, isImmersive, fieldState])

  useEffect(() => {
    return () => {
      if (map) removeRadarLayers(map)
    }
  }, [map])

  return null
}

export default WeatherRadarLayer
