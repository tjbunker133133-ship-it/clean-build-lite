import { useEffect } from 'react'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'
import * as maplibregl from 'maplibre-gl'
import { tier1Debug } from '../lib/tier1DebugLog'

const ROUTE_SOURCE_ID = 'tactical-route-source'
const ROUTE_LAYER_ID = 'tactical-route-layer'

export default function RouteLayer() {
  const { map } = useMapContext()
  const { state } = useAppContext()

  useEffect(() => {
    if (!map) return
    let rafId: number | null = null

    const buildGeojson = (): GeoJSON.FeatureCollection => {
      // GeoJSON LineString requires [lng, lat] (matches marker setLngLat / map APIs).
      const coordinates = state.waypoints.map((w) => [w.lng, w.lat] as [number, number])
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
            'line-width': 3,
            'line-opacity': 1,
          },
        })
      }
    }

    const runUpdate = () => {
      tier1Debug('route', 'recalc', { pointCount: state.waypoints.length })
      const legacyCorridorId = 'tactical-route-corridor-layer'
      if (map.getLayer(legacyCorridorId)) {
        try {
          map.removeLayer(legacyCorridorId)
        } catch {
          /* ignore */
        }
      }
      const geojson = buildGeojson()
      const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
      if (source) {
        source.setData(geojson)
        // setStyle() can remove layers while leaving the GeoJSON source; re-add line layers if missing.
        if (!map.getLayer(ROUTE_LAYER_ID)) {
          ensureRouteLayers(geojson)
        }
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
