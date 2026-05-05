import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCockpit } from '../context/CockpitContext'
import { DURATION_MS, EASE } from '../types/cockpit'

export type CockpitHudPanelProps = {
  panelId: string
  title: string
  initialPos: { x: number; y: number }
  initialWidth: number
  initialHeight?: number | null
  minWidth?: number
  minHeight?: number
  accent?: string
  children: React.ReactNode
}

const DRAG_THRESHOLD_PX = 5
const DOCK_EDGE_INSET_PX = 8
const DOCK_VISIBLE_STRIP_PX = 60
const DOCK_PEEK_STRIP_PX = 74
const DOCK_UNDOCK_SWIPE_PX = 18
const EDGE_DOCK_ZONE_PX = 22
const DOCKED_PANEL_STACK_PX = 8
const DOCKED_PANEL_HEIGHT_PX = 92
const PANEL_SNAP_THRESHOLD_PX = 10
const DOCK_RELOCK_GUARD_PX = 42

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

function viewportSize() {
  if (typeof window === 'undefined') return { vw: 1280, vh: 720 }
  const vv = window.visualViewport
  // iOS Safari address bar can change visible viewport without resizing layout viewport.
  const vw = Math.round(vv?.width ?? window.innerWidth)
  const vh = Math.round(vv?.height ?? window.innerHeight)
  return { vw, vh }
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
  children,
}: CockpitHudPanelProps) {
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
  } = cock

  const accent = accentProp ?? themeAccent
  const layout = panels[panelId]
  const badge = dockBadge(panelId, title)

  const [pos, setPos] = useState({
    x: layout?.x ?? initialPos.x,
    y: layout?.y ?? initialPos.y,
  })
  const [size, setSize] = useState({
    w: layout?.w ?? initialWidth,
    h: layout?.h ?? initialHeight,
  })
  const [minimized, setMinimized] = useState(layout?.minimized ?? false)
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

  const drag = useRef({ dx: 0, dy: 0 })
  const dockGesture = useRef({ active: false, x: 0, y: 0, moved: false })
  const dragStartScreen = useRef({ x: 0, y: 0 })
  const undockedAt = useRef<{ x: number; y: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const posRef = useRef(pos)
  const sizeRef = useRef(size)
  const seeded = useRef(false)

  posRef.current = pos
  sizeRef.current = size

  const wantsReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const isIOSWebKit =
    typeof window !== 'undefined' &&
    /iPhone|iPad|iPod/i.test(navigator.userAgent || '')
  const isCoarsePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  const dragThreshold = isIOSWebKit ? 14 : isCoarsePointer ? 10 : DRAG_THRESHOLD_PX
  const edgeDockZone = isIOSWebKit ? 44 : isCoarsePointer ? 34 : EDGE_DOCK_ZONE_PX
  const panelSnapThreshold = isIOSWebKit ? 14 : isCoarsePointer ? 10 : PANEL_SNAP_THRESHOLD_PX
  const dockRelockGuard = isIOSWebKit ? 72 : isCoarsePointer ? 64 : DOCK_RELOCK_GUARD_PX

  const avoidRuntimeOverlap = useCallback(
    (x: number, y: number, w: number, h: number) => {
      let nx = x
      let ny = y
      const pad = 12
      const { vw, vh } = viewportSize()
      const panelsOnScreen = Array.from(document.querySelectorAll<HTMLElement>('.cockpit-panel'))
      for (let iter = 0; iter < 10; iter++) {
        let collided = false
        const a = { l: nx, t: ny, r: nx + w, b: ny + h }
        for (const el of panelsOnScreen) {
          if (el.dataset.panelId === panelId) continue
          const r = el.getBoundingClientRect()
          const b = { l: r.left, t: r.top, r: r.right, b: r.bottom }
          const overlap = !(a.r <= b.l + pad || a.l >= b.r - pad || a.b <= b.t + pad || a.t >= b.b - pad)
          if (!overlap) continue
          const overlapX = Math.min(a.r - b.l, b.r - a.l)
          const overlapY = Math.min(a.b - b.t, b.b - a.t)
          if (overlapX < overlapY) {
            const pushLeft = a.l + w / 2 < b.l + (b.r - b.l) / 2
            nx = pushLeft ? b.l - w - pad : b.r + pad
          } else {
            const pushUp = a.t + h / 2 < b.t + (b.b - b.t) / 2
            ny = pushUp ? b.t - h - pad : b.b + pad
          }
          nx = Math.max(0, Math.min(nx, vw - w))
          ny = Math.max(36, Math.min(ny, vh - h))
          collided = true
          break
        }
        if (!collided) break
      }
      return { x: nx, y: ny }
    },
    [panelId],
  )

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    if (!layout) {
      updatePanel(panelId, {
        x: initialPos.x,
        y: initialPos.y,
        w: initialWidth,
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
    panelId,
    updatePanel,
  ])

  useEffect(() => {
    if (layout) {
      setPos({ x: layout.x, y: layout.y })
      setSize({ w: layout.w, h: layout.h })
      setMinimized(layout.minimized)
      setDocked(layout.docked ?? false)
      setDockSide(layout.dockSide ?? 'left')
    }
  }, [layout?.x, layout?.y, layout?.w, layout?.h, layout?.minimized, layout?.docked, layout?.dockSide])

  const transition =
    prefs.animations_enabled && !wantsReducedMotion
      ? `box-shadow ${DURATION_MS}ms ${EASE}, width ${DURATION_MS}ms ${EASE}, height ${DURATION_MS}ms ${EASE}, left ${DURATION_MS}ms ${EASE}, top ${DURATION_MS}ms ${EASE}, transform ${DURATION_MS}ms ${EASE}`
      : undefined

  const getDockedY = useCallback(
    (side: 'left' | 'right', desiredY: number) => {
      const minY = 36
      const { vh } = viewportSize()
      const maxY = vh - DOCKED_PANEL_HEIGHT_PX - 4
      const step = DOCKED_PANEL_HEIGHT_PX + DOCKED_PANEL_STACK_PX
      const slotCount = Math.max(1, Math.floor((maxY - minY) / step) + 1)

      // Magnetic lane stacking: assign each docked panel to a unique slot.
      // This keeps the dock rail clean and prevents overlap even after reloads.
      const lane = Object.entries(panels)
        .filter(([, panel]) => panel?.docked && (panel.dockSide ?? 'left') === side)
        .map(([id, panel]) => ({ id, y: panel.y }))

      if (!lane.some((p) => p.id === panelId)) {
        lane.push({ id: panelId, y: desiredY })
      }

      lane.sort((a, b) => (a.y === b.y ? a.id.localeCompare(b.id) : a.y - b.y))

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
      return Math.max(minY, Math.min(snapCoord(y), maxY))
    },
    [panelId, panels, snapCoord],
  )

  // Stability pass: if docked panels end up sharing a lane slot
  // (e.g. rapid dock toggles), normalize this panel to a free Y slot.
  useEffect(() => {
    if (!layout?.docked) return
    const targetY = getDockedY(layout.dockSide ?? 'left', layout.y)
    const side = layout.dockSide ?? 'left'
    const targetX =
      side === 'right'
        ? Math.max(0, viewportSize().vw - (layout.w ?? sizeRef.current.w) - DOCK_EDGE_INSET_PX)
        : DOCK_EDGE_INSET_PX
    if (Math.abs(targetY - layout.y) < 1 && Math.abs(targetX - layout.x) < 1) return
    setPos({ x: targetX, y: targetY })
    posRef.current = { x: targetX, y: targetY }
    updatePanel(panelId, { x: targetX, y: targetY, docked: true, dockSide: side })
  }, [layout?.docked, layout?.dockSide, layout?.y, getDockedY, panelId, updatePanel])

  useEffect(() => {
    if (!layout) return
    const { vw, vh } = viewportSize()
    const w = Math.min(layout.w ?? sizeRef.current.w, Math.max(140, vw - 8))
    const h = minimized ? (isCoarsePointer ? 46 : 44) : layout.h ?? sizeRef.current.h ?? minHeight

    if (layout.docked) {
      const side = layout.dockSide ?? 'left'
      const x =
        side === 'right'
          ? Math.max(0, vw - w - DOCK_EDGE_INSET_PX)
          : DOCK_EDGE_INSET_PX
      const y = getDockedY(side, layout.y)
      if (Math.abs(layout.x - x) > 1 || Math.abs(layout.y - y) > 1) {
        setPos({ x, y })
        posRef.current = { x, y }
        updatePanel(panelId, { x, y, docked: true, dockSide: side })
      }
      return
    }

    const x = Math.max(0, Math.min(layout.x, vw - w))
    const y = Math.max(36, Math.min(layout.y, vh - h))
    if (Math.abs(layout.x - x) > 1 || Math.abs(layout.y - y) > 1) {
      setPos({ x, y })
      posRef.current = { x, y }
      updatePanel(panelId, { x, y, docked: false })
    }
  }, [layout, panelId, updatePanel, minimized, isCoarsePointer, minHeight, getDockedY])

  const commitPosition = useCallback(() => {
    const el = rootRef.current
    const rect = el?.getBoundingClientRect()
    const s = sizeRef.current
    const p = posRef.current
    const height = s.h ?? Math.ceil(rect?.height ?? minHeight)
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
    const shouldDock = shouldDockLeft || shouldDockRight
    const nextDockSide: 'left' | 'right' = shouldDockRight ? 'right' : 'left'
    if (shouldDock) {
      const dockX =
        nextDockSide === 'right'
          ? Math.max(0, vw - s.w - DOCK_EDGE_INSET_PX)
          : DOCK_EDGE_INSET_PX
      const dockY = getDockedY(nextDockSide, sy)
      const next = { x: dockX, y: dockY }
      posRef.current = next
      setPos(next)
      setDocked(true)
      setDockSide(nextDockSide)
      setDockPreview(null)
      undockedAt.current = null
      updatePanel(panelId, {
        x: dockX,
        y: dockY,
        w: s.w,
        h: Math.max(minHeight, s.h ?? Math.ceil(rect?.height ?? minHeight)),
        minimized,
        docked: true,
        dockSide: nextDockSide,
      })
      return
    }

    const next = { x: sx, y: sy }
    posRef.current = next
    setPos(next)
    setDockPreview(null)
    setSnapGuide({ x: null, y: null })
    updatePanel(panelId, {
      x: sx,
      y: sy,
      w: s.w,
      h: Math.max(minHeight, s.h ?? Math.ceil(rect?.height ?? minHeight)),
      minimized,
      docked: false,
      dockSide,
    })
  }, [
    dockPreview,
    dockSide,
    docked,
    minimized,
    panels,
    panelId,
    resolveCollisions,
    snapCoord,
    updatePanel,
    minHeight,
    getDockedY,
    dockRelockGuard,
    edgeDockZone,
  ])

  useEffect(() => {
    if (dragMode === 'none') return

    const onMove = (e: PointerEvent) => {
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
        const ph = minimized ? 44 : Math.max(minHeight, s.h ?? Math.ceil(measuredH ?? minHeight))
        const minX = 0
        const maxX = vw - pw
        nx = Math.max(minX, Math.min(nx, maxX))
        ny = Math.max(36, Math.min(ny, vh - ph))
        let nextDockPreview: 'left' | 'right' | null = null
        if (nx <= edgeDockZone) nextDockPreview = 'left'
        else if (nx + pw >= vw - edgeDockZone) nextDockPreview = 'right'
        setDockPreview(nextDockPreview)

        let guideX: number | null = null
        let guideY: number | null = null
        if (!nextDockPreview) {
          let bestDx = panelSnapThreshold + 1
          let bestDy = panelSnapThreshold + 1
          for (const [id, panel] of Object.entries(panels)) {
            if (id === panelId) continue
            const dx = Math.abs(nx - panel.x)
            if (dx < bestDx && dx <= panelSnapThreshold) {
              bestDx = dx
              nx = panel.x
              guideX = panel.x
            }
            const dy = Math.abs(ny - panel.y)
            if (dy < bestDy && dy <= panelSnapThreshold) {
              bestDy = dy
              ny = panel.y
              guideY = panel.y
            }
          }
          const centerX = Math.round((vw - pw) / 2)
          const dxCenter = Math.abs(nx - centerX)
          if (dxCenter <= panelSnapThreshold && dxCenter < bestDx) {
            nx = centerX
            guideX = centerX + Math.round(pw / 2)
          }
          const resolved = resolveCollisions(panelId, nx, ny, pw, ph)
          nx = resolved.x
          ny = resolved.y
          const runtimeResolved = avoidRuntimeOverlap(nx, ny, pw, ph)
          nx = runtimeResolved.x
          ny = runtimeResolved.y
        }
        setSnapGuide({ x: guideX, y: guideY })
        const next = { x: nx, y: ny }
        posRef.current = next
        setPos(next)
      } else if (mode === 'resize') {
        const rect = rootRef.current?.getBoundingClientRect()
        if (!rect) return
        let nw = Math.max(minWidth, e.clientX - rect.left)
        let nh = Math.max(minHeight, e.clientY - rect.top)
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
        const next = { w: nw, h: nh }
        sizeRef.current = next
        setSize(next)
      }
    }

    const onUp = () => {
      if (dragMode === 'pending') {
        setDragMode('none')
        setGlow(false)
        setDockPreview(null)
        setSnapGuide({ x: null, y: null })
        return
      }
      setDragMode('none')
      setGlow(false)
      setSnapGuide({ x: null, y: null })
      commitPosition()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
  }, [commitPosition, dragMode, minimized, minHeight, minWidth, dragThreshold, edgeDockZone, panelSnapThreshold])

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return
    // Browser compatibility: some touch/pen implementations report non-zero button values.
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (docked) {
      const s = sizeRef.current
      const baseX =
        dockSide === 'right'
          ? Math.max(0, viewportSize().vw - s.w - DOCK_EDGE_INSET_PX)
          : DOCK_EDGE_INSET_PX
      const baseY = posRef.current.y
      setDocked(false)
      setDockPreview(null)
      undockedAt.current = { x: baseX, y: baseY }
      updatePanel(panelId, { docked: false, dockSide, x: baseX, y: baseY })
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
    setDragMode('pending')
    e.preventDefault()
  }

  const onHeaderDoubleClick = () => {
    setMinimized((m) => {
      const next = !m
      updatePanel(panelId, { minimized: next })
      return next
    })
  }

  const onResizePointerDown = (e: React.PointerEvent) => {
    if (docked) return
    e.stopPropagation()
    raisePanel(panelId)
    setGlow(true)
    setDragMode('resize')
    e.preventDefault()
  }

  const toggleDocked = () => {
    setDocked((prev) => {
      const next = !prev
      if (next) {
        const x =
          dockSide === 'right'
            ? Math.max(0, viewportSize().vw - sizeRef.current.w - DOCK_EDGE_INSET_PX)
            : DOCK_EDGE_INSET_PX
        const dockPos = { x, y: getDockedY(dockSide, posRef.current.y) }
        posRef.current = dockPos
        setPos(dockPos)
        undockedAt.current = null
        updatePanel(panelId, { docked: true, dockSide, x: dockPos.x, y: dockPos.y })
      } else {
        setDockPreview(null)
        undockedAt.current = { x: posRef.current.x, y: posRef.current.y }
        updatePanel(panelId, { docked: false })
      }
      return next
    })
  }

  const glassBlur = `blur(${8 + prefs.glass_intensity * 20}px) saturate(1.15)`
  const panelOpacity =
    prefs.screen_hue === 'low_light' ? Math.min(0.42, prefs.panel_opacity * 0.9) : prefs.panel_opacity * 0.96
  const panelBg =
    prefs.screen_hue === 'red_tactical'
      ? `rgba(28,10,12,${panelOpacity})`
      : `rgba(16,18,20,${panelOpacity})`
  const lowLightGlow = prefs.screen_hue === 'low_light' ? `0 0 10px ${accent}66` : undefined
  const isDeadmanPanel = panelId === 'deadman'
  const panelBorderColor =
    isDeadmanPanel
      ? 'rgba(255, 68, 102, 0.95)'
      : prefs.screen_hue === 'low_light'
        ? 'rgba(0, 255, 136, 0.9)'
        : 'rgba(0, 255, 136, 0.78)'
  const panelEdgeGlow = isDeadmanPanel
    ? 'rgba(255, 68, 102, 0.7)'
    : prefs.screen_hue === 'low_light'
      ? 'rgba(0, 255, 136, 0.6)'
      : 'rgba(0, 255, 136, 0.45)'
  const panelHaloGlow = isDeadmanPanel
    ? 'rgba(255, 68, 102, 0.48)'
    : prefs.screen_hue === 'low_light'
      ? 'rgba(0, 255, 136, 0.38)'
      : 'rgba(0, 255, 136, 0.3)'
  const panelTextColor =
    prefs.screen_hue === 'low_light'
      ? '#d5e2d8'
      : prefs.screen_hue === 'red_tactical'
        ? '#ff7088'
        : '#d2d8d2'
  const panelSubtleText =
    prefs.screen_hue === 'low_light'
      ? '#aab7ad'
      : prefs.screen_hue === 'red_tactical'
        ? '#d66179'
        : '#9ea7a0'
  const dockReveal = glow ? DOCK_PEEK_STRIP_PX : DOCK_VISIBLE_STRIP_PX
  const dockedHeight = DOCKED_PANEL_HEIGHT_PX

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
        ? dx >= DOCK_UNDOCK_SWIPE_PX && Math.abs(dy) < 28
        : dx <= -DOCK_UNDOCK_SWIPE_PX && Math.abs(dy) < 28
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
      const ph = minimized ? 44 : s.h ?? minHeight
      const nx = Math.max(0, Math.min(baseX + dx, vw - s.w))
      const ny = Math.max(36, Math.min(baseY + dy, vh - ph))
      const next = { x: nx, y: ny }
      posRef.current = next
      setPos(next)
      setDocked(false)
      setDockPreview(null)
      undockedAt.current = { x: next.x, y: next.y }
      updatePanel(panelId, { docked: false, x: next.x, y: next.y, dockSide })
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
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: docked
          ? dockedHeight
          : minimized
            ? (isCoarsePointer ? 46 : 44)
            : size.h ?? undefined,
        minHeight: docked
          ? dockedHeight
          : minimized
            ? (isCoarsePointer ? 46 : 44)
            : minHeight,
        maxHeight: docked
          ? dockedHeight
          : minimized
            ? (isCoarsePointer ? 46 : 44)
            : undefined,
        zIndex: layout?.z ?? 400,
        pointerEvents: 'auto',
        background: panelBg,
        color: panelTextColor,
        ['--cockpit-panel-subtle' as any]: panelSubtleText,
        border: `1.5px solid ${panelBorderColor}`,
        borderRadius: isCoarsePointer ? 10 : 8,
        boxShadow: glow
          ? `0 0 0 2px ${panelEdgeGlow}, 0 0 44px ${panelHaloGlow}, 0 8px 28px rgba(0,0,0,0.5)`
          : `0 6px 20px rgba(0,0,0,0.5), 0 0 0 1.5px ${panelEdgeGlow}, 0 0 32px ${panelHaloGlow}`,
        outline:
          dragMode !== 'none' && dockPreview
            ? `2px dashed ${accent}99`
            : undefined,
        outlineOffset:
          dragMode !== 'none' && dockPreview
            ? -2
            : undefined,
        backdropFilter: reducedTransparency ? 'none' : glassBlur,
        WebkitBackdropFilter: reducedTransparency ? 'none' : glassBlur,
        overflow: 'hidden',
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
          minHeight: isCoarsePointer ? 46 : 44,
          borderBottom: minimized ? 'none' : `1px solid ${accent}33`,
          fontFamily: 'var(--font-ui, system-ui)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: accent,
          textShadow: lowLightGlow,
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
            aria-hidden
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: dockSide === 'left' ? 'flex-end' : 'flex-start',
              gap: 6,
              paddingInline: 6,
              textShadow: `0 0 8px ${accent}33`,
            }}
          >
            <span style={{ fontSize: 12, opacity: 0.95 }}>{badge.icon}</span>
            <span style={{ fontSize: 10, letterSpacing: '0.14em' }}>{badge.abbr}</span>
            <span style={{ opacity: 0.6, fontSize: 9 }}>
              {dockSide === 'left' ? '⇢' : '⇠'}
            </span>
          </div>
        ) : (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span>{title}</span>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ opacity: 0.65, fontSize: 8, color: panelSubtleText }}>⋮⋮</span>
            </div>
          </>
        )}
      </div>
      {!minimized && !docked && (
        <div style={{ padding: 10, maxHeight: fullscreen ? '70vh' : undefined, overflow: 'auto' }}>
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
            height: isCoarsePointer ? 48 : 44,
            width: '100%',
            borderTop: `1px solid ${accent}33`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: dockSide === 'left' ? 'flex-end' : 'flex-start',
            gap: 6,
            color: accent,
            textShadow: lowLightGlow,
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
            width: isCoarsePointer ? 56 : 46,
            height: isCoarsePointer ? 56 : 46,
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
                backdropFilter: reducedTransparency ? 'none' : glassBlur,
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
                }}
              >
                {title}
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
