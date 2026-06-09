import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAppContext } from './AppContext'
import { useHudPresentation } from './HudPresentationContext'
import { useOverlayContext } from './OverlayContext'
import {
  DEFAULT_OPERATIONAL_SESSION,
  type OperationalSession,
  type OperationalSessionPhase,
} from '../lib/operationalSession/types'
import { loadOperationalSession, saveOperationalSession } from '../lib/operationalSession/persist'
import { setRouteName as osgSetRouteName } from '../lib/mapInteractionController'
import type { LayerType } from '../types'

type OperationalSessionContextValue = {
  session: OperationalSession
  setRouteName: (name: string) => void
  setPhase: (phase: OperationalSessionPhase) => void
  setShowLabels: (enabled: boolean) => void
  setShowDistances: (enabled: boolean) => void
  setCorridorEnabled: (enabled: boolean) => void
  setCorridorWidthM: (width: number) => void
  setModernPreferredBasemap: (layer: LayerType) => void
}

const OperationalSessionContext = createContext<OperationalSessionContextValue | null>(null)

export function OperationalSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<OperationalSession>(() => loadOperationalSession())
  const { state, setLayer, setShowMapLabels, setShowMapDistances } = useAppContext()
  const { mode } = useHudPresentation()
  const { setEnabled, toggles } = useOverlayContext()

  useEffect(() => {
    saveOperationalSession(session)
  }, [session])

  // Bridge unified label flags into AppContext (authoritative map rendering)
  useEffect(() => {
    if (state.showMapLabels !== session.showLabels) {
      setShowMapLabels(session.showLabels)
    }
    if (state.showMapDistances !== session.showDistances) {
      setShowMapDistances(session.showDistances)
    }
  }, [
    session.showLabels,
    session.showDistances,
    state.showMapLabels,
    state.showMapDistances,
    setShowMapLabels,
    setShowMapDistances,
  ])

  // Modern first-run: prefer satellite/hybrid for immersive presence
  useEffect(() => {
    if (mode !== 'immersive') return
    if (session.modernBasemapInitialized) return
    setLayer(session.modernPreferredBasemap)
    setSession((prev) => ({ ...prev, modernBasemapInitialized: true }))
  }, [mode, session.modernBasemapInitialized, session.modernPreferredBasemap, setLayer])

  // Modern first-run: subtle terrain depth overlay for field readability
  useEffect(() => {
    if (mode !== 'immersive') return
    if (session.modernImmerseBootstrapped) return
    if (!toggles.relief_usgs) {
      setEnabled('relief_usgs', true)
    }
    setSession((prev) => ({ ...prev, modernImmerseBootstrapped: true }))
  }, [mode, session.modernImmerseBootstrapped, setEnabled, toggles.relief_usgs])

  const patch = useCallback((patch: Partial<OperationalSession>) => {
    setSession((prev) => ({ ...prev, ...patch }))
  }, [])

  const setRouteName = useCallback((routeName: string) => {
    osgSetRouteName(routeName)
    patch({ routeName })
  }, [patch])
  const setPhase = useCallback((phase: OperationalSessionPhase) => patch({ phase }), [patch])
  const setShowLabels = useCallback((showLabels: boolean) => patch({ showLabels }), [patch])
  const setShowDistances = useCallback((showDistances: boolean) => patch({ showDistances }), [patch])
  const setCorridorEnabled = useCallback((corridorEnabled: boolean) => patch({ corridorEnabled }), [patch])
  const setCorridorWidthM = useCallback((corridorWidthM: number) => patch({ corridorWidthM }), [patch])
  const setModernPreferredBasemap = useCallback(
    (modernPreferredBasemap: LayerType) => patch({ modernPreferredBasemap }),
    [patch],
  )
  const value = useMemo(
    () => ({
      session,
      setRouteName,
      setPhase,
      setShowLabels,
      setShowDistances,
      setCorridorEnabled,
      setCorridorWidthM,
      setModernPreferredBasemap,
    }),
    [
      session,
      setRouteName,
      setPhase,
      setShowLabels,
      setShowDistances,
      setCorridorEnabled,
      setCorridorWidthM,
      setModernPreferredBasemap,
    ],
  )

  return (
    <OperationalSessionContext.Provider value={value}>
      {children}
    </OperationalSessionContext.Provider>
  )
}

export function useOperationalSession(): OperationalSessionContextValue {
  const ctx = useContext(OperationalSessionContext)
  if (!ctx) {
    return {
      session: DEFAULT_OPERATIONAL_SESSION,
      setRouteName: () => {},
      setPhase: () => {},
      setShowLabels: () => {},
      setShowDistances: () => {},
      setCorridorEnabled: () => {},
      setCorridorWidthM: () => {},
      setModernPreferredBasemap: () => {},
    }
  }
  return ctx
}
