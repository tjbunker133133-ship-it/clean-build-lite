import { parseDeadManStorageRaw } from '../hooks/useDeadMan'
import type { WeatherResult } from './weather'

const DEADMAN_STORAGE_KEY = 'trailmap_deadman_v1'

export type DeadManVoiceStatus = {
  armed: boolean
  remainingMs: number
  expired: boolean
  durationMs: number
}

export function readDeadManVoiceStatus(nowMs = Date.now()): DeadManVoiceStatus {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(DEADMAN_STORAGE_KEY)
  } catch {
    raw = null
  }
  const stored = parseDeadManStorageRaw(raw)
  const durationMs =
    typeof stored?.durationMs === 'number' && Number.isFinite(stored.durationMs)
      ? stored.durationMs
      : 2 * 60 * 60 * 1000
  if (stored?.armed !== true || typeof stored.expiresAt !== 'number') {
    return { armed: false, remainingMs: 0, expired: false, durationMs }
  }
  const remainingMs = Math.max(0, stored.expiresAt - nowMs)
  return {
    armed: true,
    remainingMs,
    expired: remainingMs <= 0,
    durationMs,
  }
}

function formatDurationMs(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(totalMin / 60)
  const minutes = totalMin % 60
  if (hours > 0 && minutes > 0) return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minutes`
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

export function formatDeadManVoiceMessage(status: DeadManVoiceStatus): string {
  if (!status.armed) {
    return 'Deadman timer is off. Tap ARM TIMER on the Deadman panel to start.'
  }
  if (status.expired) {
    return 'Deadman timer expired. Open the Deadman panel for dispatch status.'
  }
  return `Deadman active. ${formatDurationMs(status.remainingMs)} remaining.`
}

function isPrecipWeather(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 71 && code <= 77) || code >= 80
}

function isStormWeather(code: number): boolean {
  return code >= 95
}

export function buildFireConditionsBrief(
  wx: Exclude<WeatherResult, { error: string }>,
): string {
  const parts: string[] = []
  parts.push(
    `Conditions: ${wx.condition}, ${wx.temperature}${wx.unit.replace('°', ' degrees ')}, wind ${Math.round(wx.windSpeed)} miles per hour`,
  )
  if (wx.humidity > 0) parts.push(`humidity ${wx.humidity} percent`)
  const risks: string[] = []
  if (wx.humidity > 0 && wx.humidity < 30) risks.push('low humidity')
  if (wx.windSpeed >= 20) risks.push('elevated wind')
  if (isStormWeather(wx.weatherCode)) risks.push('thunderstorm activity')
  if (risks.length > 0) {
    parts.push(`Fire-relevant factors: ${risks.join(', ')}`)
  } else {
    parts.push('No elevated fire factors from current weather.')
  }
  parts.push(
    'Say show fire map to toggle NASA FIRMS hotspots on the map, or open the Map panel.',
  )
  return parts.join('. ') + '.'
}

export function buildWaterConditionsBrief(
  wx: Exclude<WeatherResult, { error: string }>,
): string {
  const parts: string[] = []
  parts.push(
    `Conditions: ${wx.condition}, ${wx.temperature}${wx.unit.replace('°', ' degrees ')}, wind ${Math.round(wx.windSpeed)} miles per hour`,
  )
  if (isPrecipWeather(wx.weatherCode)) {
    parts.push('Active precipitation in forecast — expect higher streamflow and slick crossings.')
  } else {
    parts.push('No active precipitation in current conditions.')
  }
  parts.push('Check USGS streamgages before water crossings.')
  return parts.join('. ') + '.'
}

export function buildForageSeasonalTip(monthIndex = new Date().getMonth()): string {
  if (monthIndex >= 3 && monthIndex <= 5) {
    return 'Spring foraging window: morels often appear near riparian cottonwoods and recent burn scars. Always ID with an expert — not foraging advice.'
  }
  if (monthIndex >= 6 && monthIndex <= 8) {
    return 'Summer: berry season in many zones. Avoid unknown mushrooms and respect local regulations. Always ID with an expert.'
  }
  if (monthIndex >= 9 && monthIndex <= 10) {
    return 'Fall: late-season berries and nuts in some areas. Verify species and land access before harvesting.'
  }
  return 'Winter: limited foraging. Focus on trail safety and cached route planning. Full foraging AI is not in this build.'
}

export function buildAiRouteVoiceMessage(pinCount: number, routeMiles: number): string {
  if (pinCount < 2) {
    return 'AI reroute is not in this build. Add at least two waypoints for manual route planning.'
  }
  return `AI reroute is not in this build. Current route has ${pinCount} pins, ${routeMiles.toFixed(1)} miles. Use Navigation HUD for off-route and arrival prompts.`
}

export function buildBiometricVoiceMessage(
  batteryPercent: number | null,
  healthLine?: string | null,
): string {
  const base =
    batteryPercent != null
      ? `Device battery ${batteryPercent} percent.`
      : 'Battery level unavailable on this device.'
  if (healthLine?.trim()) {
    return `${base} ${healthLine.trim()}`
  }
  if (batteryPercent != null) {
    return `${base} Link Health Connect in the Wearables panel on the Android field APK for advisory heart rate and steps.`
  }
  return `${base} Biometric coaching uses Health Connect on the Android field APK only.`
}

export function buildLidarVoiceMessage(snapToTrailEnabled: boolean): string {
  if (snapToTrailEnabled) {
    return 'Snap-to-trail is on. LiDAR ghost trails are not in this build — use map trail layers and trail inspect.'
  }
  return 'LiDAR ghost trails are not in this build. Enable snap-to-trail in Navigation for trail-aware positioning.'
}

export function buildArVoiceMessage(): string {
  return 'AR HUD overlay is not in this build. Use map, compass, and Navigation HUD for field orientation.'
}

async function resolveWeatherForBrief(
  lat: number | null,
  lng: number | null,
  cached: WeatherResult | null | undefined,
  fetchWeather: (lat: number, lng: number) => Promise<WeatherResult>,
): Promise<Exclude<WeatherResult, { error: string }> | { error: string }> {
  if (lat == null || lng == null) return { error: 'GPS fix required.' }
  if (cached && !('error' in cached)) return cached
  return fetchWeather(lat, lng)
}

export async function fireConditionsVoiceMessage(args: {
  lat: number | null
  lng: number | null
  cachedWeather?: WeatherResult | null
  fetchWeather: (lat: number, lng: number) => Promise<WeatherResult>
}): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const wx = await resolveWeatherForBrief(
    args.lat,
    args.lng,
    args.cachedWeather,
    args.fetchWeather,
  )
  if ('error' in wx) return { ok: false, message: `Fire brief unavailable: ${wx.error}` }
  return { ok: true, message: buildFireConditionsBrief(wx) }
}

export async function waterConditionsVoiceMessage(args: {
  lat: number | null
  lng: number | null
  cachedWeather?: WeatherResult | null
  fetchWeather: (lat: number, lng: number) => Promise<WeatherResult>
}): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const wx = await resolveWeatherForBrief(
    args.lat,
    args.lng,
    args.cachedWeather,
    args.fetchWeather,
  )
  if ('error' in wx) return { ok: false, message: `Water brief unavailable: ${wx.error}` }
  return { ok: true, message: buildWaterConditionsBrief(wx) }
}
