import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppContext } from '../context/AppContext'
import { useMissionSync } from '../context/MissionSyncContext'
import { parseTeamMessageVoice } from '../lib/missionSync/teamComms'
import { tryHandleMissionCommsVoice } from '../lib/missionSync/missionCommsVoiceBridge'
import { useCockpit } from '../context/CockpitContext'
import { useOverlayContext } from '../context/OverlayContext'
import { useMapContext } from '../context/MapContext'
import { usePanelData } from '../context/PanelDataContext'
import type { LayerType } from '../types'
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
import { normalizeVoiceTranscript } from '../lib/voice/normalizeVoiceTranscript'
import { buildOverlayVoiceCommands } from '../lib/environmentalOverlays/overlayVoiceCommands'
import {
  buildAiRouteVoiceMessage,
  buildArVoiceMessage,
  buildBiometricVoiceMessage,
  buildForageSeasonalTip,
  buildLidarVoiceMessage,
  fireConditionsVoiceMessage,
  formatDeadManVoiceMessage,
  readDeadManVoiceStatus,
  waterConditionsVoiceMessage,
} from '../lib/environmentalVoice'

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
  run: (ctx: {
    source: CommandSource
    /** Full phrase heard (voice) or typed command line. */
    rawTranscript?: string
  }) => Promise<CommandResult> | CommandResult
}

function normalize(input: string): string {
  return normalizeVoiceTranscript(input)
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
  const { state, addWaypoint, removeWaypoint, setWaypoints, setLayer } = useAppContext()
  const { setScreenHue, resetLayout, raisePanel, updatePanel } = useCockpit()
  const { setEnabled: setOverlayEnabled } = useOverlayContext()
  const panelData = usePanelData()
  const missionSync = useMissionSync()

  const raiseLayersPanel = useCallback(() => {
    updatePanel('layers', { docked: false, minimized: false })
    raisePanel('layers')
  }, [raisePanel, updatePanel])

  const [attachedPinId, setAttachedPinId] = useState<string | null>(null)
  const [morseEnabled, setMorseEnabled] = useState(false)
  const [flashlightEnabled, setFlashlightEnabled] = useState(false)

  // Listen for SOS panel state echoes so spoken/textual responses stay accurate.
  useEffect(() => {
    const onMorseState = (ev: Event) => {
      const detail = (ev as CustomEvent<{ enabled?: boolean }>).detail
      if (typeof detail?.enabled === 'boolean') setMorseEnabled(detail.enabled)
    }
    const onFlashlightState = (ev: Event) => {
      const detail = (ev as CustomEvent<{ enabled?: boolean }>).detail
      if (typeof detail?.enabled === 'boolean') setFlashlightEnabled(detail.enabled)
    }
    window.addEventListener('hud:sos-morse-state', onMorseState)
    window.addEventListener('hud:sos-flashlight-state', onFlashlightState)
    return () => {
      window.removeEventListener('hud:sos-morse-state', onMorseState)
      window.removeEventListener('hud:sos-flashlight-state', onFlashlightState)
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
        run: () =>
          ok('Navigation, route, status, display, and safety commands are available.'),
      },

      // Navigation
      {
        id: 'center',
        label: 'Center map on GPS',
        aliases: ['center map', 'center gps'],
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
        id: 'next waypoint',
        label: 'Center on first route pin',
        aliases: [
          'move to next waypoint',
          'go to next waypoint',
          'center next waypoint',
          'first waypoint',
          'first pin',
        ],
        group: 'Route',
        run: () => {
          const first = state.waypoints[0]
          if (!first) return fail('No route pins. Add pins first.')
          if (!map) return fail('Map unavailable.')
          map.easeTo({
            center: [first.lng, first.lat],
            zoom: Math.max(14, map.getZoom()),
            duration: 520,
            essential: true,
          })
          return ok(`Centered on ${first.label}, first pin in route.`)
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
        run: () => {
          window.dispatchEvent(new CustomEvent('hud:sos-arm'))
          raisePanel('sos')
          updatePanel('sos', { minimized: false, docked: false })
          return ok('Emergency protocol armed. SOS panel activated.')
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
        group: 'Safety',
        run: () => {
          window.dispatchEvent(new CustomEvent('hud:sos-flashlight', { detail: { enabled: true } }))
          return ok(
            flashlightRef.current
              ? 'Flashlight is already on.'
              : 'Flashlight is currently off. Turning on device flash.',
          )
        },
      },
      {
        id: 'flashlight off',
        label: 'Flashlight off',
        group: 'Safety',
        run: () => {
          window.dispatchEvent(new CustomEvent('hud:sos-flashlight', { detail: { enabled: false } }))
          return ok(
            flashlightRef.current
              ? 'Flashlight is currently on. Turning off device flash.'
              : 'Flashlight is already off.',
          )
        },
      },

      // Map baselayers (streets, topo, outdoor, satellite)
      ...(['streets', 'topo', 'outdoor', 'satellite'] as const).map((layer) => ({
        id: `${layer} map`,
        label: `Basemap: ${layer}`,
        aliases: [
          `${layer} layer`,
          `${layer} basemap`,
          `map ${layer}`,
          ...(layer === 'topo' ? (['topographic map', 'topo map'] as const) : []),
          ...(layer === 'satellite' ? (['satellite layer', 'sat map'] as const) : []),
        ],
        group: 'Map',
        run: () => {
          setLayer(layer as LayerType)
          const label = layer.charAt(0).toUpperCase() + layer.slice(1)
          return ok(`${label} basemap selected.`)
        },
      })),

      ...buildOverlayVoiceCommands({
        setEnabled: setOverlayEnabled,
        raiseLayersPanel,
      }),

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
        aliases: ['bright mode', 'bright day', 'day mode'],
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
        id: 'situation',
        label: 'Read situation panel',
        aliases: ['read situation', 'situation report', 'situation status'],
        group: 'Status',
        run: () => {
          const parts: string[] = []
          const tz =
            panelData.locationTimeZone ??
            (typeof Intl !== 'undefined'
              ? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
              : 'UTC')
          parts.push(
            `Time ${new Intl.DateTimeFormat('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: tz,
            }).format(new Date())}`,
          )
          if (panelData.elevationMeters != null) {
            parts.push(
              `Elevation ${Math.round(panelData.elevationMeters * 3.28084).toLocaleString('en-US')} feet`,
            )
          } else if (panelData.elevationLoading) {
            parts.push('Elevation loading')
          }
          const wx = panelData.weather
          if (wx && !('error' in wx)) {
            const humidityPhrase = wx.humidity > 0 ? `, humidity ${wx.humidity} percent` : ''
            parts.push(
              `Weather ${wx.condition}, ${wx.temperature} ${wx.unit.replace('°', 'degrees ')}, wind ${Math.round(wx.windSpeed)} miles per hour${humidityPhrase}`,
            )
          } else if (panelData.weatherLoading) {
            parts.push('Weather loading')
          } else if (wx && 'error' in wx) {
            parts.push('Weather unavailable')
          }
          const lat = panelData.userLocation?.lat ?? gps.lat
          const lng = panelData.userLocation?.lng ?? gps.lng
          if (gps.locationState === 'granted' && lat != null && lng != null) {
            parts.push(
              `GPS on, latitude ${lat.toFixed(4)}, longitude ${lng.toFixed(4)}, accuracy ${gps.accuracy != null ? `${Math.round(gps.accuracy)} meters` : 'unknown'}`,
            )
            if (gps.elevation != null && Number.isFinite(gps.elevation)) {
              parts.push(`GPS altitude ${Math.round(gps.elevation * 3.28084)} feet`)
            }
          } else if (gps.locationState === 'idle') {
            parts.push('Location off')
          } else if (gps.locationState === 'denied') {
            parts.push('Location denied')
          } else {
            parts.push('GPS unavailable')
          }
          return ok(parts.join('. ') + '.')
        },
      },
      {
        id: 'situation panel',
        label: 'Open situation panel',
        aliases: [
          'open situation',
          'open situation panel',
          'open location',
          'open location panel',
          'location panel',
        ],
        paletteVisible: true,
        group: 'Panels',
        run: () => {
          updatePanel('situation', { docked: false, minimized: false })
          raisePanel('situation')
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
        id: 'check in panel',
        label: 'Open check-in panel',
        aliases: ['open check in', 'check in', 'check-in panel'],
        paletteVisible: true,
        group: 'Panels',
        run: () => {
          updatePanel('checkin', { docked: false, minimized: false })
          raisePanel('checkin')
          return ok('Check-in panel opened.')
        },
      },
      {
        id: 'mission panel',
        label: 'Open mission link panel',
        aliases: ['open mission', 'mission link', 'open mission link'],
        paletteVisible: true,
        group: 'Panels',
        run: () => {
          updatePanel('missionLink', { docked: false, minimized: false })
          raisePanel('missionLink')
          return ok('Mission link panel opened.')
        },
      },
      {
        id: 'team check in',
        label: 'Send team check-in OK',
        aliases: ['team checkin', 'send team check in', 'mesh check in'],
        paletteVisible: true,
        group: 'Mission',
        run: () => {
          if (missionSync.role !== 'member') {
            return fail('Start or join a field mission first.')
          }
          if (!missionSync.teamCommsReady) {
            return fail('Link a teammate on the mission mesh first.')
          }
          missionSync.sendTeamCheckIn()
          return ok('Team check-in sent.')
        },
      },
      {
        id: 'wearables panel',
        label: 'Open wearables panel',
        aliases: ['open wearables', 'wearables', 'companion devices', 'smartwatch panel'],
        paletteVisible: true,
        group: 'Panels',
        run: () => {
          updatePanel('wearables', { docked: false, minimized: false })
          raisePanel('wearables')
          return ok('Wearables panel opened.')
        },
      },
      {
        id: 'deadman panel',
        label: 'Open deadman panel',
        aliases: ['open deadman', 'open dead man'],
        group: 'Safety',
        run: () => {
          updatePanel('deadman', { docked: false, minimized: false })
          raisePanel('deadman')
          return ok('Deadman panel opened.')
        },
      },
      {
        id: 'deadman',
        label: 'Deadman status',
        aliases: ['dead man', 'deadman status', 'dead man status'],
        group: 'Safety',
        run: () => {
          updatePanel('deadman', { docked: false, minimized: false })
          raisePanel('deadman')
          return ok(formatDeadManVoiceMessage(readDeadManVoiceStatus()))
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
          const humidityPhrase =
            w.humidity > 0 ? `, humidity ${w.humidity} percent` : ''
          return ok(
            `Current weather for ${w.location}: ${w.condition}, ${w.temperature} ${w.unit.replace('°', 'degrees ')}, wind ${Math.round(w.windSpeed)} miles per hour${humidityPhrase}.`,
          )
        },
      },

      {
        id: 'fire',
        label: 'Fire conditions brief',
        aliases: ['fire status', 'fire risk'],
        group: 'Environmental',
        run: async () => {
          const result = await fireConditionsVoiceMessage({
            lat: gps.lat,
            lng: gps.lng,
            cachedWeather: panelData.weather,
            fetchWeather,
          })
          if (!result.ok) return fail(result.message)
          updatePanel('weather', { docked: false, minimized: false })
          raisePanel('weather')
          window.dispatchEvent(new CustomEvent('hud:weather-refresh'))
          return ok(result.message)
        },
      },
      {
        id: 'water',
        label: 'Water crossing brief',
        aliases: ['water status', 'stream conditions', 'hydro'],
        group: 'Environmental',
        run: async () => {
          const result = await waterConditionsVoiceMessage({
            lat: gps.lat,
            lng: gps.lng,
            cachedWeather: panelData.weather,
            fetchWeather,
          })
          if (!result.ok) return fail(result.message)
          updatePanel('weather', { docked: false, minimized: false })
          raisePanel('weather')
          window.dispatchEvent(new CustomEvent('hud:weather-refresh'))
          return ok(result.message)
        },
      },
      {
        id: 'ai route',
        label: 'Route planning status',
        aliases: ['ai reroute', 'smart route'],
        group: 'Route',
        run: () => {
          const total = totalRouteDistance(state.waypoints.map((w) => ({ lat: w.lat, lng: w.lng })))
          updatePanel('waypoints', { docked: false, minimized: false })
          raisePanel('waypoints')
          return ok(buildAiRouteVoiceMessage(state.waypoints.length, total.miles))
        },
      },
      {
        id: 'biometric',
        label: 'Biometric status',
        aliases: ['heart rate', 'vitals'],
        group: 'Status',
        run: async () => {
          const nav = navigator as Navigator & { getBattery?: () => Promise<{ level?: number }> }
          let batteryPercent: number | null = null
          if (nav.getBattery) {
            try {
              const b = await nav.getBattery()
              batteryPercent = Math.round((b.level ?? 0) * 100)
            } catch {
              batteryPercent = null
            }
          }
          const { getHealthConnectCache } = await import('../lib/wearables/healthConnectClient')
          const { buildHealthBiometricLine } = await import('../lib/wearables/healthConnectFormat')
          return ok(buildBiometricVoiceMessage(batteryPercent, buildHealthBiometricLine(getHealthConnectCache())))
        },
      },
      {
        id: 'forage',
        label: 'Seasonal foraging tip',
        aliases: ['foraging', 'morels'],
        group: 'Environmental',
        run: () => ok(buildForageSeasonalTip()),
      },
      {
        id: 'lidar',
        label: 'Trail / LiDAR status',
        aliases: ['ghost trail', 'ghost trails'],
        group: 'Navigation',
        run: () => ok(buildLidarVoiceMessage(state.snapToTrailEnabled)),
      },
      {
        id: 'ar',
        label: 'AR HUD status',
        aliases: ['augmented reality', 'ar hud'],
        group: 'Display',
        run: () => ok(buildArVoiceMessage()),
      },
    ]
  }, [
    addWaypoint,
    attachedPin,
    gps.accuracy,
    gps.elevation,
    gps.lat,
    gps.lng,
    gps.locationState,
    map,
    panelData.elevationLoading,
    panelData.elevationMeters,
    panelData.locationTimeZone,
    panelData.userLocation,
    panelData.weather,
    panelData.weatherLoading,
    raiseLayersPanel,
    raisePanel,
    removeWaypoint,
    setOverlayEnabled,
    resetLayout,
    setLayer,
    setScreenHue,
    setWaypoints,
    state.waypoints,
    state.snapToTrailEnabled,
    updatePanel,
    missionSync,
  ])

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

      const missionVoice = await tryHandleMissionCommsVoice(norm)
      if (missionVoice) {
        markCommandResolving(execId, 'team message')
        if (missionVoice.ok) reportCommandSuccess(execId, { verification: 'unverified_ok', message: 'ok' })
        else reportCommandFailure(execId, 'invalid_state', missionVoice.feedback)
        return finalize(
          missionVoice.ok ? ok(missionVoice.feedback) : fail(missionVoice.feedback),
          { id: 'team message', alias: 'team message' },
          missionVoice.ok ? 'ok' : 'handler-fail',
        )
      }

      const teamParsed = parseTeamMessageVoice(norm, heard)
      if (teamParsed) {
        markCommandResolving(execId, 'team message')
        if (missionSync.role === 'idle') {
          reportCommandRejected(execId, 'invalid_state', 'Mission not active.')
          return finalize(
            fail('Start or join a mission to send team messages.'),
            { id: 'team message', alias: 'team message' },
            'handler-fail',
          )
        }
        if (!missionSync.teamCommsReady) {
          reportCommandRejected(execId, 'invalid_state', 'Mesh not ready.')
          return finalize(
            fail('Link a teammate first — mesh messages work offline on the same Wi‑Fi.'),
            { id: 'team message', alias: 'team message' },
            'handler-fail',
          )
        }
        missionSync.queueOutboundConfirm(teamParsed.text, teamParsed.callsign)
        reportCommandSuccess(execId, { verification: 'unverified_ok', message: 'queued' })
        return finalize(
          ok('Say accept to send, or cancel.'),
          { id: 'team message', alias: 'team message' },
          'ok',
        )
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

      // Phase 2: handler resolved → executing.
      markCommandResolving(execId, found.id)

      try {
        traceAction(`command:${found.id}`, 'async_start', { source, alias: matchedAlias })
        const result = await found.run({ source, rawTranscript: heard })

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
    [commands, missionSync, raisePanel, updatePanel],
  )

  return { commands, dispatch }
}
