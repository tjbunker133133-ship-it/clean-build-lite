import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCockpit } from '../context/CockpitContext'
import { cockpitViewport } from '../lib/viewport'
import { DURATION_MS, EASE } from '../types/cockpit'
import { DesktopInteractionController } from '../controllers/DesktopInteractionController'
import { MobileInteractionController } from '../controllers/MobileInteractionController'
import type { DockRequestSource } from '../controllers/InteractionController'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { updateActiveController } from '../runtime/runtimeSnapshot'
import { assertPolicy, reportPolicyAttempt } from '../runtime/devicePolicy'

// ⚠️ LOCKED SYSTEM — Behavior Freeze Active
// Any change to interaction, layout, display modes, or layers requires explicit approval.

export type CockpitHudPanelProps = {
  panelId: string
  title: string
  initialPos: { x: number; y: number }
  initialWidth: number
  initialHeight?: number | null
  minWidth?: number
  minHeight?: number
  accent?: string
  /** Shown in the dock strip (and undocked title bar when set). Body stays hidden while docked/minimized. */
  dockedHeaderTrailing?: React.ReactNode
  children: React.ReactNode
}

const DRAG_THRESHOLD_PX = 5
const DOCK_EDGE_INSET_PX = 8
const DOCK_VISIBLE_STRIP_PX = 60
const DOCK_PEEK_STRIP_PX = 74
const DOCK_UNDOCK_SWIPE_PX = 18
const EDGE_DOCK_ZONE_PX = 22
const DOCKED_PANEL_STACK_PX = 0
const DOCKED_PANEL_MIN_HEIGHT_PX = 76
const DOCKED_PANEL_MAX_HEIGHT_PX = 92
const DOCKED_PANEL_WIDTH_PX = 280
const DOCK_TOP_OFFSET_PX = 48
const DOCK_BOTTOM_GUTTER_PX = 12
const PANEL_SNAP_THRESHOLD_PX = 10
const DOCK_RELOCK_GUARD_PX = 42
const PANEL_KISS_GAP_PX = 8
const DEFAULT_FLOATING_PANEL_SIZE = { w: 320, h: 420 }
const MOBILE_DRAG_HOLD_MS = 180
const MOBILE_DOUBLE_TAP_MS = 250

function computeDockMetrics(vh: number, count: number) {
  const minY = DOCK_TOP_OFFSET_PX
  const safeCount = Math.max(1, count)
  const available = Math.max(140, vh - minY - DOCK_BOTTOM_GUTTER_PX)
  const stackTotal = Math.max(0, safeCount - 1) * DOCKED_PANEL_STACK_PX
  const perPanel = Math.floor((available - stackTotal) / safeCount)
  const height = Math.max(
    DOCKED_PANEL_MIN_HEIGHT_PX,
    Math.min(DOCKED_PANEL_MAX_HEIGHT_PX, perPanel),
  )
  const step = height + DOCKED_PANEL_STACK_PX
  const maxY = Math.max(minY, vh - height - DOCK_BOTTOM_GUTTER_PX)
  return { minY, maxY, step, height }
}

function dockBadge(panelId: string, title: string): { icon: string; abbr: string } {
  const id = panelId.toLowerCase()
  if (id === 'layers') return { icon: '▦', abbr: 'LYR' }
  if (id === 'waypoints') return { icon: '⌖', abbr: 'WPT' }
  if (id === 'deadman') return { icon: '☠', abbr: 'DMS' }
  if (id === 'coords') return { icon: '◎', abbr: 'GPS' }
  if (id === 'elevation') return { icon: '⛰', abbr: 'ELV' }
  if (id === 'clock') return { icon: '◷', abbr: 'CLK' }
  if (id === 'display') return { icon: '◫', abbr: 'DSP' }
  if (id === 'location') return { icon: '⌖', abbr: 'LOC' }
  if (id === 'voice') return { icon: '🎤', abbr: 'VOC' }
  if (id === 'weather') return { icon: '⛅', abbr: 'WTH' }
  if (id === 'presets') return { icon: '⚙', abbr: 'PST' }
  const compact = title
    .replace(/[^a-z0-9 ]/gi, '')
    .trim()
    .slice(0, 3)
    .toUpperCase()
  return { icon: '◈', abbr: compact || 'TAB' }
}

type DragMode = 'none' | 'pending' | 'move' | 'resize'
type DockIntentSource = 'drag' | 'minimize' | 'toggle'

function mobileDockAllowed(source: DockIntentSource, isMobileDevice: boolean): boolean {
  return !isMobileDevice || source === 'minimize'
}

function viewportSize() {
  return cockpitViewport()
}

export default function CockpitHudPanel({
  panelId,
  title,
  initialPos,
  initialWidth,
  initialHeight = null,
  minWidth = 140,
  minHeight = 120,
  accent: accentProp,
  dockedHeaderTrailing,
  children,
}: CockpitHudPanelProps) {
  if (
    import.meta.env.DEV &&
    globalThis.__COCKPIT_RENDER_IN_PROGRESS__ &&
    typeof window !== 'undefined' &&
    ((window as Window & { __HUD_LOOP_DEBUG__?: number }).__HUD_LOOP_DEBUG__ === 1 ||
      (window as Window & { HUD_LOOP_DEBUG?: number }).HUD_LOOP_DEBUG === 1)
  ) {
    console.warn('[GUARD] CockpitHudPanel rendered before render-phase flag cleared')
  }
  const cock = useCockpit()
  const {
    panels,
    prefs,
    accent: themeAccent,
    raisePanel,
    updatePanel,
    resolveCollisions,
    snapCoord,
    reducedTransparency,
    setMapInteractionBlocked,
  } = cock
  const safeUpdatePanel = useCallback((...args: Parameters<typeof updatePanel>) => {
    return updatePanel(...args)
  }, [updatePanel])

  const accent = accentProp ?? themeAccent
  const layout = panels[panelId]
  const badge = dockBadge(panelId, title)

  const [pos, setPos] = useState({
    x: layout?.x ?? initialPos.x,
    y: layout?.y ?? initialPos.y,
  })
  const [size, setSize] = useState({
    w: layout?.docked ? DOCKED_PANEL_WIDTH_PX : (layout?.w ?? initialWidth),
    h: layout?.h ?? initialHeight,
  })
  const [minimized, setMinimized] = useState(layout?.minimized ?? false)
  // ⚠️ DO NOT CALL DIRECTLY
  // All docking must go through InteractionController + resolveDockIntent
  const [docked, setDocked] = useState(layout?.docked ?? false)
  const [dockSide, setDockSide] = useState<'left' | 'right'>(layout?.dockSide ?? 'left')
  const [dockPreview, setDockPreview] = useState<'left' | 'right' | null>(null)
  const [snapGuide, setSnapGuide] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  })
  const [fullscreen, setFullscreen] = useState(false)
  const [glow, setGlow] = useState(false)
  const [resizeBump, setResizeBump] = useState(false)
  const [dragMode, setDragMode] = useState<DragMode>('none')
  const [isMaximized, setIsMaximized] = useState(false)

  const drag = useRef({ dx: 0, dy: 0 })
  const dockGesture = useRef({ active: false, x: 0, y: 0, moved: false })
  const dragStartScreen = useRef({ x: 0, y: 0 })
  const undockedAt = useRef<{ x: number; y: number } | null>(null)
  const rafMoveRef = useRef<number | null>(null)
  const pendingPointerRef = useRef<PointerEvent | null>(null)
  const mobileDragHoldTimerRef = useRef<number | null>(null)
  const mobilePressRef = useRef<{
    pointerId: number | null
    startX: number
    startY: number
    cancelled: boolean
    longPressArmed: boolean
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    cancelled: false,
    longPressArmed: false,
  })
  const mobileLastTapRef = useRef<{ ts: number; x: number; y: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const posRef = useRef(pos)
  const sizeRef = useRef(size)
  const seeded = useRef(false)
  const pendingSizeRaf = useRef<number | null>(null)
  const lastSizePatchRef = useRef<{ w: number; h: number } | null>(null)
  const lastClampPatchRef = useRef<{ x: number; y: number; docked: boolean; dockSide?: 'left' | 'right' } | null>(null)
  const lastMobileFinalPosRef = useRef<{ x: number; y: number } | null>(null)
  const dockPreviewRef = useRef<'left' | 'right' | null>(null)
  const snapGuideRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null })
  /** Set in undock handlers only — consumed in `useEffect` (never during render). */
  const pendingFloatingDefaultSizeRef = useRef(false)
  /** Floating layout already had persisted size, or default was applied after undock. */
  const [hasInitializedFloatingSize, setHasInitializedFloatingSize] = useState(
    () => Boolean(layout && layout.docked !== true),
  )
  type DockMutationSource = 'controller' | 'sync' | 'unknown'
  const dockMutationSourceRef = useRef<DockMutationSource>('unknown')

  posRef.current = pos
  sizeRef.current = size
  dockPreviewRef.current = dockPreview
  snapGuideRef.current = snapGuide

  const profile = getDeviceProfile()
  const wantsReducedMotion = profile.prefersReducedMotion
  const isIOSWebKit = profile.isIOS
  const isMobile = profile.interactionMode === 'mobile'
  const isCoarsePointer = profile.isCoarsePointer
  const dragThreshold = isIOSWebKit ? 14 : isCoarsePointer ? 12 : DRAG_THRESHOLD_PX
  const edgeDockZone = isMobile
    ? Math.max(10, Math.round(EDGE_DOCK_ZONE_PX * 0.6))
    : isIOSWebKit
      ? 44
      : isCoarsePointer
        ? 40
        : EDGE_DOCK_ZONE_PX
  const panelSnapThreshold = isIOSWebKit ? 14 : isCoarsePointer ? 12 : PANEL_SNAP_THRESHOLD_PX
  const dockRelockGuard = isIOSWebKit ? 96 : isCoarsePointer ? 64 : DOCK_RELOCK_GUARD_PX
  const dockUndockSwipe = isIOSWebKit ? 12 : DOCK_UNDOCK_SWIPE_PX
  const minWidthEffective = isMobile ? Math.max(120, minWidth - 20) : minWidth
  const minHeightEffective = isMobile ? Math.max(96, minHeight - 16) : minHeight
  const mobileFocusBoost = isMobile && dragMode !== 'none' ? 1000 : 0
  const interactionController = useMemo(() => {
    // Critical DEPE guard: if desktop interaction is forbidden for the current
    // mode, force mobile controller selection.
    if (!isMobile && !assertPolicy('controller.desktopInteractionModel', `panel=${panelId}`)) {
      return new MobileInteractionController()
    }
    return isMobile ? new MobileInteractionController() : new DesktopInteractionController()
  }, [isMobile, panelId])
  const canDock = useCallback(
    (source: DockRequestSource) => interactionController.onDockRequest(source),
    [interactionController],
  )
  const withDockMutationSource = useCallback((source: DockMutationSource, run: () => void) => {
    const prev = dockMutationSourceRef.current
    dockMutationSourceRef.current = source
    try {
      run()
    } finally {
      dockMutationSourceRef.current = prev
    }
  }, [])
  const setDockedGuarded = useCallback(
    (next: React.SetStateAction<boolean>, source: DockMutationSource = 'unknown') => {
      if (import.meta.env.DEV && source === 'unknown') {
        console.warn('[DOCK BYPASS DETECTED]')
      }
      withDockMutationSource(source, () => setDocked(next))
    },
    [withDockMutationSource],
  )

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[INTERACTION ROUTE]', isMobile ? 'mobile' : 'desktop')
      console.warn('[DOCK AUDIT]', 'Verify docking conditionals remain routed through InteractionController')
    }
    updateActiveController(isMobile ? 'mobile' : 'desktop')
    // DEPE: announce which interaction model is active. Engine compares
    // against the policy table for the current device mode and emits a
    // violation if (e.g.) desktop controller mounted in mobile mode.
    reportPolicyAttempt(
      isMobile ? 'controller.mobileInteractionModel' : 'controller.desktopInteractionModel',
      'enable',
      `panel=${panelId}`,
    )
    reportPolicyAttempt(
      isMobile ? 'controller.desktopInteractionModel' : 'controller.mobileInteractionModel',
      'disable',
      `panel=${panelId}`,
    )
  }, [isMobile, panelId])

  const avoidRuntimeOverlap = useCallback(
    (x: number, y: number, w: number, h: number) => {
      let nx = x
      let ny = y
      const pad = isMobile
        ? Math.max(0, Math.min(4, Math.round(prefs.panel_gap_px ?? 0)))
        : Math.max(PANEL_KISS_GAP_PX, Math.max(0, Math.min(24, Math.round(prefs.panel_gap_px ?? 0))))
      const { vw, vh } = viewportSize()
      const panelHeight = (id: string, p: typeof panels[string]) => {
        if (!p) return 120
        if (p.docked) {
          const side = p.dockSide ?? 'left'
          const laneCount = Object.entries(panels).filter(
            ([pid, panel]) =>
              pid !== panelId &&
              !!panel?.docked &&
              (panel.dockSide ?? 'left') === side,
          ).length + ((p.dockSide ?? 'left') === side ? 1 : 0)
          return computeDockMetrics(vh, laneCount).height
        }
        return p.h ?? (p.minimized ? (isCoarsePointer ? 46 : 44) : 180)
      }
      for (let iter = 0; iter < (isMobile ? 12 : 36); iter++) {
        const a = { l: nx, t: ny, r: nx + w, b: ny + h }
        let collided = false
        for (const [id, panel] of Object.entries(panels)) {
          if (id === panelId || !panel) continue
          const ph = panelHeight(id, panel)
          const b = { l: panel.x, t: panel.y, r: panel.x + panel.w, b: panel.y + ph }
          const overlap = !(a.r <= b.l + pad || a.l >= b.r - pad || a.b <= b.t + pad || a.t >= b.b - pad)
          if (!overlap) continue
          collided = true
          const overlapX = Math.min(a.r - b.l, b.r - a.l)
          const overlapY = Math.min(a.b - b.t, b.b - a.t)
          if (overlapX < overlapY) {
            const pushLeft = a.l + w / 2 < b.l + (b.r - b.l) / 2
            nx = pushLeft ? b.l - w - pad : b.r + pad
          } else {
            const pushUp = a.t + h / 2 < b.t + (b.b - b.t) / 2
            ny = pushUp ? b.t - h - pad : b.b + pad
          }
          // Keep collision separation exact; snapping here can reintroduce tiny overlap.
          nx = Math.max(0, Math.min(nx, vw - w))
          ny = Math.max(36, Math.min(ny, vh - h))
          a.l = nx
          a.t = ny
          a.r = nx + w
          a.b = ny + h
        }
        if (!collided) break
      }
      return { x: nx, y: ny }
    },
    [panelId, panels, isCoarsePointer, isMobile, prefs.panel_gap_px],
  )

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    if (!layout) {
      const { vw, vh } = viewportSize()
      const clampedW = isCoarsePointer
        ? Math.max(minWidth, Math.min(initialWidth, Math.max(minWidth, vw - 16)))
        : initialWidth
      const baseH = initialHeight ?? minHeight
      const clampedX = Math.max(0, Math.min(initialPos.x, vw - clampedW))
      const clampedY = Math.max(36, Math.min(initialPos.y, vh - baseH))
      safeUpdatePanel(panelId, {
        x: clampedX,
        y: clampedY,
        w: clampedW,
        h: initialHeight,
        z: panelId === 'layers' ? 400 : panelId === 'waypoints' ? 401 : 402,
        minimized: false,
      })
    }
  }, [
    initialHeight,
    initialPos.x,
    initialPos.y,
    initialWidth,
    layout,
    minHeight,
    minWidth,
    isCoarsePointer,
    panelId,
    safeUpdatePanel,
  ])

  useEffect(() => {
    if (layout) {
      if (
        isMobile &&
        dragMode === 'none' &&
        lastMobileFinalPosRef.current &&
        (Math.abs(layout.x - lastMobileFinalPosRef.current.x) > 0.5 ||
          Math.abs(layout.y - lastMobileFinalPosRef.current.y) > 0.5)
      ) {
        console.warn('[MOBILE POST-DRAG MODIFIER DETECTED]', {
          expected: lastMobileFinalPosRef.current,
          actual: { x: layout.x, y: layout.y },
        })
      }
      if (Math.abs(posRef.current.x - layout.x) > 0.5 || Math.abs(posRef.current.y - layout.y) > 0.5) {
        const nextPos = { x: layout.x, y: layout.y }
        setPos(nextPos)
        posRef.current = nextPos
      }
      const committedW = layout.docked ? DOCKED_PANEL_WIDTH_PX : layout.w
      if (sizeRef.current.w !== committedW || sizeRef.current.h !== layout.h) {
        const nextSize = { w: committedW, h: layout.h }
        setSize(nextSize)
        sizeRef.current = nextSize
      }
      setMinimized((prev) => (prev === layout.minimized ? prev : layout.minimized))
      setDockedGuarded((prev) => (prev === (layout.docked ?? false) ? prev : (layout.docked ?? false)), 'sync')
      setDockSide((prev) => (prev === (layout.dockSide ?? 'left') ? prev : (layout.dockSide ?? 'left')))
    }
  }, [layout?.x, layout?.y, layout?.w, layout?.h, layout?.minimized, layout?.docked, layout?.dockSide])

  useEffect(() => {
    if (layout?.docked === true) {
      setHasInitializedFloatingSize((prev) => (prev ? false : prev))
    }
  }, [layout?.docked])

  /** Persisted / synced floating layout: mark sized so we do not stomp user storage with defaults. */
  useEffect(() => {
    if (!layout || layout.docked === true) return
    if (pendingFloatingDefaultSizeRef.current) return
    setHasInitializedFloatingSize((prev) => (prev ? prev : true))
  }, [layout?.docked])

  useEffect(() => {
    if (!isMobile && isMaximized) {
      setIsMaximized(false)
      return
    }
    if ((docked || minimized) && isMaximized) {
      setIsMaximized(false)
    }
  }, [isMobile, docked, minimized, isMaximized])

  useEffect(() => {
    return () => {
      if (mobileDragHoldTimerRef.current != null) {
        window.clearTimeout(mobileDragHoldTimerRef.current)
        mobileDragHoldTimerRef.current = null
      }
    }
  }, [])

  const isFloating = !docked
  useEffect(() => {
    if (!isFloating) return
    if (hasInitializedFloatingSize) return
    if (!pendingFloatingDefaultSizeRef.current) return

    pendingFloatingDefaultSizeRef.current = false

    const nw = DEFAULT_FLOATING_PANEL_SIZE.w
    const { vw, vh } = viewportSize()
    const mobileTargetW = Math.round(vw * 0.4)
    const nwFinal = isMobile
      ? Math.max(minWidth, Math.min(mobileTargetW, Math.max(minWidth, vw - 20)))
      : isCoarsePointer
        ? Math.max(minWidth, Math.min(nw, Math.max(minWidth, vw - 16)))
        : nw
    const nh = DEFAULT_FLOATING_PANEL_SIZE.h
    const mobileMaxH = Math.max(minHeightEffective, vh - 96)
    const nhFinal = isMobile
      ? Math.max(minHeightEffective, Math.min(Math.round(vh * 0.5), mobileMaxH))
      : Math.max(minHeightEffective, Math.min(nh, Math.max(minHeightEffective, vh - 48)))
    let nx = posRef.current.x
    let ny = posRef.current.y
    if (isMobile) {
      nx = Math.round((vw - nwFinal) / 2)
      ny = Math.max(36, Math.round((vh - nhFinal) / 2))
    } else if (dockSide === 'right') {
      nx = Math.max(0, vw - nwFinal - DOCK_EDGE_INSET_PX)
    } else {
      nx = DOCK_EDGE_INSET_PX
    }
    nx = Math.max(0, Math.min(nx, vw - nwFinal))
    ny = Math.max(36, Math.min(ny, vh - nhFinal))

    const nextSize = { w: nwFinal, h: nhFinal }
    const nextPos = { x: nx, y: ny }
    sizeRef.current = nextSize
    posRef.current = nextPos
    setSize(nextSize)
    setPos(nextPos)
    setHasInitializedFloatingSize(true)
    safeUpdatePanel(panelId, {
      docked: false,
      dockSide,
      x: nx,
      y: ny,
      w: nwFinal,
      h: nhFinal,
    })
  }, [isFloating, hasInitializedFloatingSize, dockSide, panelId, safeUpdatePanel, isCoarsePointer, isMobile, minHeightEffective, minWidthEffective])

  // Floating panels: width/height must not animate — ResizeObserver→syncSize commits layout from
  // getBoundingClientRect(); animating those dimensions yields intermediate sizes and feedback growth.
  const floatingForDimensionSync =
    !docked && !minimized && !(isMobile && isMaximized)
  const dimensionTransitionMs =
    prefs.animations_enabled && !wantsReducedMotion && floatingForDimensionSync ? 0 : DURATION_MS
  const transition =
    prefs.animations_enabled && !wantsReducedMotion
      ? `box-shadow ${DURATION_MS}ms ${EASE}, width ${dimensionTransitionMs}ms ${EASE}, height ${dimensionTransitionMs}ms ${EASE}, left ${DURATION_MS}ms ${EASE}, top ${DURATION_MS}ms ${EASE}, transform ${DURATION_MS}ms ${EASE}`
      : undefined

  const getDockedY = useCallback(
    (side: 'left' | 'right', desiredY: number) => {
      const { vh } = viewportSize()

      // Magnetic lane stacking: assign each docked panel to a unique slot.
      // This keeps the dock rail clean and prevents overlap even after reloads.
      const lane = Object.entries(panels)
        .filter(([, panel]) => panel?.docked && (panel.dockSide ?? 'left') === side)
        .map(([id, panel]) => ({ id, y: panel.y }))

      if (!lane.some((p) => p.id === panelId)) {
        lane.push({ id: panelId, y: desiredY })
      }

      lane.sort((a, b) => (a.y === b.y ? a.id.localeCompare(b.id) : a.y - b.y))
      const { minY, maxY, step } = computeDockMetrics(vh, lane.length)
      const slotCount = Math.max(1, Math.floor((maxY - minY) / step) + 1)

      const usedSlots = new Set<number>()
      let selfSlot = 0

      for (const entry of lane) {
        const raw = Math.round((entry.y - minY) / step)
        let slot = Math.max(0, Math.min(slotCount - 1, raw))
        if (usedSlots.has(slot)) {
          let found = false
          for (let i = 0; i < slotCount; i++) {
            if (!usedSlots.has(i)) {
              slot = i
              found = true
              break
            }
          }
          if (!found) {
            slot = slotCount - 1
          }
        }
        usedSlots.add(slot)
        if (entry.id === panelId) selfSlot = slot
      }

      const y = minY + selfSlot * step
      return Math.max(minY, Math.min(y, maxY))
    },
    [panelId, panels],
  )

  const chooseMobileMinimizeDockSide = useCallback((): 'left' | 'right' => {
    const prevSide = layout?.dockSide ?? panels[panelId]?.dockSide ?? null
    if (prevSide === 'left' || prevSide === 'right') return prevSide
    const { vw } = viewportSize()
    const panelCenterX = posRef.current.x + sizeRef.current.w / 2
    const viewportCenterX = vw / 2
    const delta = panelCenterX - viewportCenterX
    if (Math.abs(delta) > 24) return delta < 0 ? 'left' : 'right'
    const leftCount = Object.entries(panels).filter(
      ([id, panel]) => id !== panelId && !!panel?.docked && (panel.dockSide ?? 'left') === 'left',
    ).length
    const rightCount = Object.entries(panels).filter(
      ([id, panel]) => id !== panelId && !!panel?.docked && (panel.dockSide ?? 'left') === 'right',
    ).length
    return leftCount <= rightCount ? 'left' : 'right'
  }, [layout?.dockSide, panelId, panels])

  useEffect(() => {
    // Clear stale clamp memo whenever committed layout changes.
    // Bounds correction is handled by explicit drag/commit flows to avoid passive-effect update loops.
    lastClampPatchRef.current = null
  }, [layout?.x, layout?.y, layout?.w, layout?.h, layout?.docked, layout?.dockSide])

  // Keep stored panel dimensions aligned with actual rendered size so
  // collision math remains accurate and panels cannot silently overlap.
  useEffect(() => {
    const el = rootRef.current
    if (!el || !layout || docked || minimized || dragMode !== 'none') return
    // Maximized mobile shell uses width/height `auto` + inset layout; measuring here would
    // persist viewport-sized dimensions and corrupt the real floating size on restore.
    if (isMobile && isMaximized) return

    const syncSize = () => {
      const rect = el.getBoundingClientRect()
      const rw = Math.round(rect.width)
      const rh = Math.round(rect.height)
      if (!Number.isFinite(rw) || !Number.isFinite(rh)) return
      const committedW = layout.w ?? 0
      const committedH = layout.h ?? 0
      const wDelta = Math.abs(committedW - rw)
      const hDelta = Math.abs(committedH - rh)
      const lastPatched = lastSizePatchRef.current
      const alreadyPatched = lastPatched?.w === rw && lastPatched?.h === rh
      if ((wDelta > 2 || hDelta > 2 || layout.h == null) && !alreadyPatched) {
        lastSizePatchRef.current = { w: rw, h: rh }
        safeUpdatePanel(panelId, { w: rw, h: rh })
      }
    }

    syncSize()
    const ro = new ResizeObserver(() => {
      if (pendingSizeRaf.current != null) return
      pendingSizeRaf.current = requestAnimationFrame(() => {
        pendingSizeRaf.current = null
        syncSize()
      })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (pendingSizeRaf.current != null) {
        cancelAnimationFrame(pendingSizeRaf.current)
        pendingSizeRaf.current = null
      }
    }
  }, [panelId, safeUpdatePanel, layout?.w, layout?.h, layout?.docked, docked, minimized, dragMode, isMaximized])

  const commitPosition = useCallback(() => {
    const el = rootRef.current
    const rect = el?.getBoundingClientRect()
    const s = sizeRef.current
    const p = posRef.current
    const height = minimized
      ? isCoarsePointer
        ? 46
        : 44
      : s.h ?? Math.ceil(rect?.height ?? minHeight)

    let shouldDock = false
    if (isMobile) {
      // MOBILE = NEVER DOCK FROM DRAG
      shouldDock = false
    }

    if (isMobile) {
      const source: DockIntentSource = 'drag'
      console.log('[DOCK FINAL CHECK]', {
        isMobile,
        source,
        allowed: mobileDockAllowed(source, isMobile),
      })
      const { vw, vh } = viewportSize()
      const nx = Math.max(0, Math.min(p.x, vw - s.w))
      const ny = Math.max(36, Math.min(p.y, vh - Math.max(minHeight, height)))
      const next = { x: nx, y: ny }
      posRef.current = next
      setPos(next)
      setDockPreview(null)
      setSnapGuide({ x: null, y: null })
      safeUpdatePanel(panelId, {
        x: next.x,
        y: next.y,
        w: s.w,
        h: Math.max(minHeight, s.h ?? Math.ceil(rect?.height ?? minHeight)),
        minimized,
        docked: false,
        dockSide,
      })
      lastMobileFinalPosRef.current = next
      console.log('[MOBILE FINAL POSITION]', next.x, next.y)
      return
    }
    let sx = snapCoord(p.x)
    let sy = snapCoord(p.y)
    const resolved = resolveCollisions(panelId, sx, sy, s.w, height)
    sx = resolved.x
    sy = resolved.y
    const { vw } = viewportSize()
    const movedAwayFromUndock =
      !undockedAt.current || Math.abs(sx - undockedAt.current.x) > dockRelockGuard
    const shouldDockLeft = movedAwayFromUndock && (dockPreview === 'left' || sx <= edgeDockZone)
    const shouldDockRight =
      movedAwayFromUndock && (dockPreview === 'right' || sx + s.w >= vw - edgeDockZone)
    shouldDock = shouldDockLeft || shouldDockRight
    const dockAllowed = canDock('drag')
    if (shouldDock && !dockAllowed) {
      shouldDock = false
    }
    const nextDockSide: 'left' | 'right' = shouldDockRight ? 'right' : 'left'
    if (shouldDock) {
      const source: DockIntentSource = 'drag'
      if (!mobileDockAllowed(source, isMobile)) {
        console.warn('[DOCK BLOCKED - MOBILE]', source)
        return
      }
      console.log('[DOCK FINAL CHECK]', {
        isMobile,
        source,
        allowed: mobileDockAllowed(source, isMobile),
      })
      const dockW = DOCKED_PANEL_WIDTH_PX
      const dockX =
        nextDockSide === 'right'
          ? Math.max(0, vw - dockW - DOCK_EDGE_INSET_PX)
          : DOCK_EDGE_INSET_PX
      const dockY = getDockedY(nextDockSide, sy)
      const next = { x: dockX, y: dockY }
      const nextSize = { w: dockW, h: s.h }
      posRef.current = next
      sizeRef.current = nextSize
      setPos(next)
      setSize(nextSize)
      setDockedGuarded(true, 'controller')
      setDockSide(nextDockSide)
      setDockPreview(null)
      undockedAt.current = null
      safeUpdatePanel(panelId, {
        x: dockX,
        y: dockY,
        w: dockW,
        h: Math.max(minHeight, s.h ?? Math.ceil(rect?.height ?? minHeight)),
        minimized,
        docked: true,
        dockSide: nextDockSide,
      })
      return
    }

    const runtimeResolved = avoidRuntimeOverlap(sx, sy, s.w, Math.max(minHeight, height))
    const next = { x: runtimeResolved.x, y: runtimeResolved.y }
    posRef.current = next
    setPos(next)
    setDockPreview(null)
    setSnapGuide({ x: null, y: null })
    safeUpdatePanel(panelId, {
      x: next.x,
      y: next.y,
      w: s.w,
      h: Math.max(minHeight, s.h ?? Math.ceil(rect?.height ?? minHeight)),
      minimized,
      docked: false,
      dockSide,
    })
  }, [
    dockPreview,
    dockSide,
    canDock,
    isMobile,
    minimized,
    panelId,
    resolveCollisions,
    snapCoord,
    minHeight,
    getDockedY,
    dockRelockGuard,
    edgeDockZone,
    avoidRuntimeOverlap,
    isCoarsePointer,
  ])

  useEffect(() => {
    // 🔒 CONTRACT: Panel interaction system is locked.
    // - Drag must not jump or offset from cursor
    // - Dock gap must remain 0 (flush stacking)
    // - Left/right dock must remain symmetrical
    // - Undock must always clear minimized
    // Do NOT modify without explicit approval
    if (dragMode === 'none') return
    setMapInteractionBlocked(true)

    const setDockPreviewIfChanged = (nextDockPreview: 'left' | 'right' | null) => {
      if (dockPreviewRef.current === nextDockPreview) return
      dockPreviewRef.current = nextDockPreview
      setDockPreview(nextDockPreview)
    }

    const setSnapGuideIfChanged = (nextGuide: { x: number | null; y: number | null }) => {
      const prev = snapGuideRef.current
      if (prev.x === nextGuide.x && prev.y === nextGuide.y) return
      snapGuideRef.current = nextGuide
      setSnapGuide(nextGuide)
    }

    const processMove = (e: PointerEvent) => {
      if (isCoarsePointer && e.cancelable) e.preventDefault()
      const mode = dragMode
      if (mode === 'move' || mode === 'pending') {
        if (mode === 'pending') {
          const d = Math.hypot(
            e.clientX - dragStartScreen.current.x,
            e.clientY - dragStartScreen.current.y,
          )
          if (d < dragThreshold) return
          setDragMode('move')
        }
        let nx = e.clientX - drag.current.dx
        let ny = e.clientY - drag.current.dy
        const { vw, vh } = viewportSize()
        const s = sizeRef.current
        const pw = s.w
        const measuredH = rootRef.current?.getBoundingClientRect().height
        const ph = minimized
          ? isCoarsePointer
            ? 46
            : 44
          : Math.max(minHeight, s.h ?? Math.ceil(measuredH ?? minHeight))
        const minX = 0
        const maxX = vw - pw
        nx = Math.max(minX, Math.min(nx, maxX))
        ny = Math.max(36, Math.min(ny, vh - ph))
        let nextDockPreview: 'left' | 'right' | null = null
        if (!isMobile) {
          if (nx <= edgeDockZone) nextDockPreview = 'left'
          else if (nx + pw >= vw - edgeDockZone) nextDockPreview = 'right'
        }
        setDockPreviewIfChanged(nextDockPreview)

        const guideX: number | null = null
        const guideY: number | null = null
        setSnapGuideIfChanged({ x: guideX, y: guideY })
        if (Math.abs(posRef.current.x - nx) > 0.5 || Math.abs(posRef.current.y - ny) > 0.5) {
          const next = { x: nx, y: ny }
          posRef.current = next
          setPos(next)
        }
      } else if (mode === 'resize') {
        const rect = rootRef.current?.getBoundingClientRect()
        if (!rect) return
        let nw = Math.max(minWidthEffective, e.clientX - rect.left)
        let nh = Math.max(minHeightEffective, e.clientY - rect.top)
        if (isMobile) {
          nw = sizeRef.current.w + (nw - sizeRef.current.w) * 0.88
          nh = (sizeRef.current.h ?? minHeightEffective) + (nh - (sizeRef.current.h ?? minHeightEffective)) * 0.88
          nw = Math.round(nw)
          nh = Math.round(nh)
        }
        const { vw, vh } = viewportSize()
        const p = posRef.current
        if (p.x + nw > vw - 4) {
          nw = vw - p.x - 4
          setResizeBump(true)
          window.setTimeout(() => setResizeBump(false), 180)
        }
        if (p.y + nh > vh - 4) {
          nh = vh - p.y - 4
          setResizeBump(true)
          window.setTimeout(() => setResizeBump(false), 180)
        }
        // Keep resized dimensions aligned to snap grid and away from overlap.
        nw = Math.max(minWidthEffective, snapCoord(nw))
        nh = Math.max(minHeightEffective, snapCoord(nh))
        const resolved = avoidRuntimeOverlap(p.x, p.y, nw, nh)
        if (Math.abs(resolved.x - p.x) > 0.5 || Math.abs(resolved.y - p.y) > 0.5) {
          const nextPos = { x: resolved.x, y: resolved.y }
          posRef.current = nextPos
          setPos(nextPos)
        }
        if (Math.abs(sizeRef.current.w - nw) > 0.5 || Math.abs((sizeRef.current.h ?? 0) - nh) > 0.5) {
          const next = { w: nw, h: nh }
          sizeRef.current = next
          setSize(next)
        }
      }
    }

    const onMove = (e: PointerEvent) => {
      pendingPointerRef.current = e
      if (rafMoveRef.current != null) return
      rafMoveRef.current = requestAnimationFrame(() => {
        rafMoveRef.current = null
        const latest = pendingPointerRef.current
        if (!latest) return
        interactionController.onDragMove(() => processMove(latest))
      })
    }

    const onUp = () => {
      if (dragMode === 'pending') {
        setDragMode('none')
        setGlow(false)
        setDockPreviewIfChanged(null)
        setSnapGuideIfChanged({ x: null, y: null })
        setMapInteractionBlocked(false)
        return
      }
      setDragMode('none')
      setGlow(false)
      setSnapGuideIfChanged({ x: null, y: null })
      interactionController.onDragEnd(() => {
        interactionController.onPanelCommitPosition(() => commitPosition())
      })
      setMapInteractionBlocked(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      setMapInteractionBlocked(false)
      if (rafMoveRef.current != null) {
        cancelAnimationFrame(rafMoveRef.current)
        rafMoveRef.current = null
      }
      pendingPointerRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [
    commitPosition,
    dragMode,
    minimized,
    minHeight,
    minWidth,
    dragThreshold,
    edgeDockZone,
    isCoarsePointer,
    isMobile,
    interactionController,
    setMapInteractionBlocked,
  ])

  // MOBILE FIELD INTERACTION RULE: panels MUST NOT auto-rearrange on rotation,
  // resize, or visualViewport changes (URL bar collapse, software keyboard).
  // The previous mobile resize handler clamped position/size to viewport bounds
  // and wrote the result back to persisted state on every viewport tick, which
  // counted as auto-rearrange and contradicted the manual-placement contract.
  // If a panel ends up off-screen after rotation, the user repositions it
  // (drag, or minimize → dock to bring it back to the dock lane).
  // Desktop behavior is unchanged (this effect was mobile-only).

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (isMobile && isMaximized) return
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return
    // Browser compatibility: some touch/pen implementations report non-zero button values.
    if (e.pointerType === 'mouse' && e.button !== 0) return

    if (isMobile && !docked) {
      const now = Date.now()
      const lastTap = mobileLastTapRef.current
      const isDoubleTap =
        lastTap != null &&
        now - lastTap.ts <= MOBILE_DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= 18
      mobileLastTapRef.current = { ts: now, x: e.clientX, y: e.clientY }
      if (isDoubleTap) {
        if (mobileDragHoldTimerRef.current != null) {
          window.clearTimeout(mobileDragHoldTimerRef.current)
          mobileDragHoldTimerRef.current = null
        }
        mobilePressRef.current = {
          pointerId: null,
          startX: 0,
          startY: 0,
          cancelled: true,
          longPressArmed: false,
        }
        setIsMaximized((prev) => !prev)
        e.preventDefault()
        return
      }

      raisePanel(panelId)
      mobilePressRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        cancelled: false,
        longPressArmed: false,
      }

      const clearHold = () => {
        if (mobileDragHoldTimerRef.current != null) {
          window.clearTimeout(mobileDragHoldTimerRef.current)
          mobileDragHoldTimerRef.current = null
        }
      }
      const teardown = () => {
        window.removeEventListener('pointermove', onPreDragMove)
        window.removeEventListener('pointerup', onPreDragEnd)
        window.removeEventListener('pointercancel', onPreDragEnd)
      }
      const onPreDragMove = (ev: PointerEvent) => {
        const press = mobilePressRef.current
        if (press.pointerId == null || ev.pointerId !== press.pointerId) return
        const moved = Math.hypot(ev.clientX - press.startX, ev.clientY - press.startY) > 8
        if (moved && !press.longPressArmed) {
          press.cancelled = true
          clearHold()
          teardown()
        }
      }
      const onPreDragEnd = (ev: PointerEvent) => {
        const press = mobilePressRef.current
        if (press.pointerId == null || ev.pointerId !== press.pointerId) return
        press.cancelled = true
        press.pointerId = null
        clearHold()
        teardown()
      }

      window.addEventListener('pointermove', onPreDragMove)
      window.addEventListener('pointerup', onPreDragEnd)
      window.addEventListener('pointercancel', onPreDragEnd)

      mobileDragHoldTimerRef.current = window.setTimeout(() => {
        const press = mobilePressRef.current
        if (press.cancelled || press.pointerId == null) return
        press.longPressArmed = true
        clearHold()
        teardown()
        setGlow(true)
        dragStartScreen.current = { x: e.clientX, y: e.clientY }
        drag.current = { dx: e.clientX - posRef.current.x, dy: e.clientY - posRef.current.y }
        interactionController.onDragStart(() => setDragMode('move'))
      }, MOBILE_DRAG_HOLD_MS)
      return
    }

    if (docked) {
      pendingFloatingDefaultSizeRef.current = true
      const nw = DEFAULT_FLOATING_PANEL_SIZE.w
      const { vw, vh } = viewportSize()
      const mobileTargetW = Math.round(vw * 0.4)
      const nwFinal = isMobile
        ? Math.max(minWidth, Math.min(mobileTargetW, Math.max(minWidth, vw - 20)))
        : isCoarsePointer
          ? Math.max(minWidth, Math.min(nw, Math.max(minWidth, vw - 16)))
          : nw
      const spawnInset = isMobile ? 12 : 0
      const baseXRaw =
        dockSide === 'right'
          ? Math.max(0, vw - nwFinal - DOCK_EDGE_INSET_PX - spawnInset)
          : DOCK_EDGE_INSET_PX + spawnInset
      const baseX = Math.max(0, Math.min(baseXRaw, vw - nwFinal))
      const baseY = Math.max(36, Math.min(posRef.current.y, vh - Math.max(minHeight, sizeRef.current.h ?? minHeight)))
      setDockedGuarded(false, 'controller')
      setMinimized(false)
      setDockPreview(null)
      undockedAt.current = { x: baseX, y: baseY }
      safeUpdatePanel(panelId, {
        docked: false,
        minimized: false,
        dockSide,
        x: baseX,
        y: baseY,
      })
      const next = { x: baseX, y: baseY }
      posRef.current = next
      setPos(next)
    }
    raisePanel(panelId)
    setGlow(true)
    dragStartScreen.current = { x: e.clientX, y: e.clientY }
    drag.current = { dx: e.clientX - posRef.current.x, dy: e.clientY - posRef.current.y }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore capture failures
    }
    interactionController.onDragStart(() => setDragMode('pending'))
    e.preventDefault()
  }

  const onHeaderDoubleClick = () => {
    if (isMobile) return
    setMinimized((m) => {
      const next = !m
      safeUpdatePanel(panelId, { minimized: next })
      return next
    })
  }

  const onResizePointerDown = (e: React.PointerEvent) => {
    if (isMobile && isMaximized) return
    if (docked) return
    e.stopPropagation()
    raisePanel(panelId)
    setGlow(true)
    interactionController.onResize(() => setDragMode('resize'))
    e.preventDefault()
  }

  const toggleDocked = () => {
    setDockedGuarded((prev) => {
      const next = !prev
      if (next) {
        const source: DockIntentSource = 'toggle'
        if (!mobileDockAllowed(source, isMobile)) {
          console.warn('[DOCK BLOCKED - MOBILE]', source)
          console.log('[DOCK FINAL CHECK]', {
            isMobile,
            source,
            allowed: mobileDockAllowed(source, isMobile),
          })
          return prev
        }
        const allowed = canDock('toggle')
        if (!allowed) return prev
        console.log('[DOCK FINAL CHECK]', {
          isMobile,
          source,
          allowed: mobileDockAllowed(source, isMobile),
        })
        const dockW = DOCKED_PANEL_WIDTH_PX
        const x =
          dockSide === 'right'
            ? Math.max(0, viewportSize().vw - dockW - DOCK_EDGE_INSET_PX)
            : DOCK_EDGE_INSET_PX
        const dockPos = { x, y: getDockedY(dockSide, posRef.current.y) }
        const nextSize = { w: dockW, h: sizeRef.current.h }
        posRef.current = dockPos
        sizeRef.current = nextSize
        setPos(dockPos)
        setSize(nextSize)
        undockedAt.current = null
        safeUpdatePanel(panelId, { docked: true, dockSide, x: dockPos.x, y: dockPos.y, w: dockW })
      } else {
        setMinimized(false)
        setDockPreview(null)
        undockedAt.current = { x: posRef.current.x, y: posRef.current.y }
        pendingFloatingDefaultSizeRef.current = true
        safeUpdatePanel(panelId, { docked: false, minimized: false })
      }
      return next
    }, 'controller')
  }

  const minimizeToDock = () => {
    const allowed = canDock('minimize')
    if (!allowed) return
    if (isMobile) {
      console.log('[MOBILE DOCK TRIGGER] source: button')
    }
    const side = isMobile ? chooseMobileMinimizeDockSide() : dockSide
    const s = sizeRef.current
    const dockW = DOCKED_PANEL_WIDTH_PX
    const { vw } = viewportSize()
    const x =
      side === 'right'
        ? Math.max(0, vw - dockW - DOCK_EDGE_INSET_PX)
        : DOCK_EDGE_INSET_PX
    const y = getDockedY(side, posRef.current.y)
    const dockPos = { x, y }
    const nextSize = { w: dockW, h: s.h }
    posRef.current = dockPos
    sizeRef.current = nextSize
    setPos(dockPos)
    setSize(nextSize)
    setMinimized(true)
    const source: DockIntentSource = 'minimize'
    if (!mobileDockAllowed(source, isMobile)) {
      console.warn('[DOCK BLOCKED - MOBILE]', source)
      return
    }
    console.log('[DOCK FINAL CHECK]', {
      isMobile,
      source,
      allowed: mobileDockAllowed(source, isMobile),
    })
    setDockedGuarded(true, 'controller')
    setDockPreview(null)
    undockedAt.current = null
    safeUpdatePanel(panelId, {
      x: dockPos.x,
      y: dockPos.y,
      w: dockW,
      h: s.h,
      minimized: true,
      docked: true,
      dockSide: side,
    })
  }

  // 🔒 CONTRACT: Visual styling is locked.
  // - Glass effect must remain
  // - Transparency must not increase/decrease
  // - Glow, spacing, and contrast must not drift
  // Do NOT modify without explicit approval
  const panelBg = 'rgba(20, 20, 20, 0.6)'
  const lowLightGlow = prefs.screen_hue === 'low_light' ? `0 0 10px ${accent}66` : undefined
  const isDeadmanPanel = panelId === 'deadman'
  const panelBorderColor =
    isDeadmanPanel
      ? 'rgba(255, 68, 102, 0.95)'
      : prefs.screen_hue === 'red_tactical'
        ? 'rgba(204, 0, 0, 0.9)'
      : prefs.screen_hue === 'low_light'
        ? 'rgba(0, 255, 136, 0.9)'
        : 'rgba(0, 255, 136, 0.78)'
  const panelEdgeGlow = isDeadmanPanel
    ? 'rgba(255, 68, 102, 0.7)'
    : prefs.screen_hue === 'red_tactical'
      ? 'rgba(204, 0, 0, 0.38)'
    : prefs.screen_hue === 'low_light'
      ? 'rgba(0, 255, 136, 0.6)'
      : 'rgba(0, 255, 136, 0.45)'
  const panelHaloGlow = isDeadmanPanel
    ? 'rgba(255, 68, 102, 0.48)'
    : prefs.screen_hue === 'red_tactical'
      ? 'rgba(204, 0, 0, 0.2)'
    : prefs.screen_hue === 'low_light'
      ? 'rgba(0, 255, 136, 0.38)'
      : 'rgba(0, 255, 136, 0.3)'
  const panelTextColor =
    prefs.screen_hue === 'low_light'
      ? '#d5e2d8'
      : prefs.screen_hue === 'red_tactical'
        ? '#f2f2f2'
        : '#d2d8d2'
  const panelSubtleText =
    prefs.screen_hue === 'low_light'
      ? '#aab7ad'
      : prefs.screen_hue === 'red_tactical'
        ? '#e0e0e0'
        : '#9ea7a0'
  const panelTextShadow = prefs.screen_hue === 'red_tactical' ? '0 0 2px rgba(0,0,0,0.8)' : lowLightGlow
  // Wider peek when the strip carries extra controls (e.g. waypoint delete); still a single rail width for plain panels.
  const dockReveal =
    dockedHeaderTrailing != null
      ? Math.max(DOCK_VISIBLE_STRIP_PX, 104)
      : DOCK_VISIBLE_STRIP_PX
  // Keep dock strip metrics aligned with committed context layout to avoid
  // per-panel height divergence that can visually overlap docked lanes.
  const committedSelf = panels[panelId]
  const effectiveDocked = committedSelf?.docked ?? docked
  const effectiveDockSide = committedSelf?.dockSide ?? dockSide
  const sideDockCount = Math.max(
    1,
    Object.entries(panels).filter(([id, panel]) => {
      const peerDocked = id === panelId ? effectiveDocked : !!panel?.docked
      const peerSide = id === panelId ? effectiveDockSide : (panel?.dockSide ?? 'left')
      return peerDocked && peerSide === effectiveDockSide
    }).length,
  )
  const dockedHeight = computeDockMetrics(viewportSize().vh, sideDockCount).height
  const dockHeaderHeight = docked ? (isCoarsePointer ? 36 : 34) : (isCoarsePointer ? 46 : 44)
  const dockActionHeight = docked ? (isCoarsePointer ? 36 : 34) : (isCoarsePointer ? 48 : 44)

  const onDockPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!docked) return
    dockGesture.current = { active: true, x: e.clientX, y: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onDockPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!docked || !dockGesture.current.active) return
    const dx = e.clientX - dockGesture.current.x
    const dy = e.clientY - dockGesture.current.y
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) dockGesture.current.moved = true
    const shouldUndock =
      dockSide === 'left'
        ? dx >= dockUndockSwipe && Math.abs(dy) < (isIOSWebKit ? 38 : 28)
        : dx <= -dockUndockSwipe && Math.abs(dy) < (isIOSWebKit ? 38 : 28)
    if (shouldUndock) {
      dockGesture.current.active = false
      // Pull-out interaction: undock and continue into move mode.
      const s = sizeRef.current
      const baseX =
        dockSide === 'right'
          ? Math.max(0, viewportSize().vw - s.w - DOCK_EDGE_INSET_PX)
          : DOCK_EDGE_INSET_PX
      const baseY = posRef.current.y
      const { vw, vh } = viewportSize()
      const ph = minimized ? (isCoarsePointer ? 46 : 44) : s.h ?? minHeight
      const nx = Math.max(0, Math.min(baseX + dx, vw - s.w))
      const ny = Math.max(36, Math.min(baseY + dy, vh - ph))
      const next = { x: nx, y: ny }
      posRef.current = next
      setPos(next)
      setDockedGuarded(false, 'controller')
      setMinimized(false)
      setDockPreview(null)
      undockedAt.current = { x: next.x, y: next.y }
      safeUpdatePanel(panelId, { docked: false, minimized: false, x: next.x, y: next.y, dockSide })
      raisePanel(panelId)
      setGlow(true)
      drag.current = { dx: e.clientX - next.x, dy: e.clientY - next.y }
      dragStartScreen.current = { x: e.clientX, y: e.clientY }
      setDragMode('move')
    }
  }

  const onDockPointerUp = () => {
    if (!docked || dragMode === 'move') return
    const g = dockGesture.current
    dockGesture.current.active = false
    if (!g.moved) toggleDocked()
  }

  const shell = (
    <div
      ref={rootRef}
      data-panel-id={panelId}
      className={resizeBump ? 'cockpit-panel cockpit-panel-bump' : 'cockpit-panel'}
      style={{
        position: isMobile && isMaximized ? 'fixed' : 'absolute',
        left: isMobile && isMaximized ? 10 : pos.x,
        top: isMobile && isMaximized ? 10 : pos.y,
        right: isMobile && isMaximized ? 10 : undefined,
        bottom: isMobile && isMaximized ? 10 : undefined,
        width: isMobile && isMaximized ? 'auto' : size.w,
        height: isMobile && isMaximized
          ? 'auto'
          : docked
          ? dockedHeight
          : minimized
            ? (isCoarsePointer ? 46 : 44)
            : size.h ?? undefined,
        boxSizing: 'border-box',
        minHeight: docked
          ? dockedHeight
          : minimized
            ? (isCoarsePointer ? 46 : 44)
            : minHeight,
        maxHeight: isMobile && isMaximized
          ? 'none'
          : docked
          ? dockedHeight
          : minimized
            ? (isCoarsePointer ? 46 : 44)
            : isMobile
              ? '60vh'
              : undefined,
        zIndex: isMobile && isMaximized ? 9999 : (layout?.z ?? 400) + mobileFocusBoost,
        pointerEvents: 'auto',
        background: panelBg,
        color: panelTextColor,
        ['--cockpit-panel-subtle' as any]: panelSubtleText,
        border: `1.5px solid ${panelBorderColor}`,
        borderRadius: isCoarsePointer ? 10 : 8,
        boxShadow: glow
          ? `0 0 0 2px ${panelEdgeGlow}, 0 0 44px ${panelHaloGlow}, 0 8px 28px rgba(0,0,0,0.5)`
          : `0 6px 20px rgba(0,0,0,0.5), 0 0 0 ${isMobile && mobileFocusBoost > 0 ? '2px' : '1.5px'} ${panelEdgeGlow}, 0 0 32px ${panelHaloGlow}`,
        outline:
          dragMode !== 'none' && dockPreview
            ? `2px dashed ${accent}99`
            : undefined,
        outlineOffset:
          dragMode !== 'none' && dockPreview
            ? -2
            : undefined,
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        transition,
        touchAction: dragMode !== 'none' ? 'none' : undefined,
        transform: docked
          ? dockSide === 'left'
            ? `translateX(calc(-100% + ${dockReveal}px))`
            : `translateX(calc(100% - ${dockReveal}px))`
          : undefined,
        willChange: dragMode !== 'none' || docked ? 'transform, left, top' : undefined,
      }}
      onMouseEnter={() => {
        if (!docked) return
        setGlow(true)
      }}
      onMouseLeave={() => {
        if (!docked) return
        setGlow(false)
      }}
    >
      <div
        role="banner"
        onPointerDown={onHeaderPointerDown}
        onDoubleClick={onHeaderDoubleClick}
        onClick={(e) => {
          if (e.detail === 3) {
            e.preventDefault()
            setFullscreen(true)
          }
        }}
        style={{
          cursor: docked ? 'pointer' : 'grab',
          padding: isCoarsePointer ? '11px 12px' : '10px 12px',
          minHeight: dockHeaderHeight,
          borderBottom: minimized ? 'none' : `1px solid ${accent}33`,
          fontFamily: 'var(--font-ui, system-ui)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: accent,
          textShadow: panelTextShadow,
          textTransform: 'uppercase',
          userSelect: 'none',
          touchAction: isCoarsePointer ? 'none' : 'manipulation',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {docked ? (
          <div
            aria-hidden={dockedHeaderTrailing ? undefined : true}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              /*
               * Peek is ~60–104px: only one edge of this row is on-screen.
               * Left-docked → panel’s RIGHT edge shows → put primary action last (rightmost).
               * Right-docked → panel’s LEFT edge shows → put primary action first (leftmost).
               */
              justifyContent: dockSide === 'left' ? 'flex-end' : 'flex-start',
              gap: 6,
              paddingInline: 6,
              textShadow: `0 0 8px ${accent}33`,
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                pointerEvents: 'auto',
                flexShrink: 0,
              }}
            >
              {dockSide === 'right' ? dockedHeaderTrailing ?? null : null}
              <span style={{ fontSize: 12, opacity: 0.95 }}>{badge.icon}</span>
              <span style={{ fontSize: 10, letterSpacing: '0.14em' }}>{badge.abbr}</span>
              <span style={{ opacity: 0.6, fontSize: 9 }}>
                {dockSide === 'left' ? '⇢' : '⇠'}
              </span>
              {dockSide === 'left' ? dockedHeaderTrailing ?? null : null}
            </span>
          </div>
        ) : (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span>{title}</span>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {dockedHeaderTrailing ? (
                <span style={{ pointerEvents: 'auto', flexShrink: 0 }}>{dockedHeaderTrailing}</span>
              ) : null}
              {isMobile ? (
                <button
                  type="button"
                  data-no-drag
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsMaximized((prev) => !prev)
                  }}
                  aria-label={isMaximized ? `Restore ${title}` : `Maximize ${title}`}
                  title={isMaximized ? 'Restore panel' : 'Maximize panel'}
                  style={{
                    background: `${accent}14`,
                    border: `1px solid ${accent}77`,
                    color: accent,
                    cursor: 'pointer',
                    borderRadius: 4,
                    minHeight: isCoarsePointer ? 44 : 32,
                    minWidth: isCoarsePointer ? 44 : 32,
                    lineHeight: 1,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textShadow: `0 0 8px ${accent}55`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 8px',
                  }}
                >
                  {isMaximized ? 'Restore' : 'Max'}
                </button>
              ) : null}
              <button
                type="button"
                data-no-drag
                onClick={(e) => {
                  e.stopPropagation()
                  minimizeToDock()
                }}
                aria-label={`Minimize ${title} to dock`}
                title="Minimize to dock"
                style={{
                  background: `${accent}14`,
                  border: `1px solid ${accent}77`,
                  color: accent,
                  cursor: 'pointer',
                  borderRadius: 4,
                  minHeight: isCoarsePointer ? 44 : 32,
                  minWidth: isCoarsePointer ? 44 : 32,
                  lineHeight: 1,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textShadow: `0 0 8px ${accent}55`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                ▬
              </button>
              <span style={{ opacity: 0.65, fontSize: 8, color: panelSubtleText }}>⋮⋮</span>
            </div>
          </>
        )}
      </div>
      {!minimized && !docked && (
        <div
          className="panel-body"
          style={{
            padding: isMobile ? 8 : 10,
            fontSize: isMobile ? '0.95em' : undefined,
            flex: '1 1 auto',
            minHeight: 0,
            maxHeight: '100%',
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
          }}
        >
          {children}
        </div>
      )}
      {docked && (
        <button
          type="button"
          aria-label={`Undock ${title}`}
          title={dockSide === 'left' ? 'Tap/click or swipe right to undock' : 'Tap/click or swipe left to undock'}
          onPointerDown={onDockPointerDown}
          onPointerMove={onDockPointerMove}
          onPointerUp={onDockPointerUp}
          onPointerCancel={() => {
            dockGesture.current.active = false
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggleDocked()
            }
          }}
          style={{
            height: dockActionHeight,
            width: '100%',
            borderTop: `1px solid ${accent}33`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: dockSide === 'left' ? 'flex-end' : 'flex-start',
            gap: 6,
            color: accent,
            textShadow: panelTextShadow,
            fontFamily: 'var(--font-ui, system-ui)',
            letterSpacing: '0.12em',
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            background: 'transparent',
            cursor: 'pointer',
            paddingInline: 10,
            backgroundImage: `linear-gradient(90deg, transparent, ${accent}12, transparent)`,
            touchAction: 'none',
          }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              border: `1px solid ${accent}66`,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              lineHeight: 1,
            }}
          >
            {badge.icon}
          </span>
          <span>{badge.abbr}</span>
        </button>
      )}
      {!minimized && !docked && (
        <div
          role="separator"
          aria-label="Resize panel"
          onPointerDown={onResizePointerDown}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: isMobile ? 64 : isCoarsePointer ? 56 : 46,
            height: isMobile ? 64 : isCoarsePointer ? 56 : 46,
            cursor: 'nwse-resize',
            touchAction: 'none',
            background: `linear-gradient(135deg, transparent 52%, ${accent}38 52%)`,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            padding: 6,
            color: `${accent}cc`,
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.04em',
          }}
        >
          ↘
        </div>
      )}
    </div>
  )

  return (
    <>
      {shell}
      {dragMode !== 'none' && snapGuide.x !== null && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            top: 0,
            bottom: 0,
            left: snapGuide.x,
            width: 1,
            background: `${accent}88`,
            boxShadow: `0 0 8px ${accent}66`,
            pointerEvents: 'none',
            zIndex: 100001,
          }}
        />
      )}
      {dragMode !== 'none' && snapGuide.y !== null && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            top: snapGuide.y,
            height: 1,
            background: `${accent}88`,
            boxShadow: `0 0 8px ${accent}66`,
            pointerEvents: 'none',
            zIndex: 100001,
          }}
        />
      )}
      {fullscreen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal
            aria-label={title}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 100000,
              background: 'rgba(0,0,0,0.65)',
              backdropFilter: reducedTransparency ? 'none' : 'blur(6px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
            onClick={() => setFullscreen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 'min(720px, 100%)',
                maxHeight: '85vh',
                overflow: 'auto',
                background: panelBg,
                border: `1px solid ${accent}55`,
                borderRadius: 12,
                boxShadow: `0 24px 80px rgba(0,0,0,0.6)`,
                backdropFilter: 'none',
                WebkitBackdropFilter: 'none',
              }}
            >
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: `1px solid ${accent}33`,
                  color: accent,
                  fontSize: 11,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <span>{title}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {dockedHeaderTrailing ? (
                    <span style={{ pointerEvents: 'auto', flexShrink: 0 }}>{dockedHeaderTrailing}</span>
                  ) : null}
                  <button
                    type="button"
                    data-no-drag
                    onClick={() => setFullscreen(false)}
                    style={{
                      background: 'transparent',
                      border: `1px solid ${accent}55`,
                      color: accent,
                      cursor: 'pointer',
                      padding: '6px 12px',
                      borderRadius: 4,
                      minHeight: 40,
                      minWidth: 40,
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div style={{ padding: 16 }}>{children}</div>
            </div>
          </div>,
          document.body,
        )}
      <style>{`
        @keyframes cockpit-bump {
          0%, 100% { transform: translate(0,0); }
          50% { transform: translate(-2px, -2px); }
        }
        .cockpit-panel-bump { animation: cockpit-bump 0.18s ${EASE}; }
        @media (prefers-reduced-motion: reduce) {
          .cockpit-panel-bump { animation: none; }
        }
      `}</style>
    </>
  )
}
