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

const PREFS_DEFAULT: CockpitPrefs = {
  /** 8 + intensity*20 ≈ 16px blur at 0.4 — COCKPIT_UX v2 */
  glass_intensity: 0.4,
  hud_color: 'white',
  panel_opacity: 0.45,
  animations_enabled: true,
  layout_version: 'nightforce_v2',
  screen_hue: 'low_light',
  low_hud_brightness: 0.9,
  low_map_brightness: 0.14,
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

type DevicePreset = 'iphone' | 'android' | 'tablet' | 'desktop'

function snap(n: number): number {
  return Math.round(n / SNAP_PX) * SNAP_PX
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

function loadState(): StoredState | null {
  try {
    const raw = localStorage.getItem(COCKPIT_STORAGE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as StoredState
    if (!o || o.v !== 1 || !o.panels || !o.prefs) return null
    return o
  } catch {
    return null
  }
}

function detectDevicePreset(): DevicePreset {
  const ua = navigator.userAgent || ''
  const isiOS = /iPhone|iPad|iPod/i.test(ua)
  const isAndroid = /Android/i.test(ua)
  const shortEdge = Math.min(window.innerWidth, window.innerHeight)
  const isTabletLike = shortEdge >= 700 && shortEdge <= 1100
  if (isiOS && !isTabletLike) return 'iphone'
  if (isAndroid && !isTabletLike) return 'android'
  if (isTabletLike) return 'tablet'
  return 'desktop'
}

function firstRunPreset(device: DevicePreset): {
  prefs: Partial<CockpitPrefs>
  panelPatches: Record<string, CockpitPanelRect>
} {
  if (device === 'iphone') {
    return {
      prefs: {
        screen_hue: 'low_light',
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
        screen_hue: 'low_light',
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
        voice: { x: 1180, y: 280, w: 330, h: null, z: 431, minimized: false, docked: false },
        sos: { x: 1180, y: 520, w: 260, h: null, z: 432, minimized: false, docked: false },
      },
    }
  }
  return { prefs: {}, panelPatches: {} }
}

function saveState(panels: PanelMap, prefs: CockpitPrefs) {
  try {
    const body: StoredState = { v: 1, panels, prefs }
    localStorage.setItem(COCKPIT_STORAGE_KEY, JSON.stringify(body))
  } catch {
    /* ignore */
  }
}

interface CockpitContextValue {
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
}

const CockpitContext = createContext<CockpitContextValue | null>(null)

const DEFAULT_PANELS = (): PanelMap => ({
  layers: {
    x: 16,
    y: 60,
    w: 160,
    h: null,
    z: 400,
    minimized: false,
  },
  waypoints: {
    x: 20,
    y: typeof window !== 'undefined' ? Math.max(80, window.innerHeight - 140) : 400,
    w: 340,
    h: null,
    z: 401,
    minimized: false,
  },
  deadman: {
    x: 16,
    y: typeof window !== 'undefined' ? window.innerHeight - 320 : 560,
    w: 240,
    h: null,
    z: 402,
    minimized: false,
  },
})

export function CockpitProvider({ children }: { children: ReactNode }) {
  const loaded = useRef(loadState())
  const [panels, setPanels] = useState<PanelMap>(() =>
    loaded.current?.panels ?? DEFAULT_PANELS(),
  )
  const [prefs, setPrefs] = useState<CockpitPrefs>(() =>
    loaded.current?.prefs ? { ...PREFS_DEFAULT, ...loaded.current.prefs } : PREFS_DEFAULT,
  )
  const [highContrast, setHighContrast] = useState(false)
  const [reducedTransparency, setReducedTransparency] = useState(false)
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

  useEffect(() => {
    if (autoPresetAppliedRef.current) return
    autoPresetAppliedRef.current = true
    // Do not override existing user-customized layouts/prefs.
    if (loaded.current) return
    const device = detectDevicePreset()
    const preset = firstRunPreset(device)
    if (!Object.keys(preset.panelPatches).length && !Object.keys(preset.prefs).length) return
    setPanels((prev) => ({ ...prev, ...preset.panelPatches }))
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

  const accent = useMemo(() => {
    if (prefs.screen_hue === 'low_light') return '#7dff8a'
    if (prefs.screen_hue === 'red_tactical') return '#ff1744'
    return themeToAccent(prefs.hud_color)
  }, [prefs.hud_color, prefs.screen_hue])

  /** Root CSS variables + classes */
  useEffect(() => {
    const root = document.documentElement
    const ua = navigator.userAgent || ''
    const isiOS = /iPhone|iPad|iPod/i.test(ua)
    const isAndroid = /Android/i.test(ua)
    const isMobileLike =
      isAndroid ||
      isiOS ||
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(max-width: 820px)').matches
    const wantsReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
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
    setPanels((prev) => {
      const p = prev[id]
      if (!p) return prev
      const nz = nextZ.current++
      const next = { ...prev, [id]: { ...p, z: nz } }
      persist(next, prefs)
      return next
    })
  }, [persist, prefs])

  const updatePanel = useCallback(
    (id: string, patch: Partial<CockpitPanelRect>) => {
      setPanels((prev) => {
        const cur = prev[id] ?? DEFAULT_PANELS()[id]
        if (!cur) return prev
        const next = { ...prev, [id]: { ...cur, ...patch } }
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
      const pad = 12
      const selfH = Math.max(44, height || 200)
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
      const vh = typeof window !== 'undefined' ? window.innerHeight : 900

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
        return Math.max(44, p.h ?? (p.minimized ? 44 : (defaults[pid] ?? 220)))
      }

      for (let iter = 0; iter < 8; iter++) {
        let hit = false
        for (const oid of Object.keys(panels)) {
          if (oid === id) continue
          const o = panels[oid]
          const ow = o.w
          const oh = panelHeight(oid, o)
          const a = { l: x, t: y, r: x + width, b: y + selfH }
          const b = { l: o.x, t: o.y, r: o.x + ow, b: o.y + oh }
          const overlap = !(a.r <= b.l + pad || a.l >= b.r - pad || a.b <= b.t + pad || a.t >= b.b - pad)
          if (overlap) {
            const overlapX = Math.min(a.r - b.l, b.r - a.l)
            const overlapY = Math.min(a.b - b.t, b.b - a.t)
            if (overlapX < overlapY) {
              const pushLeft = a.l + width / 2 < b.l + ow / 2
              x = pushLeft ? b.l - width - pad : b.r + pad
            } else {
              const pushUp = a.t + selfH / 2 < b.t + oh / 2
              y = pushUp ? b.t - selfH - pad : b.b + pad
            }
            x = snap(Math.max(0, Math.min(x, vw - width)))
            y = snap(Math.max(36, Math.min(y, vh - selfH)))
            hit = true
          }
        }
        if (!hit) break
      }
      return { x, y }
    },
    [panels],
  )

  const resetLayout = useCallback(() => {
    const fresh = DEFAULT_PANELS()
    setPanels(fresh)
    persist(fresh, prefs)
  }, [persist, prefs])

  const saveScene = useCallback(() => {
    persist(panels, prefs)
    try {
      localStorage.setItem(
        COCKPIT_STORAGE_KEY + '_scene_backup',
        JSON.stringify({ v: 1, panels, prefs }),
      )
    } catch {
      /* ignore */
    }
  }, [panels, persist, prefs])

  const loadScene = useCallback(() => {
    try {
      const raw = localStorage.getItem(COCKPIT_STORAGE_KEY + '_scene_backup')
      if (!raw) return
      const o = JSON.parse(raw) as StoredState
      if (o?.panels) setPanels(o.panels)
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
            const np = o.panels ?? prev
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
    document.documentElement.dataset.cockpitScreenHue = prefs.screen_hue
    return () => {
      delete document.documentElement.dataset.cockpitScreenHue
    }
  }, [prefs.screen_hue])

  const value = useMemo<CockpitContextValue>(
    () => ({
      panels,
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
    }),
    [
      panels,
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
