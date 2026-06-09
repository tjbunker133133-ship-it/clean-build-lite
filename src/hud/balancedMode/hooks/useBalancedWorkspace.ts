/**
 * Balanced Workspace Hook - UI chrome only (panels, overlays).
 * Tool mode is OSG-owned — read via getBalancedToolFromOsg, write via setBalancedActiveTool.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useState,
  useRef,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { setBalancedActiveTool } from '../../../lib/balancedToolBridge'
import {
  getBalancedToolFromOsg,
  subscribeMapInteraction,
} from '../../../lib/mapInteractionController'

type ToolMode = 'inspect' | 'route' | 'waypoint' | 'measure' | 'none'

interface BalancedPanelState {
  id: string
  visible: boolean
  collapsed: boolean
  position: 'left' | 'right' | 'bottom'
  priority: number
}

interface BalancedWorkspaceState {
  panels: Record<string, BalancedPanelState>
  activeOverlayId: string | null
  overlaySection: 'base' | 'weather' | null
  bottomSheetOpen: boolean
}

const STORAGE_KEY = 'hud_balanced_workspace_v1'

const DEFAULT_PANELS: Record<string, BalancedPanelState> = {
  route: { id: 'route', visible: true, collapsed: false, position: 'left', priority: 1 },
  waypoints: { id: 'waypoints', visible: true, collapsed: false, position: 'left', priority: 2 },
  overlays: { id: 'overlays', visible: false, collapsed: true, position: 'right', priority: 1 },
  mission: { id: 'mission', visible: false, collapsed: true, position: 'bottom', priority: 1 },
}

const PANEL_ID_ALIASES: Record<string, string> = {
  layers: 'overlays',
}

function resolvePanelId(panelId: string): string {
  return PANEL_ID_ALIASES[panelId] ?? panelId
}

function loadPersistedState(): Partial<BalancedWorkspaceState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<BalancedWorkspaceState> & { activeTool?: string; mapToolActive?: boolean }
    // Strip legacy tool fields — OSG owns tool mode
    const { activeTool: _t, mapToolActive: _m, ...uiOnly } = parsed as Record<string, unknown>
    return uiOnly as Partial<BalancedWorkspaceState>
  } catch {
    return null
  }
}

function savePersistedState(state: BalancedWorkspaceState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore storage errors
  }
}

type BalancedWorkspaceValue = ReturnType<typeof useBalancedWorkspaceInternal>

const BalancedWorkspaceContext = createContext<BalancedWorkspaceValue | null>(null)

function useBalancedWorkspaceInternal() {
  const persisted = useRef(loadPersistedState())

  const activeTool = useSyncExternalStore(
    subscribeMapInteraction,
    getBalancedToolFromOsg,
    getBalancedToolFromOsg,
  )

  const [panels, setPanels] = useState<Record<string, BalancedPanelState>>(
    { ...DEFAULT_PANELS, ...persisted.current?.panels },
  )
  const [activeOverlayId, setActiveOverlayId] = useState<string | null>(
    persisted.current?.activeOverlayId ?? null,
  )
  const [overlaySection, setOverlaySection] = useState<'base' | 'weather' | null>(
    persisted.current?.overlaySection ?? null,
  )
  const [bottomSheetOpen, setBottomSheetOpen] = useState(
    persisted.current?.bottomSheetOpen ?? false,
  )

  const mapToolActive = activeTool !== 'inspect' && activeTool !== 'none'

  useEffect(() => {
    savePersistedState({
      panels,
      activeOverlayId,
      overlaySection,
      bottomSheetOpen,
    })
  }, [panels, activeOverlayId, overlaySection, bottomSheetOpen])

  const togglePanel = useCallback((panelId: string) => {
    const resolved = resolvePanelId(panelId)
    setPanels((prev) => {
      const panel = prev[resolved]
      if (!panel) return prev

      const next: Record<string, BalancedPanelState> = {}
      for (const [id, p] of Object.entries(prev)) {
        if (id === resolved) {
          next[id] = { ...p, visible: !p.visible, collapsed: !p.visible ? false : p.collapsed }
        } else if (p.position === panel.position && p.visible && !panel.visible) {
          next[id] = { ...p, visible: false, collapsed: true }
        } else {
          next[id] = p
        }
      }
      return next
    })
  }, [])

  const openPanel = useCallback((panelId: string) => {
    const resolved = resolvePanelId(panelId)
    setPanels((prev) => {
      const panel = prev[resolved]
      if (!panel) return prev
      return {
        ...prev,
        [resolved]: { ...panel, visible: true, collapsed: false },
      }
    })
  }, [])

  const collapsePanel = useCallback((panelId: string) => {
    const resolved = resolvePanelId(panelId)
    setPanels((prev) => ({
      ...prev,
      [resolved]: { ...prev[resolved], collapsed: true },
    }))
  }, [])

  const expandPanel = useCallback((panelId: string) => {
    const resolved = resolvePanelId(panelId)
    setPanels((prev) => ({
      ...prev,
      [resolved]: { ...prev[resolved], collapsed: false },
    }))
  }, [])

  const setTool = useCallback((tool: ToolMode) => {
    setBalancedActiveTool(tool)
  }, [])

  const clearTool = useCallback(() => {
    setBalancedActiveTool('inspect')
  }, [])

  const openOverlay = useCallback((overlayId: string) => {
    setActiveOverlayId(overlayId)
  }, [])

  const openOverlaySection = useCallback((section: 'base' | 'weather') => {
    setOverlaySection(section)
    openPanel('overlays')
  }, [openPanel])

  const closeOverlay = useCallback(() => {
    setActiveOverlayId(null)
    setOverlaySection(null)
  }, [])

  const openBottomSheet = useCallback(() => {
    setBottomSheetOpen(true)
  }, [])

  const closeBottomSheet = useCallback(() => {
    setBottomSheetOpen(false)
  }, [])

  const isPanelVisible = useCallback(
    (panelId: string) => {
      const resolved = resolvePanelId(panelId)
      return panels[resolved]?.visible ?? false
    },
    [panels],
  )

  const isPanelCollapsed = useCallback(
    (panelId: string) => {
      const resolved = resolvePanelId(panelId)
      return panels[resolved]?.collapsed ?? true
    },
    [panels],
  )

  return {
    activeTool,
    panels,
    activeOverlayId,
    overlaySection,
    mapToolActive,
    bottomSheetOpen,
    togglePanel,
    openPanel,
    collapsePanel,
    expandPanel,
    setTool,
    clearTool,
    openOverlay,
    openOverlaySection,
    closeOverlay,
    openBottomSheet,
    closeBottomSheet,
    isPanelVisible,
    isPanelCollapsed,
  }
}

export function BalancedWorkspaceProvider({ children }: { children: ReactNode }) {
  const value = useBalancedWorkspaceInternal()
  return createElement(BalancedWorkspaceContext.Provider, { value }, children)
}

export function useBalancedWorkspace(): BalancedWorkspaceValue {
  const ctx = useContext(BalancedWorkspaceContext)
  if (!ctx) {
    throw new Error('useBalancedWorkspace must be used within BalancedWorkspaceProvider')
  }
  return ctx
}

export type { ToolMode, BalancedPanelState, BalancedWorkspaceState }
