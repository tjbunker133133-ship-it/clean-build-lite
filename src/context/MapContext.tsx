import React, {
  createContext,
  useContext,
  useRef,
  type ReactNode,
  type MutableRefObject
} from 'react'
import type maplibregl from 'maplibre-gl'

interface MapContextValue {
  mapRef: MutableRefObject<maplibregl.Map | null>
}

const MapContext = createContext<MapContextValue | null>(null)

export function MapProvider({ children }: { children: ReactNode }) {
  const mapRef = useRef<maplibregl.Map | null>(null)

  return (
    <MapContext.Provider value={{ mapRef }}>
      {children}
    </MapContext.Provider>
  )
}

export function useMapContext(): MapContextValue {
  const ctx = useContext(MapContext)
  if (!ctx) throw new Error('useMapContext must be used within MapProvider')
  return ctx
}
