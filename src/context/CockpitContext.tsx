import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  CockpitPanelRect,
  CockpitPrefs,
  HudColorTheme,
  ScreenHueMode,
} from '../types/cockpit'
import {
  COCKPIT_STORAGE_KEY,
  DURATION_MS,
  EASE,
  SNAP_PX,
} from '../types/cockpit'
import { cockpitViewport } from '../lib/viewport'
import { clampMobileToReachableViewport, sanitizeMobilePanelRect } from '../lib/mobilePanelHelpers'
import { emitPanelCommit } from '../diag/devEvents'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { enforcePolicyAttempt, getCurrentPolicyMode, reportPolicyAttempt } from '../runtime/devicePolicy'
import {
  markLastKnownGoodSnapshotTime,
  updateGestureActive,
  updatePersistenceHealth,
} from '../runtime/runtimeSnapshot'

declare global {
  // TEMP render-phase detector
  // eslint-disable-next-line no-var
  var __COCKPIT_RENDER_IN_PROGRESS__: boolean | undefined
}

const PREFS_DEFAULT: CockpitPrefs = {
  /** 8 + intensity*20 ≈ 16px blur at 0.4 — COCKPIT_UX v2 */
  glass_intensity: 0.4,
  hud_color: 'white',
  panel_opacity: 0.45,
  panel_gap_px: 0,
  animations_enabled: true,
  layout_version: 'nightforce_v3',
  screen_hue: 'bright_day',
  low_hud_brightness: 0.96,
  low_map_brightness: 0.2,
  bright_hud_brightness: 1.32,
  bright_map_brightness: 1.18,
  red_hue_rotate: -62,
  red_saturation: 0.52,
  red_brightness: 0.68,
}

type PanelMap = Record<string, CockpitPanelRect>

interface StoredState {
  v: number
  panels: PanelMap
  prefs: CockpitPrefs
}

const LAYOUT_VERSION = 2
type DevicePreset = 'iphone' | 'android' | 'tablet' | 'desktop'
const DEVICE_TUNE_VERSION = 'device_tune_v2'
const DOCK_EDGE_INSET_PX = 8
const DOCKED_PANEL_STACK_PX = 0
const DOCKED_PANEL_MIN_HEIGHT_PX = 76
const DOCKED_PANEL_MAX_HEIGHT_PX = 92
const DOCKED_PANEL_WIDTH_PX = 280
const DOCK_TOP_OFFSET_PX = 48
const DOCK_BOTTOM_GUTTER_PX = 12

function snap(n: number): number {
  return Math.round(n / SNAP_PX) * SNAP_PX
}

function nearlyEqual(a: number | null | undefined, b: number | null | undefined, epsilon = 0.5): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return Math.abs(a - b) <= epsilon
}

function themeToAccent(theme: HudColorTheme): string {
  switch (theme) {
    case 'amber':
      return '#b69b6e'
    case 'green':
      return '#8ea989'
    case 'white':
      return '#c7cec6'
    default:
      return '#9aa8a6'
  }
}

/**
 * MOBILE / DESKTOP LAYOUT STATE SEPARATION.
 *
 * Per the field-deployment model, mobile and desktop interaction modes maintain
 * independent persisted layouts. They share command registry and preferences
 * data shape, but never share storage keys.
 *
 *   desktop interaction mode → COCKPIT_STORAGE_KEY                       (legacy/unchanged)
 *   mobile  interaction mode → COCKPIT_STORAGE_KEY + '_mobile'           (new)
 *
 * `interactionMode` is read from the unified `getDeviceProfile()` so this
 * routing matches the runtime controller selection in CockpitHudPanel.
 *
 * One-time migration: if a mobile session boots with no mobile-scoped key
 * AND the legacy key has data, we copy the legacy snapshot once. After that
 * the two scopes are completely independent and never overwrite each other.
 */

const MOBILE_LAYOUT_SUFFIX = '_mobile'
const DEVICE_TUNE_SUFFIX = '_device_tune'
const SCENE_BACKUP_SUFFIX = '_scene_backup'
const MOBILE_MIGRATION_FLAG_KEY = `${COCKPIT_STORAGE_KEY}_mobile_migration_v1`

function getLayoutScope(): 'mobile' | 'desktop' {
  if (typeof window === 'undefined') return 'desktop'
  return getDeviceProfile().interactionMode === 'mobile' ? 'mobile' : 'desktop'
}

function getLayoutStorageKey(scope: 'mobile' | 'desktop' = getLayoutScope()): string {
  return scope === 'mobile' ? `${COCKPIT_STORAGE_KEY}${MOBILE_LAYOUT_SUFFIX}` : COCKPIT_STORAGE_KEY
}

function getDeviceTuneStorageKey(scope: 'mobile' | 'desktop' = getLayoutScope()): string {
  return scope === 'mobile'
    ? `${COCKPIT_STORAGE_KEY}${DEVICE_TUNE_SUFFIX}${MOBILE_LAYOUT_SUFFIX}`
    : `${COCKPIT_STORAGE_KEY}${DEVICE_TUNE_SUFFIX}`
}

function getSceneBackupStorageKey(scope: 'mobile' | 'desktop' = getLayoutScope()): string {
  return scope === 'mobile'
    ? `${COCKPIT_STORAGE_KEY}${SCENE_BACKUP_SUFFIX}${MOBILE_LAYOUT_SUFFIX}`
    : `${COCKPIT_STORAGE_KEY}${SCENE_BACKUP_SUFFIX}`
}

function loadState(): StoredState | null {
  try {
    const scope = getLayoutScope()
    const key = getLayoutStorageKey(scope)
    let raw = localStorage.getItem(key)

    // One-time migration: existing mobile users had data under the legacy key
    // before this scope-split. On first mobile boot after upgrade, copy the
    // legacy snapshot into the mobile-scoped key so they don't see "first launch"
    // docked behavior unexpectedly. Guarded by a flag so a deliberate mobile
    // reset (which clears the mobile key) does not auto-restore from desktop.
    if (!raw && scope === 'mobile') {
      const migrated = localStorage.getItem(MOBILE_MIGRATION_FLAG_KEY)
      if (!migrated) {
        try {
          const legacyRaw = localStorage.getItem(COCKPIT_STORAGE_KEY)
          if (legacyRaw) {
            localStorage.setItem(key, legacyRaw)
            raw = legacyRaw
          }
        } catch {
          /* ignore */
        }
        try {
          localStorage.setItem(MOBILE_MIGRATION_FLAG_KEY, '1')
        } catch {
          /* ignore */
        }
      }
    }

    if (!raw) return null
    const o = JSON.parse(raw) as Partial<StoredState> | null
    if (!o || o.v !== LAYOUT_VERSION) return null
    let panels = o.panels && typeof o.panels === 'object' ? (o.panels as PanelMap) : {}
    if (scope === 'mobile') {
      const { vw, vh } = cockpitViewport()
      const sanitized: PanelMap = {}
      const changes: Array<{ id: string; reason: string | null }> = []
      for (const [id, panel] of Object.entries(panels)) {
        if (!panel) continue
        const out = sanitizeMobilePanelRect(panel, { vw, vh })
        sanitized[id] = out.panel
        if (out.changed) changes.push({ id, reason: out.reason })
      }
      panels = sanitized
      if (import.meta.env.DEV && changes.length > 0) {
        console.info('[HUD DEV] mobile-persistence-sanitize', { count: changes.length, changes })
      }
    }
    const prefs =
      o.prefs && typeof o.prefs === 'object'
        ? ({ ...PREFS_DEFAULT, ...(o.prefs as Partial<CockpitPrefs>) } as CockpitPrefs)
        : PREFS_DEFAULT
    updatePersistenceHealth('healthy')
    return { v: LAYOUT_VERSION, panels, prefs }
  } catch {
    // Crash-safe recovery path: try last-known-good snapshot.
    try {
      const scope = getLayoutScope()
      const lkgKey = `${getLayoutStorageKey(scope)}_lkg`
      const rawLkg = localStorage.getItem(lkgKey)
      if (!rawLkg) {
        updatePersistenceHealth('error')
        return null
      }
      const o = JSON.parse(rawLkg) as Partial<StoredState> | null
      if (!o || o.v !== LAYOUT_VERSION) {
        updatePersistenceHealth('error')
        return null
      }
      let panels = o.panels && typeof o.panels === 'object' ? (o.panels as PanelMap) : {}
      if (scope === 'mobile') {
        const { vw, vh } = cockpitViewport()
        const sanitized: PanelMap = {}
        const changes: Array<{ id: string; reason: string | null }> = []
        for (const [id, panel] of Object.entries(panels)) {
          if (!panel) continue
          const out = sanitizeMobilePanelRect(panel, { vw, vh })
          sanitized[id] = out.panel
          if (out.changed) changes.push({ id, reason: out.reason })
        }
        panels = sanitized
        if (import.meta.env.DEV && changes.length > 0) {
          console.info('[HUD DEV] mobile-persistence-sanitize-lkg', { count: changes.length, changes })
        }
      }
      const prefs =
        o.prefs && typeof o.prefs === 'object'
          ? ({ ...PREFS_DEFAULT, ...(o.prefs as Partial<CockpitPrefs>) } as CockpitPrefs)
          : PREFS_DEFAULT
      updatePersistenceHealth('corrupt_recovered')
      markLastKnownGoodSnapshotTime()
      return { v: LAYOUT_VERSION, panels, prefs }
    } catch {
      updatePersistenceHealth('error')
    }
    return null
  }
}

function detectDevicePreset(): DevicePreset {
  const profile = getDeviceProfile()
  if (profile.type === 'tablet') return 'tablet'
  if (profile.isIOS && profile.type === 'mobile') return 'iphone'
  if (profile.isAndroid && profile.type === 'mobile') return 'android'
  return 'desktop'
}

function firstRunPreset(device: DevicePreset): {
  prefs: Partial<CockpitPrefs>
  panelPatches: Record<string, CockpitPanelRect>
} {
  if (device === 'iphone') {
    return {
      prefs: {
        screen_hue: 'bright_day',
        glass_intensity: 0.34,
        panel_opacity: 0.48,
        low_hud_brightness: 0.92,
        low_map_brightness: 0.16,
      },
      panelPatches: {
        layers: { x: 8, y: 48, w: 176, h: null, z: 430, minimized: false, docked: true, dockSide: 'left' },
        waypoints: { x: 8, y: 148, w: 300, h: null, z: 431, minimized: false, docked: true, dockSide: 'left' },
        location: { x: 8, y: 248, w: 300, h: null, z: 432, minimized: false, docked: true, dockSide: 'right' },
        voice: { x: 8, y: 348, w: 320, h: null, z: 433, minimized: false, docked: true, dockSide: 'right' },
        sos: { x: 8, y: 448, w: 264, h: null, z: 434, minimized: false, docked: true, dockSide: 'right' },
        weather: { x: 8, y: 548, w: 300, h: null, z: 435, minimized: false, docked: true, dockSide: 'right' },
        display: { x: 8, y: 648, w: 260, h: null, z: 436, minimized: false, docked: true, dockSide: 'left' },
      },
    }
  }
  if (device === 'android') {
    return {
      prefs: {
        screen_hue: 'bright_day',
        glass_intensity: 0.42,
        panel_opacity: 0.52,
        low_hud_brightness: 0.96,
        low_map_brightness: 0.14,
      },
      panelPatches: {
        layers: { x: 8, y: 48, w: 176, h: null, z: 430, minimized: false, docked: true, dockSide: 'left' },
        waypoints: { x: 8, y: 148, w: 300, h: null, z: 431, minimized: false, docked: true, dockSide: 'left' },
        location: { x: 8, y: 248, w: 300, h: null, z: 432, minimized: false, docked: true, dockSide: 'right' },
        voice: { x: 8, y: 348, w: 320, h: null, z: 433, minimized: false, docked: true, dockSide: 'right' },
        sos: { x: 8, y: 448, w: 264, h: null, z: 434, minimized: false, docked: true, dockSide: 'right' },
        weather: { x: 8, y: 548, w: 300, h: null, z: 435, minimized: false, docked: true, dockSide: 'right' },
        display: { x: 8, y: 648, w: 260, h: null, z: 436, minimized: false, docked: true, dockSide: 'left' },
      },
    }
  }
  if (device === 'tablet') {
    return {
      prefs: {
        screen_hue: 'bright_day',
        glass_intensity: 0.5,
        panel_opacity: 0.5,
        low_hud_brightness: 0.9,
        low_map_brightness: 0.16,
      },
      panelPatches: {
        layers: { x: 8, y: 48, w: 176, h: null, z: 430, minimized: false, docked: true, dockSide: 'left' },
        waypoints: { x: 8, y: 148, w: 300, h: null, z: 431, minimized: false, docked: true, dockSide: 'left' },
        location: { x: 8, y: 248, w: 300, h: null, z: 432, minimized: false, docked: true, dockSide: 'right' },
        voice: { x: 8, y: 348, w: 330, h: null, z: 433, minimized: false, docked: true, dockSide: 'right' },
        sos: { x: 8, y: 448, w: 280, h: null, z: 434, minimized: false, docked: true, dockSide: 'right' },
        weather: { x: 8, y: 548, w: 320, h: null, z: 435, minimized: false, docked: true, dockSide: 'right' },
        display: { x: 8, y: 648, w: 280, h: null, z: 436, minimized: false, docked: true, dockSide: 'left' },
      },
    }
  }
  return { prefs: {}, panelPatches: {} }
}

function deviceOptimizationPrefs(device: DevicePreset): Partial<CockpitPrefs> {
  if (device === 'iphone') {
    return {
      glass_intensity: 0.3,
      panel_opacity: 0.46,
      panel_gap_px: 0,
      animations_enabled: true,
      low_hud_brightness: 0.94,
      low_map_brightness: 0.16,
      bright_hud_brightness: 1.22,
      bright_map_brightness: 1.1,
      red_hue_rotate: -62,
      red_saturation: 0.52,
      red_brightness: 0.66,
    }
  }
  if (device === 'android') {
    return {
      glass_intensity: 0.36,
      panel_opacity: 0.5,
      panel_gap_px: 0,
      animations_enabled: true,
      low_hud_brightness: 0.96,
      low_map_brightness: 0.14,
      bright_hud_brightness: 1.24,
      bright_map_brightness: 1.12,
      red_hue_rotate: -62,
      red_saturation: 0.54,
      red_brightness: 0.68,
    }
  }
  if (device === 'tablet') {
    return {
      glass_intensity: 0.44,
      panel_opacity: 0.5,
      panel_gap_px: 0,
      animations_enabled: true,
      low_hud_brightness: 0.92,
      low_map_brightness: 0.16,
      bright_hud_brightness: 1.26,
      bright_map_brightness: 1.14,
      red_hue_rotate: -62,
      red_saturation: 0.52,
      red_brightness: 0.67,
    }
  }
  return {
    glass_intensity: 0.46,
    panel_opacity: 0.5,
    panel_gap_px: 0,
    animations_enabled: true,
    low_hud_brightness: 0.92,
    low_map_brightness: 0.15,
    bright_hud_brightness: 1.3,
    bright_map_brightness: 1.18,
    red_hue_rotate: -62,
    red_saturation: 0.52,
    red_brightness: 0.66,
  }
}

function saveState(panels: PanelMap, prefs: CockpitPrefs) {
  try {
    const scope = getLayoutScope()
    // DEPE: each write announces which scope it is targeting; the engine
    // compares against the mode policy. A mobile session writing to the
    // desktop key (or vice versa) triggers a `crossModePersistence` violation.
    const scopeEnableOk = enforcePolicyAttempt(
      scope === 'mobile' ? 'storage.scope.mobile' : 'storage.scope.desktop',
      'enable',
      'saveState',
    )
    enforcePolicyAttempt(
      scope === 'mobile' ? 'storage.scope.desktop' : 'storage.scope.mobile',
      'disable',
      'saveState',
    )

    const body: StoredState = { v: LAYOUT_VERSION, panels, prefs }
    const bodyJson = JSON.stringify(body)
    reportPolicyAttempt('persistence.transactionalWrite', 'enable', 'saveState.txn')
    if (scopeEnableOk) {
      const key = getLayoutStorageKey(scope)
      const tmpKey = `${key}_tmp`
      const lkgKey = `${key}_lkg`
      localStorage.setItem(tmpKey, bodyJson)
      const parsed = JSON.parse(localStorage.getItem(tmpKey) ?? 'null') as Partial<StoredState> | null
      if (parsed?.v !== LAYOUT_VERSION || !parsed?.panels || !parsed?.prefs) {
        updatePersistenceHealth('error')
        return
      }
      localStorage.setItem(key, bodyJson)
      localStorage.setItem(lkgKey, bodyJson)
      localStorage.removeItem(tmpKey)
      updatePersistenceHealth('healthy')
      markLastKnownGoodSnapshotTime()
      return
    }

    // Critical DEPE correction: if a scope violation is detected, force write
    // to the canonical scope for the current interaction mode.
    const correctedScope = getCurrentPolicyMode() === 'mobile' ? 'mobile' : 'desktop'
    localStorage.setItem(getLayoutStorageKey(correctedScope), bodyJson)
    updatePersistenceHealth('recovering')
    markLastKnownGoodSnapshotTime()
  } catch {
    updatePersistenceHealth('error')
    /* ignore */
  }
}

function panelHeightGuess(pid: string, p: CockpitPanelRect): number {
  const defaults: Record<string, number> = {
    layers: 230,
    waypoints: 92,
    deadman: 320,
    coords: 160,
    elevation: 150,
    clock: 120,
    display: 220,
    location: 240,
    voice: 360,
    weather: 180,
    presets: 220,
    sos: 300,
    preflight: 300,
  }
  const minBar = 46
  return Math.max(minBar, p.h ?? (p.minimized ? minBar : (defaults[pid] ?? 220)))
}

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

/** Minimum visible gap between floating panels (kiss / snap — never overlap). */
const PANEL_KISS_GAP_PX = 8

function panelGapPx(prefs?: Partial<CockpitPrefs>): number {
  const raw = prefs?.panel_gap_px ?? 0
  return Math.max(PANEL_KISS_GAP_PX, Math.max(0, Math.min(24, Math.round(raw))))
}

function normalizeNoOverlapLayout(panels: PanelMap, gapPx = 0): PanelMap {
  const next: PanelMap = Object.fromEntries(
    Object.entries(panels).map(([id, p]) => [id, { ...p }]),
  )
  const { vw, vh } = cockpitViewport()
  const pad = gapPx
  const topMinY = 36

  const dockedIds = Object.keys(next).filter((id) => next[id]?.docked)
  const dockObstacles: Array<{ l: number; t: number; r: number; b: number }> = []

  // Lay out each dock lane with user-selected side assignment,
  // and record them as obstacles for floating panels.
  for (const side of ['left', 'right'] as const) {
    const lane = dockedIds
      .filter((id) => (next[id].dockSide ?? 'left') === side)
      .sort((a, b) => (next[a].y === next[b].y ? a.localeCompare(b) : next[a].y - next[b].y))
    if (!lane.length) continue
    const { minY, maxY, step, height: dockRowH } = computeDockMetrics(vh, lane.length)
    const slotCount = Math.max(1, Math.floor((maxY - minY) / step) + 1)
    lane.forEach((id, idx) => {
      const slot = Math.min(slotCount - 1, idx)
      const p = next[id]
      p.w = DOCKED_PANEL_WIDTH_PX
      p.y = Math.max(minY, Math.min(minY + slot * step, maxY))
      p.x =
        side === 'right'
          ? Math.max(0, vw - p.w - DOCK_EDGE_INSET_PX)
          : DOCK_EDGE_INSET_PX
      p.dockSide = side
      p.docked = true
      dockObstacles.push({
        l: p.x,
        t: p.y,
        r: p.x + p.w,
        b: p.y + dockRowH,
      })
    })
  }

  const floating = Object.entries(next)
    .filter(([, p]) => !p.docked)
    .sort((a, b) => a[1].z - b[1].z)
  const placed: Array<{ l: number; t: number; r: number; b: number }> = [...dockObstacles]
  for (const [id, p] of floating) {
    const w = p.w
    const h = panelHeightGuess(id, p)
    let x = snap(Math.max(0, Math.min(p.x, vw - w)))
    let y = snap(Math.max(topMinY, Math.min(p.y, vh - h)))
    for (let iter = 0; iter < 28; iter++) {
      const a = { l: x, t: y, r: x + w, b: y + h }
      let hit = false
      for (const b of placed) {
        const overlap = !(a.r <= b.l + pad || a.l >= b.r - pad || a.b <= b.t + pad || a.t >= b.b - pad)
        if (!overlap) continue
        hit = true
        const overlapX = Math.min(a.r - b.l, b.r - a.l)
        const overlapY = Math.min(a.b - b.t, b.b - a.t)
        if (overlapX < overlapY) {
          const pushLeft = a.l + w / 2 < b.l + (b.r - b.l) / 2
          x = pushLeft ? b.l - w - pad : b.r + pad
        } else {
          const pushUp = a.t + h / 2 < b.t + (b.b - b.t) / 2
          y = pushUp ? b.t - h - pad : b.b + pad
        }
        // Preserve exact post-collision edge contact; avoid snap drift into overlaps.
        x = Math.max(0, Math.min(x, vw - w))
        y = Math.max(topMinY, Math.min(y, vh - h))
        a.l = x
        a.t = y
        a.r = x + w
        a.b = y + h
      }
      if (!hit) break
    }
    p.x = x
    p.y = y
    placed.push({ l: x, t: y, r: x + w, b: y + h })
  }

  return next
}

interface CockpitContextValue {
  devicePreset: DevicePreset
  panels: PanelMap
  prefs: CockpitPrefs
  accent: string
  /** Snap coordinate to cockpit grid */
  snapCoord: (n: number) => number
  updatePanel: (id: string, patch: Partial<CockpitPanelRect>) => void
  /** Bring panel to front (max z) */
  raisePanel: (id: string) => void
  /** Offset overlapping panels after drop (simple stack down) */
  resolveCollisions: (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => { x: number; y: number }
  resetLayout: () => void
  saveScene: () => void
  loadScene: () => void
  cycleGlass: () => void
  setHudColor: (t: HudColorTheme) => void
  setScreenHue: (m: ScreenHueMode) => void
  setDisplayTuning: (patch: Partial<CockpitPrefs>) => void
  exportLayoutFile: () => void
  importLayoutFile: () => void
  toggleHighContrast: () => void
  highContrast: boolean
  /** Apply CSS vars + classes to document root */
  reducedTransparency: boolean
  setReducedTransparency: (v: boolean) => void
  mapInteractionBlocked: boolean
  setMapInteractionBlocked: (v: boolean) => void
  applyDeviceOptimization: () => void
}

const CockpitContext = createContext<CockpitContextValue | null>(null)

const DEFAULT_PANELS = (): PanelMap => ({
  layers: { x: 16, y: 60, w: 160, h: null, z: 400, minimized: false, docked: true, dockSide: 'left' },
  waypoints: {
    x: 20,
    y: typeof window !== 'undefined' ? Math.max(80, window.innerHeight - 140) : 400,
    w: 340,
    h: null,
    z: 401,
    minimized: false,
    docked: true,
    dockSide: 'left',
  },
  deadman: {
    x: 16,
    y: typeof window !== 'undefined' ? window.innerHeight - 320 : 560,
    w: 240,
    h: null,
    z: 402,
    minimized: false,
    docked: true,
    dockSide: 'left',
  },
  coords: { x: 16, y: 280, w: 280, h: null, z: 403, minimized: false, docked: true, dockSide: 'left' },
  elevation: { x: 420, y: 60, w: 240, h: null, z: 404, minimized: false, docked: true, dockSide: 'left' },
  clock: { x: 760, y: 60, w: 260, h: null, z: 405, minimized: false, docked: true, dockSide: 'left' },
  display: { x: 1040, y: 60, w: 280, h: null, z: 406, minimized: false, docked: true, dockSide: 'left' },
  location: { x: 1220, y: 60, w: 300, h: null, z: 407, minimized: false, docked: true, dockSide: 'right' },
  voice: { x: 1220, y: 260, w: 340, h: null, z: 408, minimized: false, docked: true, dockSide: 'right' },
  weather: { x: 1220, y: 500, w: 300, h: null, z: 409, minimized: false, docked: true, dockSide: 'right' },
  presets: { x: 760, y: 200, w: 300, h: null, z: 410, minimized: false, docked: true, dockSide: 'left' },
  sos: { x: 1080, y: 420, w: 280, h: null, z: 411, minimized: false, docked: true, dockSide: 'right' },
  preflight: { x: 16, y: 180, w: 320, h: null, z: 412, minimized: false, docked: true, dockSide: 'left' },
})

export function CockpitProvider({ children }: { children: ReactNode }) {
  globalThis.__COCKPIT_RENDER_IN_PROGRESS__ = true
  const devicePreset = detectDevicePreset()
  const loaded = useRef(loadState())
  const seededPanelsRef = useRef<PanelMap>({
    ...DEFAULT_PANELS(),
    ...(loaded.current?.panels ?? {}),
  })
  const [panels, setPanels] = useState<PanelMap>(() =>
    normalizeNoOverlapLayout(
      seededPanelsRef.current,
      panelGapPx(loaded.current?.prefs ?? PREFS_DEFAULT),
    ),
  )
  const [prefs, setPrefs] = useState<CockpitPrefs>(() =>
    loaded.current?.prefs ? { ...PREFS_DEFAULT, ...loaded.current.prefs } : PREFS_DEFAULT,
  )
  const [highContrast, setHighContrast] = useState(false)
  const [reducedTransparency, setReducedTransparency] = useState(false)
  const [mapInteractionBlocked, setMapInteractionBlocked] = useState(false)
  const autoPresetAppliedRef = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-transparency: reduce)')
    if (!mq.media || mq.media === 'not all') return
    const apply = () => setReducedTransparency(mq.matches)
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [])
  const applyDeviceOptimization = useCallback(() => {
    const device = detectDevicePreset()
    const patch = deviceOptimizationPrefs(device)
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      saveState(panels, next)
      return next
    })
    try {
      localStorage.setItem(
        getDeviceTuneStorageKey(),
        JSON.stringify({ v: DEVICE_TUNE_VERSION, device, ts: Date.now() }),
      )
    } catch {
      /* ignore */
    }
  }, [panels])

  useEffect(() => {
    let alreadyApplied = false
    try {
      const raw = localStorage.getItem(getDeviceTuneStorageKey())
      if (raw) {
        const parsed = JSON.parse(raw) as { v?: string; device?: DevicePreset }
        alreadyApplied = parsed?.v === DEVICE_TUNE_VERSION && parsed?.device === devicePreset
      }
    } catch {
      /* ignore */
    }
    if (!alreadyApplied) {
      applyDeviceOptimization()
    }
  }, [applyDeviceOptimization, devicePreset])

  useEffect(() => {
    if (autoPresetAppliedRef.current) return
    autoPresetAppliedRef.current = true
    // Do not override existing user-customized layouts/prefs.
    if (loaded.current) return
    const device = detectDevicePreset()
    const preset = firstRunPreset(device)
    if (!Object.keys(preset.panelPatches).length && !Object.keys(preset.prefs).length) return
    // DEPE: first-launch auto-dock is required on mobile and allowed elsewhere.
    // Engine confirms the verdict; we don't gate on it (would break first run)
    // but a forbidden mode would surface a violation in the snapshot.
    reportPolicyAttempt('panel.autoDockOnFirstLaunch', 'enable', `device=${device}`)
    setPanels((prev) =>
      normalizeNoOverlapLayout(
        { ...prev, ...preset.panelPatches },
        panelGapPx({ ...prefs, ...preset.prefs }),
      ),
    )
    setPrefs((prev) => ({ ...prev, ...preset.prefs }))
  }, [])
  const nextZ = useRef(
    Math.max(
      400,
      ...Object.values(loaded.current?.panels ?? {}).map((p) => p.z),
      402,
    ) + 1,
  )

  const persist = useCallback((p: PanelMap, pr: CockpitPrefs) => {
    saveState(p, pr)
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => {
      persist(panels, prefs)
    }, 30000)
    return () => clearInterval(t)
  }, [panels, prefs, persist])

  useEffect(() => {
    updateGestureActive(mapInteractionBlocked)
  }, [mapInteractionBlocked])

  const accent = useMemo(() => {
    if (prefs.screen_hue === 'low_light') return '#7dff8a'
    if (prefs.screen_hue === 'red_tactical') return '#ff1744'
    return themeToAccent(prefs.hud_color)
  }, [prefs.hud_color, prefs.screen_hue])

  /** Root CSS variables + classes */
  useEffect(() => {
    const root = document.documentElement
    const profile = getDeviceProfile()
    const isiOS = profile.isIOS
    const isAndroid = profile.isAndroid
    // DEPE rule: any device whose interaction model is mobile (phones AND
    // tablets) gets the platform-mobile CSS class, ensuring touch-target
    // sizing and rounded panel cosmetics apply uniformly.
    const isMobileLike =
      profile.interactionMode === 'mobile' ||
      isAndroid ||
      isiOS ||
      profile.isCoarsePointer ||
      profile.width < 820
    const wantsReducedMotion = profile.prefersReducedMotion
    const anim =
      prefs.animations_enabled && !wantsReducedMotion ? `${DURATION_MS}ms` : '0ms'
    root.style.setProperty('--cockpit-glass-intensity', String(prefs.glass_intensity))
    root.style.setProperty('--cockpit-panel-opacity', String(prefs.panel_opacity))
    root.style.setProperty('--cockpit-accent', accent)
    root.style.setProperty('--cockpit-ease', EASE)
    root.style.setProperty('--cockpit-duration', anim)
    root.style.setProperty(
      '--cockpit-blur-max',
      reducedTransparency ? '4px' : `${8 + prefs.glass_intensity * 24}px`,
    )
    root.toggleAttribute('data-cockpit-anim', prefs.animations_enabled)
    root.classList.toggle('platform-ios', isiOS)
    root.classList.toggle('platform-android', isAndroid)
    root.classList.toggle('platform-mobile', isMobileLike)
    if (highContrast) root.classList.add('cockpit-high-contrast')
    else root.classList.remove('cockpit-high-contrast')
    if (reducedTransparency) root.classList.add('cockpit-reduced-transparency')
    else root.classList.remove('cockpit-reduced-transparency')
    return () => {
      root.classList.remove(
        'cockpit-high-contrast',
        'cockpit-reduced-transparency',
        'platform-ios',
        'platform-android',
        'platform-mobile',
      )
    }
  }, [accent, prefs, highContrast, reducedTransparency])

  const snapCoord = useCallback((n: number) => snap(n), [])

  const raisePanel = useCallback((id: string) => {
    // Mobile-only z-order promotion keeps active panel predictably topmost
    // during one-handed use while preserving desktop's static layering model.
    if (getDeviceProfile().interactionMode !== 'mobile') return
    setPanels((prev) => {
      const cur = prev[id]
      if (!cur) return prev
      const currentMax = Math.max(400, ...Object.values(prev).map((p) => p.z))
      if (cur.z >= currentMax) return prev
      const nextZValue = currentMax + 1
      nextZ.current = Math.max(nextZ.current, nextZValue + 1)
      if (import.meta.env.DEV && typeof window !== 'undefined') {
        const w = window as Window & {
          __HUD_Z_CHURN_DIAG__?: { count: number; startedAt: number; lastLogAt: number }
        }
        const now = Date.now()
        const diag = w.__HUD_Z_CHURN_DIAG__
        if (!diag || now - diag.startedAt > 3000) {
          w.__HUD_Z_CHURN_DIAG__ = { count: 1, startedAt: now, lastLogAt: diag?.lastLogAt ?? 0 }
        } else {
          diag.count += 1
          if (diag.count >= 10 && now - diag.lastLogAt > 3000) {
            diag.lastLogAt = now
            console.info('[HUD DEV] z-index-churn', { promotionsInWindow: diag.count, windowMs: now - diag.startedAt })
          }
        }
      }
      const next = { ...prev, [id]: { ...cur, z: nextZValue } }
      persist(next, prefs)
      return next
    })
  }, [persist, prefs])

  const updatePanel = useCallback(
    (id: string, patch: Partial<CockpitPanelRect>) => {
      if (
        import.meta.env.DEV &&
        globalThis.__COCKPIT_RENDER_IN_PROGRESS__ &&
        typeof window !== 'undefined' &&
        ((window as Window & { __HUD_LOOP_DEBUG__?: number }).__HUD_LOOP_DEBUG__ === 1 ||
          (window as Window & { HUD_LOOP_DEBUG?: number }).HUD_LOOP_DEBUG === 1)
      ) {
        console.warn('[GUARD] updatePanel call occurred before render phase flag cleared')
      }
      setPanels((prev) => {
        const cur =
          prev[id] ??
          DEFAULT_PANELS()[id] ??
          ({
            x: typeof patch.x === 'number' ? patch.x : 16,
            y: typeof patch.y === 'number' ? patch.y : 80,
            w: typeof patch.w === 'number' ? patch.w : 280,
            h: patch.h ?? null,
            z: nextZ.current++,
            minimized: typeof patch.minimized === 'boolean' ? patch.minimized : false,
            docked: patch.docked,
            dockSide: patch.dockSide,
          } as CockpitPanelRect)
        let nextPanel = { ...cur, ...patch }
        if (nextPanel.docked) {
          nextPanel.w = DOCKED_PANEL_WIDTH_PX
        }
        if (getDeviceProfile().interactionMode === 'mobile' && !nextPanel.docked) {
          const { vw, vh } = cockpitViewport()
          const estimatedH = panelHeightGuess(id, nextPanel)
          const clamped = clampMobileToReachableViewport(
            { x: nextPanel.x, y: nextPanel.y },
            { w: nextPanel.w, h: estimatedH },
            { vw, vh },
            36,
          )
          if (Math.abs(clamped.x - nextPanel.x) > 0.5 || Math.abs(clamped.y - nextPanel.y) > 0.5) {
            if (import.meta.env.DEV) {
              console.info('[HUD DEV] mobile-open-reachability-clamp', {
                panelId: id,
                source: 'updatePanel',
                from: { x: nextPanel.x, y: nextPanel.y },
                to: clamped,
              })
            }
            nextPanel = { ...nextPanel, x: clamped.x, y: clamped.y }
          }
        }
        const unchanged =
          nearlyEqual(cur.x, nextPanel.x) &&
          nearlyEqual(cur.y, nextPanel.y) &&
          nearlyEqual(cur.w, nextPanel.w) &&
          nearlyEqual(cur.h, nextPanel.h) &&
          cur.z === nextPanel.z &&
          cur.minimized === nextPanel.minimized &&
          (cur.docked ?? false) === (nextPanel.docked ?? false) &&
          (cur.dockSide ?? 'left') === (nextPanel.dockSide ?? 'left')
        if (unchanged) return prev
        emitPanelCommit({
          panelId: id,
          before: { w: cur.w ?? null, h: cur.h ?? null },
          after: { w: nextPanel.w ?? null, h: nextPanel.h ?? null },
          dw: (nextPanel.w ?? 0) - (cur.w ?? 0),
          dh: (nextPanel.h ?? 0) - (cur.h ?? 0),
          ts: Date.now(),
        })
        const merged = { ...prev, [id]: nextPanel }
        const next =
          getDeviceProfile().interactionMode === 'mobile'
            ? merged
            : normalizeNoOverlapLayout(merged, panelGapPx(prefs))
        persist(next, prefs)
        return next
      })
    },
    [persist, prefs],
  )

  /** Magnetic no-overlap resolution for floating panels */
  const resolveCollisions = useCallback(
    (id: string, x: number, y: number, width: number, height: number) => {
      x = snap(x)
      y = snap(y)
      const pad = panelGapPx(prefs)
      const selfH = Math.max(46, height || 200)
      const { vw, vh } = cockpitViewport()

      const panelHeight = (pid: string, p: CockpitPanelRect) => {
        const defaults: Record<string, number> = {
          layers: 230,
          waypoints: 92,
          deadman: 320,
          coords: 160,
          elevation: 150,
          clock: 120,
          display: 220,
          location: 240,
          voice: 360,
          weather: 180,
          presets: 220,
          sos: 300,
          preflight: 300,
        }
        if (p.docked) {
          const side = p.dockSide ?? 'left'
          const laneCount = Object.values(panels).filter(
            (q) => q?.docked && (q.dockSide ?? 'left') === side,
          ).length
          return computeDockMetrics(vh, laneCount).height
        }
        return Math.max(46, p.h ?? (p.minimized ? 46 : (defaults[pid] ?? 220)))
      }

      for (let iter = 0; iter < 24; iter++) {
        const a = { l: x, t: y, r: x + width, b: y + selfH }
        let hit = false
        for (const oid of Object.keys(panels)) {
          if (oid === id) continue
          const o = panels[oid]
          const ow = o.w
          const oh = panelHeight(oid, o)
          const b = { l: o.x, t: o.y, r: o.x + ow, b: o.y + oh }
          const overlap = !(a.r <= b.l + pad || a.l >= b.r - pad || a.b <= b.t + pad || a.t >= b.b - pad)
          if (!overlap) continue
          hit = true
          const overlapX = Math.min(a.r - b.l, b.r - a.l)
          const overlapY = Math.min(a.b - b.t, b.b - a.t)
          if (overlapX < overlapY) {
            const pushLeft = a.l + width / 2 < b.l + ow / 2
            x = pushLeft ? b.l - width - pad : b.r + pad
          } else {
            const pushUp = a.t + selfH / 2 < b.t + oh / 2
            y = pushUp ? b.t - selfH - pad : b.b + pad
          }
          // Preserve exact non-overlap after collision push.
          x = Math.max(0, Math.min(x, vw - width))
          y = Math.max(36, Math.min(y, vh - selfH))
          a.l = x
          a.t = y
          a.r = x + width
          a.b = y + selfH
        }
        if (!hit) break
      }
      return { x, y }
    },
    [panels],
  )

  const resetLayout = useCallback(() => {
    const fresh = normalizeNoOverlapLayout(DEFAULT_PANELS(), panelGapPx(prefs))
    setPanels(fresh)
    persist(fresh, prefs)
  }, [persist, prefs])

  const saveScene = useCallback(() => {
    persist(panels, prefs)
    try {
      localStorage.setItem(
        getSceneBackupStorageKey(),
        JSON.stringify({ v: 2, panels, prefs }),
      )
    } catch {
      /* ignore */
    }
  }, [panels, persist, prefs])

  const loadScene = useCallback(() => {
    try {
      const raw = localStorage.getItem(getSceneBackupStorageKey())
      if (!raw) return
      const o = JSON.parse(raw) as StoredState
      if (o?.panels) {
        setPanels(
          normalizeNoOverlapLayout(
            {
              ...DEFAULT_PANELS(),
              ...o.panels,
            },
            panelGapPx(o.prefs ?? prefs),
          ),
        )
      }
      if (o?.prefs) setPrefs({ ...PREFS_DEFAULT, ...o.prefs })
    } catch {
      /* ignore */
    }
  }, [])

  const cycleGlass = useCallback(() => {
    setPrefs((p) => {
      const steps = [0.3, 0.45, 0.65, 0.9]
      const i = steps.indexOf(p.glass_intensity)
      const ni = steps[(i + 1) % steps.length]
      const next = { ...p, glass_intensity: ni }
      persist(panels, next)
      return next
    })
  }, [panels, persist])

  const setHudColor = useCallback(
    (t: HudColorTheme) => {
      setPrefs((p) => {
        const next = { ...p, hud_color: t }
        persist(panels, next)
        return next
      })
    },
    [panels, persist],
  )

  const toggleHighContrast = useCallback(() => {
    setHighContrast((v) => !v)
  }, [])

  const setScreenHue = useCallback(
    (m: ScreenHueMode) => {
      setPrefs((p) => {
        const next = { ...p, screen_hue: m }
        persist(panels, next)
        return next
      })
    },
    [panels, persist],
  )

  const setDisplayTuning = useCallback(
    (patch: Partial<CockpitPrefs>) => {
      setPrefs((p) => {
        const changed = (Object.keys(patch) as Array<keyof CockpitPrefs>).some((key) => p[key] !== patch[key])
        if (!changed) return p
        const next = { ...p, ...patch }
        persist(panels, next)
        return next
      })
    },
    [panels, persist],
  )

  const exportLayoutFile = useCallback(() => {
    const body = JSON.stringify({ v: 2, panels, prefs }, null, 2)
    const blob = new Blob([body], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'cockpit-nightforce-layout.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2500)
  }, [panels, prefs])

  const importLayoutFile = useCallback(() => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = '.json,application/json'
    inp.onchange = () => {
      const f = inp.files?.[0]
      if (!f) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const o = JSON.parse(String(reader.result)) as Partial<StoredState>
          if (!o.panels && !o.prefs) return
          setPanels((prev) => {
            const np = normalizeNoOverlapLayout(
              {
                ...DEFAULT_PANELS(),
                ...(o.panels ?? prev),
              },
              panelGapPx(o.prefs ?? prefs),
            )
            setPrefs((pr) => {
              const npr = { ...PREFS_DEFAULT, ...pr, ...o.prefs } as CockpitPrefs
              saveState(np, npr)
              return npr
            })
            return np
          })
        } catch {
          /* ignore */
        }
      }
      reader.readAsText(f)
    }
    inp.click()
  }, [])

  useEffect(() => {
    globalThis.__COCKPIT_RENDER_IN_PROGRESS__ = false
  })

  useEffect(() => {
    document.documentElement.dataset.cockpitScreenHue = prefs.screen_hue
    document.documentElement.classList.toggle('mode-red', prefs.screen_hue === 'red_tactical')
    return () => {
      delete document.documentElement.dataset.cockpitScreenHue
      document.documentElement.classList.remove('mode-red')
    }
  }, [prefs.screen_hue])

  const value = useMemo<CockpitContextValue>(
    () => ({
      panels,
      devicePreset,
      prefs,
      accent,
      snapCoord,
      updatePanel,
      raisePanel,
      resolveCollisions,
      resetLayout,
      saveScene,
      loadScene,
      cycleGlass,
      setHudColor,
      setScreenHue,
      setDisplayTuning,
      exportLayoutFile,
      importLayoutFile,
      toggleHighContrast,
      highContrast,
      reducedTransparency,
      setReducedTransparency,
      mapInteractionBlocked,
      setMapInteractionBlocked,
      applyDeviceOptimization,
    }),
    [
      panels,
      devicePreset,
      prefs,
      accent,
      snapCoord,
      updatePanel,
      raisePanel,
      resolveCollisions,
      resetLayout,
      saveScene,
      loadScene,
      cycleGlass,
      setHudColor,
      setScreenHue,
      setDisplayTuning,
      exportLayoutFile,
      importLayoutFile,
      toggleHighContrast,
      highContrast,
      reducedTransparency,
      setReducedTransparency,
      mapInteractionBlocked,
      setMapInteractionBlocked,
      applyDeviceOptimization,
    ],
  )

  return (
    <CockpitContext.Provider value={value}>{children}</CockpitContext.Provider>
  )
}

export function useCockpit(): CockpitContextValue {
  const ctx = useContext(CockpitContext)
  if (!ctx) throw new Error('useCockpit must be used within CockpitProvider')
  return ctx
}
