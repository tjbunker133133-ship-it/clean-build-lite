/**
 * Balanced weather radar — simple RainViewer tiles (not Modern field engine).
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import maplibregl from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import { useHudPresentation } from '../context/HudPresentationContext'
import {
  getRadarEnabled,
  getRadarOpacity,
  subscribeRadar,
} from '../lib/modernRadarStore'

interface RadarFrame {
  time: number
  path: string
}

interface RainViewerApiResponse {
  host: string
  radar: {
    past: RadarFrame[]
  }
}

const RADAR_API_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const SOURCE_ID = 'hud-balanced-weather-radar-source'
const LAYER_ID = 'hud-balanced-weather-radar-layer'
const TILE_SIZE = 256
const COLOR_SCHEME = 4
const MAX_PAST_FRAMES = 6
const API_REFRESH_MS = 5 * 60 * 1000

function buildTileUrl(host: string, path: string): string {
  const base = host.startsWith('//') ? `https:${host}` : host
  return `${base}${path}/${TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/1_1.png`
}

function findFirstLabelLayer(map: maplibregl.Map): string | undefined {
  const style = map.getStyle()
  if (!style?.layers) return undefined
  const label = style.layers.find(
    (l) =>
      l.type === 'symbol' &&
      typeof (l as { 'source-layer'?: string })['source-layer'] === 'string',
  )
  return label?.id
}

function removeRadar(map: maplibregl.Map) {
  try {
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
  } catch {
    /* style reset */
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
      const data = (await res.json()) as RainViewerApiResponse
      const past = (data.radar.past ?? []).slice(-MAX_PAST_FRAMES)
      if (past.length === 0) throw new Error('RainViewer: no radar frames')
      const hostRaw = data.host ?? 'https://tilecache.rainviewer.com'
      setHost(hostRaw.startsWith('//') ? `https:${hostRaw}` : hostRaw)
      setFrames(past)
      setFetchError(null)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Radar unavailable')
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

export function BalancedWeatherRadarLayer() {
  const { map } = useMapContext()
  const { mode } = useHudPresentation()
  const radarEnabled = useSyncExternalStore(subscribeRadar, getRadarEnabled, getRadarEnabled)
  const radarOpacity = useSyncExternalStore(subscribeRadar, getRadarOpacity, getRadarOpacity)
  const isBalanced = mode === 'hybrid'
  const active = isBalanced && radarEnabled && map != null

  const { frames, host, fetchError } = useRadarFrames(active)

  useEffect(() => {
    if (!map || !active) {
      if (map) removeRadar(map)
      return
    }

    const frame = frames[frames.length - 1]
    if (!frame) return

    const apply = () => {
      if (!map.isStyleLoaded()) return
      const tileUrl = buildTileUrl(host, frame.path)
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'raster',
          tiles: [tileUrl],
          tileSize: TILE_SIZE,
          attribution: '© RainViewer',
        })
      } else {
        const source = map.getSource(SOURCE_ID)
        if (source && 'setTiles' in source) {
          ;(source as maplibregl.RasterTileSource & { setTiles: (t: string[]) => void }).setTiles([tileUrl])
        }
      }
      if (!map.getLayer(LAYER_ID)) {
        map.addLayer(
          {
            id: LAYER_ID,
            type: 'raster',
            source: SOURCE_ID,
            paint: {
              'raster-opacity': radarOpacity,
              'raster-opacity-transition': { duration: 400, delay: 0 },
            },
          },
          findFirstLabelLayer(map),
        )
      } else {
        map.setPaintProperty(LAYER_ID, 'raster-opacity', radarOpacity)
      }
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('load', apply)
      return () => { map.off('load', apply) }
    }
  }, [map, active, frames, host, radarOpacity])

  useEffect(() => {
    if (!map || !map.getLayer(LAYER_ID)) return
    map.setPaintProperty(LAYER_ID, 'raster-opacity', radarOpacity)
  }, [map, radarOpacity])

  useEffect(() => {
    return () => {
      if (map) removeRadar(map)
    }
  }, [map])

  useEffect(() => {
    if (!import.meta.env.DEV || !active) return
    if (fetchError) {
      console.warn('[BALANCED_RADAR]', fetchError)
    }
  }, [active, fetchError])

  return null
}

export default BalancedWeatherRadarLayer
