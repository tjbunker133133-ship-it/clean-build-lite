import { useEffect } from 'react'

import { useMapContext } from '../context/MapContext'

import { useAppContext } from '../context/AppContext'

import { useTrailRoute } from '../context/TrailRouteContext'

import * as maplibregl from 'maplibre-gl'

import { tier1Debug } from '../lib/tier1DebugLog'



const ROUTE_SOURCE_ID = 'tactical-route-source'

const ROUTE_LAYER_ID = 'tactical-route-layer'

const TRAIL_ROUTE_SOURCE_ID = 'tactical-trail-route-source'

const TRAIL_ROUTE_LAYER_ID = 'tactical-trail-route-layer'



export default function RouteLayer() {

  const { map } = useMapContext()

  const { state } = useAppContext()

  const { waypoints, snapToTrailEnabled } = state

  const trailRoute = useTrailRoute()



  useEffect(() => {

    if (!map) return

    let rafId: number | null = null



    const visibleWaypoints = waypoints.filter((w) => w.status !== 'archived')



    const buildGeojson = (): GeoJSON.FeatureCollection => {

      const coordinates = visibleWaypoints.map((w) => [w.lng, w.lat] as [number, number])

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



    const buildTrailGeojson = (): GeoJSON.FeatureCollection => {

      const showTrail =

        snapToTrailEnabled && trailRoute.coordinates.length >= 2

      return {

        type: 'FeatureCollection',

        features: showTrail

          ? [

              {

                type: 'Feature',

                properties: {},

                geometry: {

                  type: 'LineString',

                  coordinates: trailRoute.coordinates,

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



    const ensureTrailLayers = (geojson: GeoJSON.FeatureCollection) => {

      if (!map.getSource(TRAIL_ROUTE_SOURCE_ID)) {

        map.addSource(TRAIL_ROUTE_SOURCE_ID, {

          type: 'geojson',

          data: geojson,

        })

      } else {

        ;(map.getSource(TRAIL_ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource).setData(geojson)

      }

      if (!map.getLayer(TRAIL_ROUTE_LAYER_ID)) {

        map.addLayer({

          id: TRAIL_ROUTE_LAYER_ID,

          type: 'line',

          source: TRAIL_ROUTE_SOURCE_ID,

          layout: {

            'line-join': 'round',

            'line-cap': 'round',

          },

          paint: {

            'line-color': '#5eead4',

            'line-width': 2,

            'line-opacity': 0.85,

            'line-dasharray': [2, 2],

          },

        })

      }

    }



    const runUpdate = () => {

      tier1Debug('route', 'recalc', { pointCount: visibleWaypoints.length })

      const legacyCorridorId = 'tactical-route-corridor-layer'

      if (map.getLayer(legacyCorridorId)) {

        try {

          map.removeLayer(legacyCorridorId)

        } catch {

          /* ignore */

        }

      }

      const geojson = buildGeojson()

      const trailGeojson = buildTrailGeojson()

      const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined

      if (source) {

        source.setData(geojson)

        if (!map.getLayer(ROUTE_LAYER_ID)) {

          ensureRouteLayers(geojson)

        }

      } else {

        const ensure = () => {

          if (!map.isStyleLoaded()) return

          ensureRouteLayers(geojson)

        }

        if (map.isStyleLoaded()) ensure()

        else map.once('styledata', ensure)

      }



      if (trailGeojson.features.length > 0) {

        ensureTrailLayers(trailGeojson)

      } else if (map.getLayer(TRAIL_ROUTE_LAYER_ID)) {

        ;(map.getSource(TRAIL_ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource)?.setData({

          type: 'FeatureCollection',

          features: [],

        })

      }

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

  }, [waypoints, map, snapToTrailEnabled, trailRoute.coordinates])



  return null

}

