import { useEffect, useMemo, useRef, useState } from 'react'
import HudPanel from './HudPanel'
import { useAppContext } from '../context/AppContext'
import { useCockpit } from '../context/CockpitContext'
import { useMapContext } from '../context/MapContext'
import { useGPS } from '../hooks/useGPS'
import { formatDistance, haversineDistance, totalRouteDistance } from '../lib/haversine'
import { HALF_CORRIDOR_FEET, corridorSeverity, corridorZoneLabel, distancePointToRouteFeet } from '../lib/corridor'
import { fetchWeather } from '../lib/weather'
import { requestMicrophonePermission } from '../lib/devicePermissions'
import { fetchElevationMeters } from '../lib/elevation'

type VoiceState = 'sleeping' | 'listening' | 'processing' | 'success' | 'failure'

const WAKE_WORD = 'hud'
const WAKE_WINDOW_MS = 5000

function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.rate = 1
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(u)
}

function playChime() {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as
      | typeof AudioContext
      | undefined
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 800
    gain.gain.value = 0.05
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    window.setTimeout(() => {
      osc.stop()
      void ctx.close()
    }, 200)
  } catch {
    // ignore audio errors
  }
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

const QUICK_COMMAND_GROUPS: Array<{
  group: string
  priority?: boolean
  items: Array<{ label: string; cmd: string }>
}> = [
  {
    group: 'SOS FAST ACCESS',
    priority: true,
    items: [
      { label: 'Morse Toggle', cmd: 'morse toggle' },
      { label: 'Torch Toggle', cmd: 'torch toggle' },
      { label: 'Torch On', cmd: 'torch on' },
      { label: 'Torch Off', cmd: 'torch off' },
    ],
  },
  {
    group: 'Navigation',
    items: [
      { label: 'Center GPS', cmd: 'center' },
      { label: 'Zoom In', cmd: 'zoom in' },
      { label: 'Zoom Out', cmd: 'zoom out' },
      { label: 'Status', cmd: 'status' },
    ],
  },
  {
    group: 'Route',
    items: [
      { label: 'Add Pin', cmd: 'add pin' },
      { label: 'Route Stats', cmd: 'route stats' },
      { label: 'Reset Layout', cmd: 'reset' },
    ],
  },
  {
    group: 'Display & Weather',
    items: [
      { label: 'Weather', cmd: 'weather' },
      { label: 'Night Mode', cmd: 'night' },
      { label: 'Low Light', cmd: 'low light' },
      { label: 'Bright', cmd: 'bright' },
    ],
  },
]

export default function VoicePanel() {
  const { map } = useMapContext()
  const gps = useGPS()
  const { state, addWaypoint, removeWaypoint, setWaypoints } = useAppContext()
  const { setScreenHue, resetLayout, raisePanel, updatePanel } = useCockpit()

  const [voiceState, setVoiceState] = useState<VoiceState>('sleeping')
  const [expanded, setExpanded] = useState(false)
  const [armed, setArmed] = useState(false)
  const [typed, setTyped] = useState('')
  const [lastHeard, setLastHeard] = useState('')
  const [attachedPinId, setAttachedPinId] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('🎤 HUD (tap to wake)')
  const [continuousMode, setContinuousMode] = useState(false)
  const [morseEnabled, setMorseEnabled] = useState(false)
  const [torchEnabled, setTorchEnabled] = useState(false)
  const recognitionRef = useRef<any>(null)
  const armedRef = useRef(false)
  armedRef.current = armed
  const wakeUntilRef = useRef(0)
  const parseAndRunRef = useRef<(text: string) => Promise<void>>(async () => {})
  const supportsRec =
    typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  const attachedPin = useMemo(
    () => state.waypoints.find((w) => w.id === attachedPinId) ?? null,
    [attachedPinId, state.waypoints],
  )

  const pulseWake = () => {
    document.documentElement.classList.add('voice-wake-pulse')
    window.setTimeout(() => document.documentElement.classList.remove('voice-wake-pulse'), 500)
    if ('vibrate' in navigator) navigator.vibrate(30)
    playChime()
  }

  const report = (text: string, ok = true) => {
    setStatusText(text)
    setVoiceState(ok ? 'success' : 'failure')
    speak(text)
    window.setTimeout(() => setVoiceState(armed ? 'listening' : 'sleeping'), 650)
  }

  const runCommand = async (rawCmd: string) => {
    const cmd = normalize(rawCmd)
    if (!cmd) return
    setVoiceState('processing')
    setLastHeard(`HUD ${cmd}`)

    // Help / directory
    if (cmd === 'help' || cmd === 'commands' || cmd === 'directory') {
      report('Navigation, route, status, display, and safety commands are available.')
      return
    }

    // Navigation
    if (cmd === 'center') {
      if (!map || gps.lat == null || gps.lng == null) return report('GPS center unavailable.', false)
      map.easeTo({ center: [gps.lng, gps.lat], duration: 480, essential: true })
      return report('Centered on your GPS.')
    }
    if (cmd === 'zoom in') {
      if (!map) return report('Map unavailable.', false)
      map.zoomTo(map.getZoom() + 1, { duration: 250 })
      return report('Zooming in.')
    }
    if (cmd === 'zoom out') {
      if (!map) return report('Map unavailable.', false)
      map.zoomTo(map.getZoom() - 1, { duration: 250 })
      return report('Zooming out.')
    }
    if (cmd === 'north' || cmd === 'south' || cmd === 'east' || cmd === 'west') {
      if (!map) return report('Map unavailable.', false)
      const c = map.getCenter()
      const step = 0.04
      const dLat = cmd === 'north' ? step : cmd === 'south' ? -step : 0
      const dLng = cmd === 'east' ? step : cmd === 'west' ? -step : 0
      map.easeTo({ center: [c.lng + dLng, c.lat + dLat], duration: 220, essential: true })
      return report(`Panning ${cmd}.`)
    }

    // GPS pin attach/detach/recenter/distance
    if (cmd === 'attach') {
      if (gps.lat == null || gps.lng == null || state.waypoints.length === 0) {
        return report('No pins to attach.', false)
      }
      const nearest = [...state.waypoints].sort((a, b) => {
        const da = haversineDistance(gps.lat!, gps.lng!, a.lat, a.lng).miles
        const db = haversineDistance(gps.lat!, gps.lng!, b.lat, b.lng).miles
        return da - db
      })[0]
      setAttachedPinId(nearest.id)
      return report(`Attached to ${nearest.label}.`)
    }
    if (cmd === 'detach') {
      setAttachedPinId(null)
      return report('Detached from pin.')
    }
    if (cmd === 'recenter') {
      if (!map || !attachedPin) return report('No attached pin.', false)
      map.easeTo({
        center: [attachedPin.lng, attachedPin.lat],
        zoom: Math.max(14, map.getZoom()),
        duration: 520,
        essential: true,
      })
      return report(`Recentered to ${attachedPin.label}.`)
    }
    if (cmd === 'distance') {
      if (!attachedPin || gps.lat == null || gps.lng == null) return report('Distance unavailable.', false)
      const d = haversineDistance(gps.lat, gps.lng, attachedPin.lat, attachedPin.lng)
      return report(`Distance to ${attachedPin.label}: ${formatDistance(d.miles)}.`)
    }

    // Compass
    if (cmd === 'bearing') {
      if (!map) return report('Bearing unavailable.', false)
      return report(`Current map bearing ${Math.round((map.getBearing() + 360) % 360)} degrees.`)
    }
    if (cmd === 'direction') {
      if (!attachedPin || gps.lat == null || gps.lng == null) return report('Direction unavailable.', false)
      const b = bearingDeg(gps.lat, gps.lng, attachedPin.lat, attachedPin.lng)
      return report(`Direction to ${attachedPin.label}: ${Math.round(b)} degrees.`)
    }
    if (cmd === 'calibrate') {
      if (!map) return report('Compass unavailable.', false)
      map.easeTo({ bearing: 0, duration: 280, essential: true })
      return report('Compass calibrated.')
    }

    // Route
    if (cmd === 'add pin') {
      if (gps.lat == null || gps.lng == null) return report('GPS fix required.', false)
      const idx = state.waypoints.length + 1
      addWaypoint({
        id: `wp_voice_${Date.now()}`,
        lat: gps.lat,
        lng: gps.lng,
        label: `VOICE-${idx}`,
        type: 'default',
        createdAt: Date.now(),
      })
      return report('Pin added at current location.')
    }
    if (cmd === 'delete last') {
      const last = state.waypoints[state.waypoints.length - 1]
      if (!last) return report('No pins to delete.', false)
      removeWaypoint(last.id)
      return report('Last pin deleted.')
    }
    if (cmd === 'clear route') {
      setWaypoints([])
      return report('Route cleared.')
    }
    if (cmd === 'save route') {
      if (state.waypoints.length < 2) return report('Need at least two pins to save route.', false)
      const trkseg = state.waypoints
        .map((w) => `<trkpt lat="${w.lat}" lon="${w.lng}"></trkpt>`)
        .join('')
      const gpx =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<gpx version="1.1" creator="Tactical HUD"><trk><name>Voice Route</name><trkseg>${trkseg}</trkseg></trk></gpx>`
      const blob = new Blob([gpx], { type: 'application/gpx+xml' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'voice-route.gpx'
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(a.href), 1500)
      return report('Route exported as GPX.')
    }
    if (cmd === 'reverse route') {
      if (state.waypoints.length < 2) return report('Need at least two pins to reverse.', false)
      const rev = [...state.waypoints]
        .reverse()
        .map((w, i) => ({ ...w, id: `wp_rev_${Date.now()}_${i}`, createdAt: Date.now() + i }))
      setWaypoints(rev)
      return report('Route reversed.')
    }
    if (cmd === 'route stats') {
      const total = totalRouteDistance(state.waypoints.map((w) => ({ lat: w.lat, lng: w.lng })))
      return report(`Route has ${state.waypoints.length} pins. Distance ${formatDistance(total.miles)}.`)
    }

    // Status
    if (cmd === 'status') {
      const total = totalRouteDistance(state.waypoints.map((w) => ({ lat: w.lat, lng: w.lng })))
      const gpsState =
        gps.locationState === 'granted' && gps.lat != null
          ? 'GPS on'
          : gps.locationState === 'idle'
            ? 'Location off'
            : gps.locationState === 'requesting'
              ? 'GPS requesting'
              : gps.locationState === 'denied'
                ? 'GPS denied'
                : 'GPS unavailable'
      return report(`${gpsState}. ${state.waypoints.length} pins. Route ${formatDistance(total.miles)}.`)
    }
    if (cmd === 'time') return report(`Current time ${new Date().toLocaleTimeString()}.`)
    if (cmd === 'battery') {
      const nav = navigator as any
      if (!nav.getBattery) return report('Battery API unavailable.', false)
      nav.getBattery().then((b: any) => report(`Battery ${Math.round((b.level ?? 0) * 100)} percent.`))
      return
    }
    if (cmd === 'signal') return report(navigator.onLine ? 'Connectivity online.' : 'Connectivity offline.')
    if (cmd === 'elevation') {
      if (!map) return report('Elevation unavailable.', false)
      try {
        const c = map.getCenter()
        const m = (map as any).queryTerrainElevation?.(c)
        if (m != null && !Number.isNaN(m)) {
          return report(`Current elevation ${Math.round(m * 3.28084)} feet.`)
        }
        if (gps.lat != null && gps.lng != null) {
          const fallback = await fetchElevationMeters(gps.lat, gps.lng)
          if (fallback != null && !Number.isNaN(fallback)) {
            return report(`Current elevation ${Math.round(fallback * 3.28084)} feet.`)
          }
        }
        return report('Elevation unavailable.', false)
      } catch {
        return report('Elevation unavailable.', false)
      }
    }
    if (cmd === 'corridor' || cmd === 'corridor status') {
      if (gps.lat == null || gps.lng == null || state.waypoints.length < 2) {
        return report('Corridor unavailable. Need GPS lock and at least two route points.', false)
      }
      const route = state.waypoints.map((w) => ({ lat: w.lat, lng: w.lng }))
      const dFt = distancePointToRouteFeet({ lat: gps.lat, lng: gps.lng }, route)
      const sev = corridorSeverity(dFt, HALF_CORRIDOR_FEET)
      const edgeFt = Math.max(0, Math.round(HALF_CORRIDOR_FEET - dFt))
      return report(`Corridor ${corridorZoneLabel(sev)}. Edge ${edgeFt} feet. Offset ${Math.round(dFt)} feet.`)
    }

    // SOS
    if (cmd === 'sos' || cmd === 'emergency' || cmd === 'rescue') {
      window.dispatchEvent(new CustomEvent('hud:sos-arm'))
      raisePanel('sos')
      updatePanel('sos', { minimized: false, docked: false })
      return report('Emergency protocol armed. SOS panel activated.')
    }
    if (cmd === 'morse yes') {
      window.dispatchEvent(new CustomEvent('hud:sos-morse', { detail: { enabled: true } }))
      return report(
        morseEnabled
          ? 'Morse screen flash is already on.'
          : 'Morse screen flash is currently off. Enabling it now.',
      )
    }
    if (cmd === 'morse no') {
      window.dispatchEvent(new CustomEvent('hud:sos-morse', { detail: { enabled: false } }))
      return report(
        morseEnabled
          ? 'Morse screen flash is currently on. Disabling it now.'
          : 'Morse screen flash is already off.',
      )
    }
    if (cmd === 'morse toggle') {
      const next = !morseEnabled
      window.dispatchEvent(new CustomEvent('hud:sos-morse', { detail: { enabled: next } }))
      return report(
        morseEnabled
          ? 'Morse screen flash is currently on. Toggling it off.'
          : 'Morse screen flash is currently off. Toggling it on.',
      )
    }
    if (cmd === 'torch on' || cmd === 'torch yes') {
      window.dispatchEvent(new CustomEvent('hud:sos-torch', { detail: { enabled: true } }))
      return report(
        torchEnabled
          ? 'Torch is already on. Keeping Morse torch flash enabled.'
          : 'Torch is currently off. Enabling Morse torch flash.',
      )
    }
    if (cmd === 'torch off' || cmd === 'torch no') {
      window.dispatchEvent(new CustomEvent('hud:sos-torch', { detail: { enabled: false } }))
      return report(
        torchEnabled
          ? 'Torch is currently on. Disabling Morse torch flash.'
          : 'Torch is already off. Keeping Morse torch flash disabled.',
      )
    }
    if (cmd === 'torch toggle') {
      const next = !torchEnabled
      window.dispatchEvent(new CustomEvent('hud:sos-torch', { detail: { enabled: next } }))
      return report(
        torchEnabled
          ? 'Torch is currently on. Toggling off Morse torch flash.'
          : 'Torch is currently off. Toggling on Morse torch flash.',
      )
    }

    // Display
    if (cmd === 'night') {
      setScreenHue('red_tactical')
      return report('Red tactical mode enabled.')
    }
    if (cmd === 'low light') {
      setScreenHue('low_light')
      return report('Low light mode enabled.')
    }
    if (cmd === 'bright') {
      setScreenHue('bright_day')
      return report('Bright mode enabled.')
    }
    if (cmd === 'reset') {
      resetLayout()
      return report('Panel layout reset.')
    }

    // Tier stubs
    if (cmd === 'weather panel') {
      updatePanel('weather', { docked: false, minimized: false })
      raisePanel('weather')
      return report('Weather panel opened.')
    }
    if (cmd === 'weather refresh') {
      const w = await fetchWeather(gps.lat, gps.lng)
      window.dispatchEvent(new CustomEvent('hud:weather-refresh'))
      if ('error' in w) return report(`Unable to refresh weather: ${w.error}`, false)
      return report('Weather refreshed.')
    }
    if (cmd === 'weather') {
      const w = await fetchWeather(gps.lat, gps.lng)
      window.dispatchEvent(new CustomEvent('hud:weather-refresh'))
      if ('error' in w) return report(`Unable to get weather: ${w.error}`, false)
      return report(
        `Current weather for ${w.location}: ${w.condition}, ${w.temperature} ${w.unit.replace('°', 'degrees ')}, wind ${Math.round(w.windSpeed)} ${w.windUnit}.`,
      )
    }
    if (['fire', 'water', 'deadman'].includes(cmd)) return report('Coming in Tier 2.')
    if (cmd === 'voice continuous') {
      setContinuousMode(true)
      return report('Continuous listening enabled. Say HUD sleep to stop.')
    }
    if (cmd === 'sleep' || cmd === 'voice sleep') {
      setContinuousMode(false)
      wakeUntilRef.current = 0
      return report('Continuous listening disabled.')
    }
    if (['ai route', 'biometric', 'forage', 'lidar', 'ar'].includes(cmd)) {
      return report('Coming in Tier 3.')
    }

    report(`Unknown command: ${cmd}. Say HUD help for directory.`, false)
  }

  const parseAndRun = async (text: string) => {
    const norm = normalize(text)
    const now = Date.now()
    const i = norm.indexOf(`${WAKE_WORD} `)
    const hasWakeWord = norm === WAKE_WORD || i === 0 || i > -1

    if (hasWakeWord) {
      pulseWake()
      setVoiceState('listening')
      wakeUntilRef.current = now + WAKE_WINDOW_MS
      const commandsPart = i === -1 ? '' : norm.slice(i + WAKE_WORD.length).trim()
      const parts = commandsPart.split(/\bthen\b/).map((s) => s.trim()).filter(Boolean)
      if (parts.length === 0) return report('Ready. Say HUD plus command.', true)
      for (const p of parts) {
        await runCommand(p)
      }
      return
    }

    if (continuousMode || now <= wakeUntilRef.current) {
      const parts = norm.split(/\bthen\b/).map((s) => s.trim()).filter(Boolean)
      for (const p of parts) {
        await runCommand(p)
      }
    }
  }
  parseAndRunRef.current = parseAndRun

  useEffect(() => {
    const onMorseState = (ev: Event) => {
      const custom = ev as CustomEvent<{ enabled?: boolean }>
      if (typeof custom.detail?.enabled !== 'boolean') return
      setMorseEnabled(custom.detail.enabled)
    }
    const onTorchState = (ev: Event) => {
      const custom = ev as CustomEvent<{ enabled?: boolean }>
      if (typeof custom.detail?.enabled !== 'boolean') return
      setTorchEnabled(custom.detail.enabled)
    }
    window.addEventListener('hud:sos-morse-state', onMorseState)
    window.addEventListener('hud:sos-torch-state', onTorchState)
    return () => {
      window.removeEventListener('hud:sos-morse-state', onMorseState)
      window.removeEventListener('hud:sos-torch-state', onTorchState)
    }
  }, [])

  useEffect(() => {
    if (!armed || !supportsRec) return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const rec = new SR()
    recognitionRef.current = rec
    rec.lang = 'en-US'
    rec.continuous = true
    rec.interimResults = false
    rec.onstart = () => {
      setVoiceState('listening')
      setStatusText('🎤 HUD listening')
    }
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results)
        .slice(e.resultIndex)
        .map((r: any) => r[0]?.transcript ?? '')
        .join(' ')
      void parseAndRunRef.current(transcript)
    }
    rec.onerror = () => setVoiceState('failure')
    rec.onend = () => {
      if (armedRef.current) {
        try {
          rec.start()
        } catch {
          // ignore restart failures
        }
      }
    }
    rec.start()
    return () => {
      try {
        rec.stop()
      } catch {
        // ignore
      }
    }
  }, [armed, supportsRec])

  return (
    <HudPanel
      panelId="voice"
      title="Voice Directory"
      initialPos={{ x: 1240, y: 280 }}
      initialWidth={330}
      minHeight={130}
      accent={voiceState === 'failure' ? '#ff3b4d' : undefined}
    >
      <div style={{ display: 'grid', gap: 8 }}>
        <button
          type="button"
          data-no-drag
          onClick={async () => {
            if (!armed) {
              const mic = await requestMicrophonePermission()
              if (mic !== 'granted') {
                setVoiceState('failure')
                setStatusText('🎤 Microphone permission needed')
                return
              }
            }
            setArmed((v) => !v)
            setVoiceState((s) => (s === 'sleeping' ? 'listening' : 'sleeping'))
            setStatusText((t) => (t.includes('listening') ? '🎤 HUD (tap to wake)' : '🎤 HUD listening'))
          }}
          style={{
            minHeight: 40,
            borderRadius: 8,
            border: '1px solid rgba(125,255,138,0.5)',
            background: armed ? 'rgba(125,255,138,0.18)' : 'rgba(10,12,13,0.8)',
            color: armed ? '#7dff8a' : 'var(--cockpit-panel-subtle)',
            boxShadow: armed ? '0 0 10px rgba(125,255,138,0.35)' : 'none',
            cursor: 'pointer',
            fontSize: 11,
            letterSpacing: '0.1em',
          }}
        >
          {expanded ? '🎤 HUD (tap to wake)' : statusText}
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            data-no-drag
            onClick={() => setExpanded((v) => !v)}
            style={{
              flex: 1,
              minHeight: 34,
              borderRadius: 8,
              border: '1px solid rgba(199,206,198,0.28)',
              background: 'rgba(10,12,13,0.8)',
              color: 'var(--cockpit-panel-subtle)',
              cursor: 'pointer',
              fontSize: 10,
              letterSpacing: '0.08em',
            }}
          >
            {expanded ? 'HIDE COMMANDS' : 'SHOW COMMAND LIST'}
          </button>
          <button
            type="button"
            data-no-drag
            onClick={() => setContinuousMode((v) => !v)}
            style={{
              minHeight: 34,
              borderRadius: 8,
              border: continuousMode
                ? '1px solid rgba(125,255,138,0.6)'
                : '1px solid rgba(199,206,198,0.28)',
              background: continuousMode ? 'rgba(125,255,138,0.16)' : 'rgba(10,12,13,0.8)',
              color: continuousMode ? '#7dff8a' : 'var(--cockpit-panel-subtle)',
              cursor: 'pointer',
              fontSize: 10,
              letterSpacing: '0.08em',
            }}
          >
            {continuousMode ? 'CONTINUOUS ON' : 'CONTINUOUS OFF'}
          </button>
        </div>

        {!supportsRec && (
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--cockpit-panel-subtle)' }}>No speech recognition. Type command:</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                data-no-drag
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="HUD status"
                style={{
                  flex: 1,
                  minHeight: 34,
                  borderRadius: 8,
                  border: '1px solid rgba(199,206,198,0.24)',
                  background: 'rgba(10,12,13,0.8)',
                  color: '#d3dad3',
                  padding: '0 10px',
                }}
              />
              <button
                type="button"
                data-no-drag
                onClick={() => parseAndRun(typed)}
                style={{
                  minHeight: 34,
                  borderRadius: 8,
                  border: '1px solid rgba(199,206,198,0.3)',
                  background: 'rgba(199,206,198,0.14)',
                  color: '#d3dad3',
                  cursor: 'pointer',
                }}
              >
                Send
              </button>
            </div>
          </div>
        )}

        {expanded && (
          <div style={{ fontSize: 10, color: 'var(--cockpit-panel-subtle)', lineHeight: 1.5, display: 'grid', gap: 8 }}>
            <div>
              Wake word: <strong>HUD</strong>. Example: <code>HUD status</code>. Last: {lastHeard || '—'}
            </div>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--cockpit-panel-subtle)' }}>
              ONE-TAP COMMANDS (MOBILE READY)
            </div>
            <div
              data-no-drag
              style={{
                maxHeight: 180,
                overflowY: 'auto',
                border: '1px solid rgba(199,206,198,0.2)',
                borderRadius: 8,
                background: 'rgba(10,12,13,0.65)',
                padding: 6,
                display: 'grid',
                gap: 6,
              }}
            >
              {QUICK_COMMAND_GROUPS.map((group) => (
                <div key={group.group} style={{ display: 'grid', gap: 6 }}>
                  <div
                    style={{
                      fontSize: 9,
                      letterSpacing: '0.1em',
                      color: group.priority ? '#ffb8c6' : 'var(--cockpit-panel-subtle)',
                      fontWeight: 700,
                    }}
                  >
                    {group.group}
                  </div>
                  {group.items.map((item) => (
                    <button
                      key={`${group.group}-${item.cmd}`}
                      type="button"
                      data-no-drag
                      onClick={() => void runCommand(item.cmd)}
                      style={{
                        width: '100%',
                        minHeight: 34,
                        textAlign: 'left',
                        borderRadius: 6,
                        border: group.priority ? '1px solid rgba(255,127,151,0.35)' : '1px solid rgba(199,206,198,0.26)',
                        background: group.priority ? 'rgba(255,75,112,0.18)' : 'rgba(199,206,198,0.12)',
                        color: '#d3dad3',
                        padding: '0 10px',
                        cursor: 'pointer',
                        fontSize: 11,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div>
              <strong>TIER 1</strong> Navigation: center, zoom in/out, north/south/east/west.
            </div>
            <div>
              <strong>TIER 1</strong> GPS pin: attach, detach, recenter, distance.
            </div>
            <div>
              <strong>TIER 1</strong> Compass: bearing, direction, calibrate.
            </div>
            <div>
              <strong>TIER 1</strong> Route: add pin, delete last, clear route, save route, reverse route, route stats.
            </div>
            <div>
              <strong>TIER 1</strong> Status: status, time, battery, signal, elevation.
            </div>
            <div>
              <strong>TIER 1</strong> SOS: sos, emergency, rescue, morse yes/no/toggle, torch on/off/toggle.
            </div>
            <div>
              <strong>TIER 1</strong> Corridor: corridor, corridor status.
            </div>
            <div>
              <strong>TIER 1</strong> Display: night, low light, bright, reset.
            </div>
            <div>
              <strong>TIER 2</strong>: weather (live when configured).
            </div>
            <div>
              <strong>TIER 2 (stub)</strong>: fire, water, deadman.
            </div>
            <div>
              <strong>TIER 3 (stub)</strong>: ai route, biometric, forage, lidar, ar, voice continuous.
            </div>
          </div>
        )}
      </div>
    </HudPanel>
  )
}
