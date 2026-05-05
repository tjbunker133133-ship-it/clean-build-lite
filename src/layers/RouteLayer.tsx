import { useEffect } from 'react'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'
import * as maplibregl from 'maplibre-gl'

const ROUTE_SOURCE_ID = 'tactical-route-source'
const CORRIDOR_LAYER_ID = 'tactical-route-corridor-layer'
const ROUTE_LAYER_ID = 'tactical-route-layer'

export default function RouteLayer() {
  const { map } = useMapContext()
  const { state } = useAppContext()

  useEffect(() => {
    if (!map) return
    let rafId: number | null = null

    const buildGeojson = (): GeoJSON.FeatureCollection => {
      const coordinates = state.waypoints.map((w) => [w.lng, w.lat])
      return {
        type: 'FeatureCollection',
        features:
          coordinates.length >= 2
            ? [
                {
                  type: 'Feature',
                  properties: {},
                  geometry: {
                    type: 'LineString',
                    coordinates,
                  },
                },
              ]
            : [],
      }
    }

    const ensureRouteLayers = (geojson: GeoJSON.FeatureCollection) => {
      if (!map.getSource(ROUTE_SOURCE_ID)) {
        map.addSource(ROUTE_SOURCE_ID, {
          type: 'geojson',
          data: geojson,
        })
      }
      if (!map.getLayer(CORRIDOR_LAYER_ID)) {
        map.addLayer({
          id: CORRIDOR_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#00ffb4',
            'line-width': 22,
            'line-opacity': 0.14,
            'line-blur': 0.9,
          },
        })
      }
      if (!map.getLayer(ROUTE_LAYER_ID)) {
        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#00ffb4',
            'line-width': 1.5,
            'line-opacity': 0.6,
            'line-dasharray': [4, 4],
          },
        })
      }
    }

    const runUpdate = () => {
      const geojson = buildGeojson()
      const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
      if (source) {
        source.setData(geojson)
        return
      }
      const ensure = () => {
        if (!map.isStyleLoaded()) return
        ensureRouteLayers(geojson)
      }
      if (map.isStyleLoaded()) ensure()
      else map.once('styledata', ensure)
    }

    const scheduleUpdate = () => {
      if (rafId != null) window.cancelAnimationFrame(rafId)
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        runUpdate()
      })
    }

    const onStyleData = () => {
      scheduleUpdate()
    }

    map.on('styledata', onStyleData)
    scheduleUpdate()

    return () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId)
        rafId = null
      }
      map.off('styledata', onStyleData)
    }
  }, [state.waypoints, map])

  return null
}
