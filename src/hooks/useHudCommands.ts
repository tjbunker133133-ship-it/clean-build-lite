import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppContext } from '../context/AppContext'
import { useCockpit } from '../context/CockpitContext'
import { useMapContext } from '../context/MapContext'
import { useGPS } from './useGPS'
import { formatDistance, haversineDistance, totalRouteDistance } from '../lib/haversine'
import {
  HALF_CORRIDOR_FEET,
  corridorSeverity,
  corridorZoneLabel,
  distancePointToRouteFeet,
} from '../lib/corridor'
import { fetchWeather } from '../lib/weather'
import { fetchElevationMeters } from '../lib/elevation'
import {
  markCommandResolving,
  recordCommandDispatch,
  recordVoiceParserEvent,
  reportCommandFailure,
  reportCommandRejected,
  reportCommandStarted,
  reportCommandSuccess,
  reportCommandTimeout,
} from '../runtime/runtimeSnapshot'
import {
  classifyFailureFromMessage,
  getCommandVerifier,
  installBuiltinCommandVerifiers,
} from '../runtime/commandExecution'
import { traceAction } from '../runtime/actionTrace'
import { clearBreadcrumbSession } from '../lib/movement/breadcrumbSessionStore'
import { sendVoiceRoutineCheckIn } from '../lib/checkIn/voiceRoutineCheckIn'
import { applyVoiceBeaconAction } from '../lib/checkIn/voiceBeaconControl'
import { isVoiceOperationalCommandId } from '../voice/voiceOperationalIds'

/**
 * Single source of truth for HUD commands.
 *
 * Voice (VoicePanel), the keyboard palette (CommandPalette), and any future
 * UI surface dispatch through `dispatch(cmd, source)`. Each command's `run`
 * returns `{ ok, message }`; the caller decides how to surface it (speech,
 * silence, toast). The voice layer never mutates app/cockpit/map state
 * directly — every state change happens here.
 *
 * `commands` is the discoverable list (palette, command directories).
 * `dispatch` accepts both canonical ids ("center") and aliases ("zoom in",
 * "morse yes", etc.).
 */

export type CommandSource = 'voice' | 'ui' | 'kbd'

export type CommandResult = { ok: boolean; message: string }

export type CommandDescriptor = {
  /** Canonical id; also used as a voice alias. */
  id: string
  /** Human label for UI (palette, directory). */
  label: string
  /** Additional voice/text aliases. Lowercased, normalized. */
  aliases?: string[]
  /** When true, surfaces in CommandPalette. Defaults to false. */
  paletteVisible?: boolean
  /** Optional grouping label for palette/directory. */
  group?: string
  run: (ctx: { source: CommandSource }) => Promise<CommandResult> | CommandResult
}

export type VoiceIntentRegistryEntry = {
  intent: string
  category: string
  aliases: string[]
}

/** Directory of intents exposed to voice UX / validators (operational channel only). */
export const VOICE_INTENT_REGISTRY: VoiceIntentRegistryEntry[] = [
  { intent: 'drop_waypoint', category: 'Route', aliases: ['drop waypoint', 'drop pin'] },
  { intent: 'check_in', category: 'Check-In', aliases: ['check in', 'routine check in'] },
  { intent: 'weather', category: 'Weather', aliases: ['weather', 'show weather'] },
  { intent: 'flashlight_on', category: 'Safety', aliases: ['flashlight on', 'torch on'] },
  { intent: 'flashlight_off', category: 'Safety', aliases: ['flashlight off', 'torch off'] },
  { intent: 'flashlight_toggle', category: 'Safety', aliases: ['flashlight toggle', 'torch toggle'] },
  { intent: 'beacon_start', category: 'Check-In', aliases: ['start beacon', 'beacon on'] },
  { intent: 'beacon_stop', category: 'Check-In', aliases: ['stop beacon', 'beacon off'] },
  { intent: 'clear_trail', category: 'Route', aliases: ['clear trail', 'clear breadcrumb'] },
  { intent: 'sos_confirm', category: 'Safety', aliases: ['confirm sos', 'sos confirm'] },
  { intent: 'help', category: 'Meta', aliases: ['help', 'commands'] },
]

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

const ok = (message: string): CommandResult => ({ ok: true, message })
const fail = (message: string): CommandResult => ({ ok: false, message })

export function useHudCommands(): {
  commands: CommandDescriptor[]
  dispatch: (
    cmd: string,
    source: CommandSource,
    rawTranscript?: string,
  ) => Promise<CommandResult>
} {
  const { map } = useMapContext()
  const gps = useGPS()
  const { state, addWaypoint, removeWaypoint, setWaypoints } = useAppContext()
  const { setScreenHue, resetLayout, raisePanel, updatePanel } = useCockpit()

  const [attachedPinId, setAttachedPinId] = useState<string | null>(null)
  const [morseEnabled, setMorseEnabled] = useState(false)
  const [flashlightEnabled, setFlashlightEnabled] = useState(false)
  const [flashlightCapability, setFlashlightCapability] = useState<{
    supported: boolean
    permission: 'unknown' | 'granted' | 'denied'
    supportState: 'unknown' | 'supported' | 'unsupported'
  }>({ supported: false, permission: 'unknown', supportState: 'unknown' })

  // Listen for SOS panel state echoes so spoken/textual responses stay accurate.
  useEffect(() => {
    const onMorseState = (ev: Event) => {
      const detail = (ev as CustomEvent<{ enabled?: boolean }>).detail
      if (typeof detail?.enabled === 'boolean') setMorseEnabled(detail.enabled)
    }
    const onTorchState = (ev: Event) => {
      const detail = (ev as CustomEvent<{ enabled?: boolean }>).detail
      if (typeof detail?.enabled === 'boolean') setFlashlightEnabled(detail.enabled)
    }
    const onFlashlightCapability = (
      ev: Event,
    ) => {
      const detail = (ev as CustomEvent<{
        supported?: boolean
        permission?: 'unknown' | 'granted' | 'denied'
        supportState?: 'unknown' | 'supported' | 'unsupported'
      }>).detail
      setFlashlightCapability({
        supported: detail?.supported === true,
        permission: detail?.permission ?? 'unknown',
        supportState: detail?.supportState ?? 'unknown',
      })
    }
    window.addEventListener('hud:sos-morse-state', onMorseState)
    window.addEventListener('hud:sos-torch-state', onTorchState)
    window.addEventListener('hud:flashlight-capability', onFlashlightCapability)
    return () => {
      window.removeEventListener('hud:sos-morse-state', onMorseState)
      window.removeEventListener('hud:sos-torch-state', onTorchState)
      window.removeEventListener('hud:flashlight-capability', onFlashlightCapability)
    }
  }, [])

  // Install built-in command verifiers exactly once. Idempotent.
  useEffect(() => {
    installBuiltinCommandVerifiers()
  }, [])

  const morseRef = useRef(morseEnabled)
  morseRef.current = morseEnabled
  const flashlightRef = useRef(flashlightEnabled)
  flashlightRef.current = flashlightEnabled

  const attachedPin = useMemo(
    () => state.waypoints.find((w) => w.id === attachedPinId) ?? null,
    [attachedPinId, state.waypoints],
  )

  const commands = useMemo<CommandDescriptor[]>(() => {
    return [
      // Help / directory
      {
        id: 'help',
        label: 'Help / command directory',
        aliases: ['commands', 'directory'],
        run: (ctx) =>
          ctx.source === 'voice'
            ? ok(
                'Voice (after HUD): drop waypoint, check in, show weather, flashlight on or off, start or stop beacon, clear trail. Say SOS then confirm to arm.',
              )
            : ok('Navigation, route, status, display, and safety commands are available.'),
      },

      // Navigation
      {
        id: 'center',
        label: 'Center map on GPS',
        aliases: ['center map', 'center gps', 'gps', 'my location', 'location', 'where am i'],
        paletteVisible: true,
        group: 'Navigation',
        run: () => {
          if (!map || gps.lat == null || gps.lng == null) return fail('GPS center unavailable.')
          map.easeTo({ center: [gps.lng, gps.lat], duration: 480, essential: true })
          return ok('Centered on your GPS.')
        },
      },
      {
        id: 'zoom in',
        label: 'Zoom in',
        paletteVisible: true,
        group: 'Navigation',
        run: () => {
          if (!map) return fail('Map unavailable.')
          map.zoomTo(map.getZoom() + 1, { duration: 250 })
          return ok('Zooming in.')
        },
      },
      {
        id: 'zoom out',
        label: 'Zoom out',
        paletteVisible: true,
        group: 'Navigation',
        run: () => {
          if (!map) return fail('Map unavailable.')
          map.zoomTo(map.getZoom() - 1, { duration: 250 })
          return ok('Zooming out.')
        },
      },
      ...(['north', 'south', 'east', 'west'] as const).map((dir) => ({
        id: dir,
        label: `Pan ${dir}`,
        group: 'Navigation',
        run: () => {
          if (!map) return fail('Map unavailable.')
          const c = map.getCenter()
          const step = 0.04
          const dLat = dir === 'north' ? step : dir === 'south' ? -step : 0
          const dLng = dir === 'east' ? step : dir === 'west' ? -step : 0
          map.easeTo({ center: [c.lng + dLng, c.lat + dLat], duration: 220, essential: true })
          return ok(`Panning ${dir}.`)
        },
      })),

      // GPS pin attach / detach / recenter / distance
      {
        id: 'attach',
        label: 'Attach to nearest pin',
        aliases: ['attach pin', 'attach to pin'],
        group: 'Pin',
        run: () => {
          if (gps.lat == null || gps.lng == null || state.waypoints.length === 0) {
            return fail('No pins to attach.')
          }
          const nearest = [...state.waypoints].sort((a, b) => {
            const da = haversineDistance(gps.lat!, gps.lng!, a.lat, a.lng).miles
            const db = haversineDistance(gps.lat!, gps.lng!, b.lat, b.lng).miles
            return da - db
          })[0]
          setAttachedPinId(nearest.id)
          return ok(`Attached to ${nearest.label}.`)
        },
      },
      {
        id: 'detach',
        label: 'Detach pin',
        group: 'Pin',
        run: () => {
          setAttachedPinId(null)
          return ok('Detached from pin.')
        },
      },
      {
        id: 'recenter',
        label: 'Recenter on attached pin',
        group: 'Pin',
        run: () => {
          if (!map || !attachedPin) return fail('No attached pin.')
          map.easeTo({
            center: [attachedPin.lng, attachedPin.lat],
            zoom: Math.max(14, map.getZoom()),
            duration: 520,
            essential: true,
          })
          return ok(`Recentered to ${attachedPin.label}.`)
        },
      },
      {
        id: 'distance',
        label: 'Distance to attached pin',
        group: 'Pin',
        run: () => {
          if (!attachedPin || gps.lat == null || gps.lng == null) {
            return fail('Distance unavailable.')
          }
          const d = haversineDistance(gps.lat, gps.lng, attachedPin.lat, attachedPin.lng)
          return ok(`Distance to ${attachedPin.label}: ${formatDistance(d.miles)}.`)
        },
      },

      // Compass
      {
        id: 'bearing',
        label: 'Map bearing',
        group: 'Compass',
        run: () => {
          if (!map) return fail('Bearing unavailable.')
          return ok(`Current map bearing ${Math.round((map.getBearing() + 360) % 360)} degrees.`)
        },
      },
      {
        id: 'direction',
        label: 'Direction to attached pin',
        group: 'Compass',
        run: () => {
          if (!attachedPin || gps.lat == null || gps.lng == null) {
            return fail('Direction unavailable.')
          }
          const b = bearingDeg(gps.lat, gps.lng, attachedPin.lat, attachedPin.lng)
          return ok(`Direction to ${attachedPin.label}: ${Math.round(b)} degrees.`)
        },
      },
      {
        id: 'calibrate',
        label: 'Calibrate compass',
        group: 'Compass',
        run: () => {
          if (!map) return fail('Compass unavailable.')
          map.easeTo({ bearing: 0, duration: 280, essential: true })
          return ok('Compass calibrated.')
        },
      },

      // Route
      {
        id: 'add pin',
        label: 'Add pin at GPS',
        aliases: ['add a pin', 'drop pin', 'drop a pin'],
        group: 'Route',
        run: () => {
          if (gps.lat == null || gps.lng == null) return fail('GPS fix required.')
          const idx = state.waypoints.length + 1
          addWaypoint({
            id: `wp_voice_${Date.now()}`,
            lat: gps.lat,
            lng: gps.lng,
            label: `VOICE-${idx}`,
            type: 'default',
            createdAt: Date.now(),
          })
          return ok('Pin added at current location.')
        },
      },
      {
        id: 'drop waypoint',
        label: 'Drop waypoint at current position',
        aliases: ['drop way point', 'mark waypoint', 'place waypoint'],
        group: 'Route',
        run: () => {
          if (gps.lat == null || gps.lng == null) return fail('GPS fix required.')
          const idx = state.waypoints.length + 1
          addWaypoint({
            id: `wp_voice_${Date.now()}`,
            lat: gps.lat,
            lng: gps.lng,
            label: `WP-${idx}`,
            type: 'default',
            createdAt: Date.now(),
          })
          return ok('Waypoint dropped at current position.')
        },
      },
      {
        id: 'clear trail',
        label: 'Clear breadcrumb trail',
        aliases: ['clear breadcrumbs', 'reset breadcrumb trail'],
        group: 'Route',
        run: () => {
          clearBreadcrumbSession()
          return ok('Breadcrumb trail cleared.')
        },
      },
      {
        id: 'check in',
        label: 'Send routine check-in',
        aliases: ['routine check in', 'send check in', 'send check-in'],
        group: 'Check-In',
        run: async () => {
          if (gps.lat == null || gps.lng == null) return fail('GPS fix required.')
          const r = await sendVoiceRoutineCheckIn({
            lat: gps.lat,
            lng: gps.lng,
            locationState: gps.locationState,
            accuracy: gps.accuracy ?? null,
            elevation: gps.elevation ?? null,
          })
          return { ok: r.ok, message: r.message }
        },
      },
      {
        id: 'start beacon',
        label: 'Start check-in beacon',
        aliases: ['beacon start', 'enable beacon'],
        group: 'Check-In',
        run: () => {
          const r = applyVoiceBeaconAction('start')
          return { ok: r.ok, message: r.message }
        },
      },
      {
        id: 'stop beacon',
        label: 'Stop check-in beacon',
        aliases: ['beacon stop', 'disable beacon'],
        group: 'Check-In',
        run: () => {
          const r = applyVoiceBeaconAction('stop')
          return { ok: r.ok, message: r.message }
        },
      },
      {
        id: 'delete last',
        label: 'Delete last pin',
        aliases: ['delete last pin', 'remove last pin'],
        group: 'Route',
        run: () => {
          const last = state.waypoints[state.waypoints.length - 1]
          if (!last) return fail('No pins to delete.')
          removeWaypoint(last.id)
          return ok('Last pin deleted.')
        },
      },
      {
        id: 'clear route',
        label: 'Clear route',
        aliases: ['clear pins', 'clear all pins'],
        group: 'Route',
        run: () => {
          setWaypoints([])
          return ok('Route cleared.')
        },
      },
      {
        id: 'save route',
        label: 'Save route as GPX',
        group: 'Route',
        run: () => {
          if (state.waypoints.length < 2) return fail('Need at least two pins to save route.')
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
          return ok('Route exported as GPX.')
        },
      },
      {
        id: 'reverse route',
        label: 'Reverse route',
        group: 'Route',
        run: () => {
          if (state.waypoints.length < 2) return fail('Need at least two pins to reverse.')
          const rev = [...state.waypoints]
            .reverse()
            .map((w, i) => ({ ...w, id: `wp_rev_${Date.now()}_${i}`, createdAt: Date.now() + i }))
          setWaypoints(rev)
          return ok('Route reversed.')
        },
      },
      {
        id: 'route stats',
        label: 'Route stats',
        group: 'Route',
        run: () => {
          const total = totalRouteDistance(state.waypoints.map((w) => ({ lat: w.lat, lng: w.lng })))
          return ok(
            `Route has ${state.waypoints.length} pins. Distance ${formatDistance(total.miles)}.`,
          )
        },
      },

      // Status
      {
        id: 'status',
        label: 'Status report',
        paletteVisible: true,
        group: 'Status',
        run: () => {
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
          return ok(
            `${gpsState}. ${state.waypoints.length} pins. Route ${formatDistance(total.miles)}.`,
          )
        },
      },
      {
        id: 'time',
        label: 'Current time',
        group: 'Status',
        run: () => ok(`Current time ${new Date().toLocaleTimeString()}.`),
      },
      {
        id: 'battery',
        label: 'Battery level',
        group: 'Status',
        run: async () => {
          const nav = navigator as Navigator & { getBattery?: () => Promise<{ level?: number }> }
          if (!nav.getBattery) return fail('Battery API unavailable.')
          try {
            const b = await nav.getBattery()
            return ok(`Battery ${Math.round((b.level ?? 0) * 100)} percent.`)
          } catch {
            return fail('Battery API unavailable.')
          }
        },
      },
      {
        id: 'signal',
        label: 'Connectivity',
        aliases: ['connectivity'],
        group: 'Status',
        run: () => ok(navigator.onLine ? 'Connectivity online.' : 'Connectivity offline.'),
      },
      {
        id: 'elevation',
        label: 'Current elevation',
        group: 'Status',
        run: async () => {
          if (!map) return fail('Elevation unavailable.')
          try {
            const c = map.getCenter()
            const m = (map as unknown as { queryTerrainElevation?: (c: unknown) => number | null })
              .queryTerrainElevation?.(c)
            if (m != null && !Number.isNaN(m)) {
              return ok(`Current elevation ${Math.round(m * 3.28084)} feet.`)
            }
            if (gps.lat != null && gps.lng != null) {
              const fallback = await fetchElevationMeters(gps.lat, gps.lng)
              if (fallback != null && !Number.isNaN(fallback)) {
                return ok(`Current elevation ${Math.round(fallback * 3.28084)} feet.`)
              }
            }
            return fail('Elevation unavailable.')
          } catch {
            return fail('Elevation unavailable.')
          }
        },
      },
      {
        id: 'corridor',
        label: 'Corridor status',
        aliases: ['corridor status'],
        group: 'Status',
        run: () => {
          if (gps.lat == null || gps.lng == null || state.waypoints.length < 2) {
            return fail('Corridor unavailable. Need GPS lock and at least two route points.')
          }
          const route = state.waypoints.map((w) => ({ lat: w.lat, lng: w.lng }))
          const dFt = distancePointToRouteFeet({ lat: gps.lat, lng: gps.lng }, route)
          const sev = corridorSeverity(dFt, HALF_CORRIDOR_FEET)
          const edgeFt = Math.max(0, Math.round(HALF_CORRIDOR_FEET - dFt))
          return ok(
            `Corridor ${corridorZoneLabel(sev)}. Edge ${edgeFt} feet. Offset ${Math.round(dFt)} feet.`,
          )
        },
      },

      // SOS
      {
        id: 'sos',
        label: 'Arm SOS',
        aliases: ['emergency', 'rescue'],
        group: 'Safety',
        run: (ctx) => {
          if (ctx.source === 'voice') {
            return fail('Say HUD SOS for the prompt, then say confirm to arm.')
          }
          window.dispatchEvent(new CustomEvent('hud:sos-arm'))
          raisePanel('sos')
          updatePanel('sos', { minimized: false, docked: false })
          return ok('Emergency protocol armed. SOS panel activated.')
        },
      },
      {
        id: 'sos confirm',
        label: 'Confirm voice SOS arm',
        aliases: ['confirm sos', 'confirm emergency'],
        group: 'Safety',
        run: () => {
          window.dispatchEvent(new CustomEvent('hud:sos-arm'))
          return ok('Emergency protocol armed.')
        },
      },
      {
        id: 'sos disarm',
        label: 'Disarm SOS',
        aliases: ['cancel sos', 'stop sos', 'sos cancel'],
        group: 'Safety',
        run: () => {
          window.dispatchEvent(new CustomEvent('hud:sos-disarm'))
          return ok('SOS disarmed.')
        },
      },
      {
        id: 'morse yes',
        label: 'Morse on',
        group: 'Safety',
        run: () => {
          window.dispatchEvent(new CustomEvent('hud:sos-morse', { detail: { enabled: true } }))
          return ok(
            morseRef.current
              ? 'Morse screen flash is already on.'
              : 'Morse screen flash is currently off. Enabling it now.',
          )
        },
      },
      {
        id: 'morse no',
        label: 'Morse off',
        group: 'Safety',
        run: () => {
          window.dispatchEvent(new CustomEvent('hud:sos-morse', { detail: { enabled: false } }))
          return ok(
            morseRef.current
              ? 'Morse screen flash is currently on. Disabling it now.'
              : 'Morse screen flash is already off.',
          )
        },
      },
      {
        id: 'morse toggle',
        label: 'Morse toggle',
        group: 'Safety',
        run: () => {
          const next = !morseRef.current
          window.dispatchEvent(new CustomEvent('hud:sos-morse', { detail: { enabled: next } }))
          return ok(
            morseRef.current
              ? 'Morse screen flash is currently on. Toggling it off.'
              : 'Morse screen flash is currently off. Toggling it on.',
          )
        },
      },
      {
        id: 'flashlight on',
        label: 'Flashlight on',
        aliases: ['flashlight yes', 'torch on', 'torch yes'],
        group: 'Safety',
        run: () => {
          if (flashlightCapability.permission === 'denied') {
            return fail('Flashlight unavailable because camera permission is denied.')
          }
          if (flashlightCapability.supportState === 'unsupported') {
            return fail('Flashlight control is not supported on this device/browser.')
          }
          window.dispatchEvent(new CustomEvent('hud:sos-torch', { detail: { enabled: true } }))
          return ok(
            flashlightRef.current
              ? 'Flashlight is already on. Keeping Morse flashlight flash enabled.'
              : 'Flashlight is currently off. Enabling Morse flashlight flash.',
          )
        },
      },
      {
        id: 'flashlight off',
        label: 'Flashlight off',
        aliases: ['flashlight no', 'torch off', 'torch no'],
        group: 'Safety',
        run: () => {
          if (flashlightCapability.permission === 'denied') {
            return fail('Flashlight unavailable because camera permission is denied.')
          }
          if (flashlightCapability.supportState === 'unsupported') {
            return fail('Flashlight control is not supported on this device/browser.')
          }
          window.dispatchEvent(new CustomEvent('hud:sos-torch', { detail: { enabled: false } }))
          return ok(
            flashlightRef.current
              ? 'Flashlight is currently on. Disabling Morse flashlight flash.'
              : 'Flashlight is already off. Keeping Morse flashlight flash disabled.',
          )
        },
      },
      {
        id: 'flashlight toggle',
        label: 'Flashlight toggle',
        aliases: ['torch toggle'],
        group: 'Safety',
        run: () => {
          if (flashlightCapability.permission === 'denied') {
            return fail('Flashlight unavailable because camera permission is denied.')
          }
          if (flashlightCapability.supportState === 'unsupported') {
            return fail('Flashlight control is not supported on this device/browser.')
          }
          const next = !flashlightRef.current
          window.dispatchEvent(new CustomEvent('hud:sos-torch', { detail: { enabled: next } }))
          return ok(
            flashlightRef.current
              ? 'Flashlight is currently on. Toggling off Morse flashlight flash.'
              : 'Flashlight is currently off. Toggling on Morse flashlight flash.',
          )
        },
      },

      // Display
      {
        id: 'night',
        label: 'Display: red tactical',
        aliases: ['night mode', 'red tactical', 'tactical mode'],
        paletteVisible: true,
        group: 'Display',
        run: () => {
          setScreenHue('red_tactical')
          return ok('Red tactical mode enabled.')
        },
      },
      {
        id: 'low light',
        label: 'Display: low light',
        aliases: ['low light mode', 'dim mode'],
        paletteVisible: true,
        group: 'Display',
        run: () => {
          setScreenHue('low_light')
          return ok('Low light mode enabled.')
        },
      },
      {
        id: 'bright',
        label: 'Display: bright day',
        aliases: ['bright mode', 'bright day', 'day mode', 'normal mode', 'daylight mode'],
        paletteVisible: true,
        group: 'Display',
        run: () => {
          setScreenHue('bright_day')
          return ok('Bright mode enabled.')
        },
      },
      {
        id: 'reset',
        label: 'Reset panel layout',
        aliases: ['reset layout'],
        paletteVisible: true,
        group: 'Display',
        run: () => {
          resetLayout()
          return ok('Panel layout reset.')
        },
      },

      // Panels
      {
        id: 'weather panel',
        label: 'Open weather panel',
        aliases: ['open weather', 'open weather panel'],
        paletteVisible: true,
        group: 'Panels',
        run: () => {
          updatePanel('weather', { docked: false, minimized: false })
          raisePanel('weather')
          return ok('Weather panel opened.')
        },
      },
      {
        id: 'location panel',
        label: 'Open situation panel',
        aliases: ['open location', 'open location panel', 'open situation', 'open situation panel'],
        paletteVisible: true,
        group: 'Panels',
        run: () => {
          updatePanel('positional', { docked: false, minimized: false })
          raisePanel('positional')
          return ok('Situation panel opened.')
        },
      },
      {
        id: 'voice panel',
        label: 'Open voice panel',
        aliases: ['open voice', 'open voice panel'],
        paletteVisible: true,
        group: 'Panels',
        run: () => {
          updatePanel('voice', { docked: false, minimized: false })
          raisePanel('voice')
          return ok('Voice panel opened.')
        },
      },
      {
        id: 'contacts panel',
        label: 'Open emergency contacts panel',
        aliases: ['open contacts', 'open emergency contacts', 'preflight panel'],
        paletteVisible: true,
        group: 'Panels',
        run: () => {
          updatePanel('preflight', { docked: false, minimized: false })
          raisePanel('preflight')
          return ok('Emergency contacts panel opened.')
        },
      },
      {
        id: 'checkin panel',
        label: 'Open routine check-in panel',
        aliases: ['open check in', 'check in panel', 'routine check in', 'beacon panel'],
        paletteVisible: true,
        group: 'Panels',
        run: () => {
          updatePanel('checkin', { docked: false, minimized: false })
          raisePanel('checkin')
          return ok('Routine check-in panel opened.')
        },
      },
      {
        id: 'panel minimize',
        label: 'Minimize voice panel',
        aliases: ['minimize panel'],
        group: 'Panels',
        run: () => {
          updatePanel('voice', { minimized: true })
          return ok('Voice panel minimized.')
        },
      },
      {
        id: 'panel maximize',
        label: 'Maximize voice panel',
        aliases: ['maximize panel', 'restore panel'],
        group: 'Panels',
        run: () => {
          updatePanel('voice', { minimized: false, docked: false })
          raisePanel('voice')
          return ok('Voice panel maximized.')
        },
      },

      // Weather
      {
        id: 'weather refresh',
        label: 'Refresh weather',
        aliases: ['refresh weather'],
        paletteVisible: true,
        group: 'Weather',
        run: async () => {
          const w = await fetchWeather(gps.lat, gps.lng)
          window.dispatchEvent(new CustomEvent('hud:weather-refresh'))
          if ('error' in w) return fail(`Unable to refresh weather: ${w.error}`)
          return ok('Weather refreshed.')
        },
      },
      {
        id: 'weather',
        label: 'Current weather',
        aliases: ['current weather'],
        group: 'Weather',
        run: async () => {
          const w = await fetchWeather(gps.lat, gps.lng)
          window.dispatchEvent(new CustomEvent('hud:weather-refresh'))
          if ('error' in w) return fail(`Unable to get weather: ${w.error}`)
          // Force explicit "miles per hour" for TTS pronunciation. Some
          // engines (notably iOS Safari / WebKit) mishandle the "mph" /
          // "mp/h" abbreviations and produce "meters per hour" — the
          // explicit phrase is unambiguous across all engines and
          // matches US imperial field defaults.
          return ok(
            `Current weather for ${w.location}: ${w.condition}, ${w.temperature} ${w.unit.replace('°', 'degrees ')}, wind ${Math.round(w.windSpeed)} miles per hour.`,
          )
        },
      },
      {
        id: 'mute',
        label: 'Mute voice feedback',
        aliases: ['mute voice', 'silence'],
        group: 'Status',
        run: () => {
          try {
            window.speechSynthesis?.cancel()
            sessionStorage.setItem('hud_voice_muted', '1')
          } catch {
            // noop
          }
          return ok('Voice feedback muted.')
        },
      },
      {
        id: 'unmute',
        label: 'Unmute voice feedback',
        aliases: ['unmute voice'],
        group: 'Status',
        run: () => {
          try {
            sessionStorage.setItem('hud_voice_muted', '0')
          } catch {
            // noop
          }
          return ok('Voice feedback unmuted.')
        },
      },
      {
        id: 'diagnostics',
        label: 'Open diagnostics',
        aliases: ['show diagnostics', 'debug overlay'],
        group: 'Status',
        run: () => {
          try {
            localStorage.setItem('hud_runtime_overlay', '1')
          } catch {
            // noop
          }
          updatePanel('preflight', { docked: false, minimized: false })
          raisePanel('preflight')
          return ok('Diagnostics opened.')
        },
      },

      // Tier stubs (kept for parity with legacy voice directory)
      { id: 'fire', label: 'Fire (stub)', group: 'Tier 2', run: () => ok('Coming in Tier 2.') },
      { id: 'water', label: 'Water (stub)', group: 'Tier 2', run: () => ok('Coming in Tier 2.') },
      {
        id: 'deadman',
        label: 'Deadman (stub)',
        group: 'Tier 2',
        run: () => ok('Coming in Tier 2.'),
      },
      ...(['ai route', 'biometric', 'forage', 'lidar', 'ar'] as const).map((id) => ({
        id,
        label: `${id} (stub)`,
        group: 'Tier 3',
        run: () => ok('Coming in Tier 3.'),
      })),
    ]
  }, [
    addWaypoint,
    attachedPin,
    flashlightCapability.permission,
    flashlightCapability.supportState,
    gps.lat,
    gps.lng,
    gps.locationState,
    gps.accuracy,
    gps.elevation,
    map,
    raisePanel,
    removeWaypoint,
    resetLayout,
    setScreenHue,
    setWaypoints,
    state.waypoints,
    updatePanel,
  ])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const requiredCommands = [
      'flashlight on',
      'flashlight off',
      'flashlight toggle',
      'morse toggle',
      'weather',
      'zoom in',
      'zoom out',
      'center',
      'night',
      'bright',
      'status',
      'sos',
      'sos confirm',
      'drop waypoint',
      'clear trail',
      'check in',
      'start beacon',
      'stop beacon',
    ]
    const rows = requiredCommands.map((command) => {
      const hit = commands.find((c) => c.id === command || (c.aliases ?? []).includes(command))
      return {
        command,
        parsed: Boolean(hit),
        wired: Boolean(hit?.run),
        runtimeAction: hit ? `dispatch:${hit.id}` : 'none',
        effect: hit ? 'handler-attached' : 'missing',
        issue: hit ? '' : 'missing handler',
        pass: Boolean(hit?.run),
      }
    })
    console.table(rows)
  }, [commands])

  const dispatch = useCallback(
    async (
      cmd: string,
      source: CommandSource,
      rawTranscript?: string,
    ): Promise<CommandResult> => {
      const norm = normalize(cmd)
      const heard = rawTranscript ?? cmd

      // Phase 1: requested. Execution entry exists from this point on,
      // even for empty / unknown phrases, so failure modes are visible.
      const execId = reportCommandStarted({ source, transcript: heard, normalized: norm })
      traceAction(`command:${norm || 'empty'}`, 'handler_enter', { source })

      const finalize = (
        result: CommandResult,
        match: { id: string | null; alias: string | null },
        reason: 'ok' | 'empty' | 'unknown' | 'handler-fail' | 'error',
      ) => {
        recordCommandDispatch({
          cmd: norm || cmd,
          source,
          ok: result.ok,
          message: result.message,
          ts: Date.now(),
        })
        recordVoiceParserEvent({
          heard,
          normalized: norm,
          matchedAlias: match.alias,
          commandId: match.id,
          source,
          result: result.ok ? 'executed' : 'rejected',
          reason: result.ok ? 'ok' : reason,
          message: result.message,
        })
        return result
      }

      if (!norm) {
        traceAction('command:empty', 'guard_reject', { reason: 'empty_command' })
        reportCommandRejected(execId, 'invalid_state', 'Empty command.')
        return finalize(fail('Empty command.'), { id: null, alias: null }, 'empty')
      }

      let matchedAlias: string | null = null
      const found = commands.find((c) => {
        if (c.id === norm) {
          matchedAlias = c.id
          return true
        }
        const alias = (c.aliases ?? []).find((a) => a === norm)
        if (alias) {
          matchedAlias = alias
          return true
        }
        return false
      })

      if (!found) {
        traceAction(`command:${norm}`, 'guard_reject', { reason: 'unknown_command' })
        reportCommandRejected(execId, 'missing_handler', `Unknown command: ${norm}.`)
        return finalize(
          fail(`Unknown command: ${norm}.`),
          { id: null, alias: null },
          'unknown',
        )
      }

      if (source === 'voice' && !isVoiceOperationalCommandId(found.id)) {
        traceAction(`command:${found.id}`, 'guard_reject', { reason: 'voice_operational_only' })
        reportCommandRejected(execId, 'invalid_state', 'That command is not available on voice.')
        return finalize(
          fail('Voice channel runs field actions only. Use the command palette for panels and navigation.'),
          { id: found.id, alias: matchedAlias },
          'unknown',
        )
      }

      // Phase 2: handler resolved → executing.
      markCommandResolving(execId, found.id)

      try {
        traceAction(`command:${found.id}`, 'async_start', { source, alias: matchedAlias })
        const result = await found.run({ source })

        if (!result.ok) {
          // Handler-reported failure: classify reason from message.
          const reason = classifyFailureFromMessage(result.message)
          reportCommandFailure(execId, reason, result.message)
          traceAction(`command:${found.id}`, 'failure', { reason, message: result.message })
          return finalize(
            result,
            { id: found.id, alias: matchedAlias },
            'handler-fail',
          )
        }

        // Phase 3: handler returned ok. Schedule a non-blocking
        // verification race; the user-facing dispatch returns now.
        const verifier = getCommandVerifier(found.id)
        if (!verifier) {
          // Best-effort: handler said ok, no specific verifier registered.
          reportCommandSuccess(execId, {
            verification: 'unverified_ok',
            message: result.message,
          })
          traceAction(`command:${found.id}`, 'state_result', {
            ok: true,
            verification: 'unverified_ok',
          })
        } else {
          // Race verifier vs 1500 ms timeout; the runtime snapshot is the
          // single resolver — neither path can double-report because
          // `report*` helpers no-op once the entry's status leaves
          // 'executing' (history is searched by id). Use a guard to
          // avoid races between verifier resolution and timeout.
          const TIMEOUT_MS = 1500
          let resolved = false
          const timer = window.setTimeout(() => {
            if (resolved) return
            resolved = true
            reportCommandTimeout(execId)
          }, TIMEOUT_MS)
          Promise.resolve(verifier({ commandId: found.id, message: result.message })).then(
            (vr) => {
              if (resolved) return
              resolved = true
              window.clearTimeout(timer)
              if (vr.ok) {
                reportCommandSuccess(execId, {
                  verification: 'verified',
                  message: result.message,
                })
                traceAction(`command:${found.id}`, 'async_complete', {
                  verification: 'verified',
                })
              } else {
                reportCommandFailure(execId, vr.reason, result.message)
                traceAction(`command:${found.id}`, 'failure', {
                  reason: vr.reason,
                  phase: 'verification',
                })
              }
            },
            (err) => {
              if (resolved) return
              resolved = true
              window.clearTimeout(timer)
              reportCommandFailure(
                execId,
                'verification_failed',
                (err as Error)?.message ?? 'verifier threw',
              )
              traceAction(`command:${found.id}`, 'failure', {
                reason: 'verification_failed',
                phase: 'verification_throw',
              })
            },
          )
        }

        traceAction(`command:${found.id}`, 'state_result', { ok: true, message: result.message })
        return finalize(result, { id: found.id, alias: matchedAlias }, 'ok')
      } catch (err) {
        const message = (err as Error).message ?? 'unknown error'
        reportCommandFailure(execId, 'invalid_state', `Command failed: ${message}.`)
        traceAction(`command:${found.id}`, 'failure', {
          reason: 'handler_throw',
          message,
        })
        return finalize(
          fail(`Command failed: ${message}.`),
          { id: found.id, alias: matchedAlias },
          'error',
        )
      }
    },
    [commands],
  )

  return { commands, dispatch }
}
