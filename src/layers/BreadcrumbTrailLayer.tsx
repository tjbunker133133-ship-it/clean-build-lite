import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import {
  getBreadcrumbSessionSnapshot,
  subscribeBreadcrumbSession,
  type BreadcrumbSessionSnapshot,
} from '../lib/movement/breadcrumbSessionStore'

const BREADCRUMB_SOURCE_ID = 'hud-breadcrumb-session-source'
const BREADCRUMB_LAYER_ID = 'hud-breadcrumb-session-layer'

function toGeoJson(s: BreadcrumbSessionSnapshot): GeoJSON.FeatureCollection {
  const coords = s.points.map((p) => [p.lng, p.lat] as [number, number])
  return {
    type: 'FeatureCollection',
    features:
      coords.length >= 2
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: coords },
            },
          ]
        : [],
  }
}

export default function BreadcrumbTrailLayer() {
  const { map } = useMapContext()
  const snapRef = useRef<BreadcrumbSessionSnapshot | null>(null)

  useEffect(() => {
    if (!map) return
    let raf: number | null = null

    const apply = (s: BreadcrumbSessionSnapshot) => {
      snapRef.current = s
      if (raf != null) window.cancelAnimationFrame(raf)
      raf = window.requestAnimationFrame(() => {
        raf = null
        const geojson = toGeoJson(snapRef.current ?? getBreadcrumbSessionSnapshot())
        let source = map.getSource(BREADCRUMB_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
        if (!source) {
          map.addSource(BREADCRUMB_SOURCE_ID, { type: 'geojson', data: geojson })
          source = map.getSource(BREADCRUMB_SOURCE_ID) as maplibregl.GeoJSONSource
        } else {
          source.setData(geojson as GeoJSON.GeoJSON)
        }
        if (!map.getLayer(BREADCRUMB_LAYER_ID)) {
          map.addLayer({
            id: BREADCRUMB_LAYER_ID,
            type: 'line',
            source: BREADCRUMB_SOURCE_ID,
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': '#9aaab8',
              'line-width': 2,
              'line-opacity': 0.36,
              'line-dasharray': [1.2, 3],
            },
          })
        }
      })
    }

    apply(getBreadcrumbSessionSnapshot())
    const unsub = subscribeBreadcrumbSession(apply)

    const onStyleData = () => apply(getBreadcrumbSessionSnapshot())
    map.on('styledata', onStyleData)

    return () => {
      unsub()
      map.off('styledata', onStyleData)
      if (raf != null) window.cancelAnimationFrame(raf)
      try {
        if (map.getLayer(BREADCRUMB_LAYER_ID)) map.removeLayer(BREADCRUMB_LAYER_ID)
      } catch {
        /* ignore */
      }
      try {
        if (map.getSource(BREADCRUMB_SOURCE_ID)) map.removeSource(BREADCRUMB_SOURCE_ID)
      } catch {
        /* ignore */
      }
    }
  }, [map])

  return null
}
