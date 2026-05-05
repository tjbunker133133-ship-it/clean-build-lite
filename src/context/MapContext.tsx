import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Map } from 'maplibre-gl'

interface MapContextValue {
  /** Live MapLibre instance once tiles/style are ready — triggers re-renders when set */
  map: Map | null
  setMap: (map: Map | null) => void
}

const MapContext = createContext<MapContextValue | null>(null)

export function MapProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Map | null>(null)
  const value = useMemo(() => ({ map, setMap }), [map])

  return <MapContext.Provider value={value}>{children}</MapContext.Provider>
}

export function useMapContext(): MapContextValue {
  const ctx = useContext(MapContext)
  if (!ctx) throw new Error('useMapContext must be used within MapProvider')
  return ctx
}
