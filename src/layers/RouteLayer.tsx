import { useEffect } from 'react'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'

const ROUTE_SOURCE_ID = 'tactical-route-source'
const ROUTE_LAYER_ID = 'tactical-route-layer'

export default function RouteLayer() {
  const { mapRef } = useMapContext()
  const { state } = useAppContext()

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const updateRoute = () => {
      const coordinates = state.waypoints.map((w) => [w.lng, w.lat])

      const geojson: GeoJSON.FeatureCollection = {
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

      const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined

      if (source) {
        source.setData(geojson)
      } else {
        // Wait for style to be loaded
        const addLayers = () => {
          if (map.getSource(ROUTE_SOURCE_ID)) return

          map.addSource(ROUTE_SOURCE_ID, {
            type: 'geojson',
            data: geojson,
          })

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

        if (map.isStyleLoaded()) {
          addLayers()
        } else {
          map.once('styledata', addLayers)
        }
      }
    }

    // Re-add after style change
    const onStyleData = () => {
      // Source was removed with style change, re-add
      if (!map.getSource(ROUTE_SOURCE_ID)) {
        const coordinates = state.waypoints.map((w) => [w.lng, w.lat])
        const geojson: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features:
            coordinates.length >= 2
              ? [
                  {
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'LineString', coordinates },
                  },
                ]
              : [],
        }
        map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: geojson })
        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#00ffb4',
            'line-width': 1.5,
            'line-opacity': 0.6,
            'line-dasharray': [4, 4],
          },
        })
      }
    }

    map.on('styledata', onStyleData)
    updateRoute()

    return () => {
      map.off('styledata', onStyleData)
    }
  }, [state.waypoints]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
