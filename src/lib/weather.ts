export type WeatherResult =
  | {
      temperature: number
      humidity: number
      windSpeed: number
      condition: string
      unit: string
      windUnit: string
      location: string
      weatherCode: number
      updatedAt: number
      /** IANA zone from Open-Meteo when `timezone=auto` (for location-based clock). */
      timeZone?: string
    }
  | { error: string }

const WEATHER_CACHE_KEY = 'titanium_weather_cache_v2'
const WEATHER_CACHE_KEY_LEGACY = 'titanium_weather_cache_v1'
const LOCATION_LABEL_CACHE_KEY = 'titanium_weather_location_v1'
const NOMINATIM_UA = 'SignalOneHUD/1.0 (field weather; contact: support@signal-one.local)'

function locationCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`
}

function readCachedLocationLabel(lat: number, lon: number): string | null {
  try {
    const raw = localStorage.getItem(LOCATION_LABEL_CACHE_KEY)
    if (!raw) return null
    const map = JSON.parse(raw) as Record<string, string>
    return map[locationCacheKey(lat, lon)] ?? null
  } catch {
    return null
  }
}

function writeCachedLocationLabel(lat: number, lon: number, label: string): void {
  try {
    const key = locationCacheKey(lat, lon)
    const raw = localStorage.getItem(LOCATION_LABEL_CACHE_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    map[key] = label
    localStorage.setItem(LOCATION_LABEL_CACHE_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

function weatherFromCache(staleOkMs: number, suffix = '(cached)'): WeatherResult | null {
  const c = readCachedWeather(staleOkMs)
  if (!c || 'error' in c) return null
  return { ...c, condition: suffix ? `${c.condition} ${suffix}`.trim() : c.condition }
}

/** Last-known-good weather for instant panel render (no API key required). */
export function readCachedWeather(maxAgeMs = 3_600_000): WeatherResult | null {
  for (const key of [WEATHER_CACHE_KEY, WEATHER_CACHE_KEY_LEGACY]) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const c = JSON.parse(raw) as Record<string, unknown>
      if (typeof c.temperature !== 'number') continue
      const updatedAt = typeof c.updatedAt === 'number' ? c.updatedAt : 0
      if (maxAgeMs > 0 && Date.now() - updatedAt > maxAgeMs) continue
      return {
        temperature: Math.round(c.temperature),
        humidity: typeof c.humidity === 'number' ? Math.round(c.humidity) : 0,
        windSpeed: Number(c.windSpeed ?? 0),
        condition: String(c.condition ?? 'Unknown conditions'),
        unit: String(c.unit ?? '°F'),
        windUnit: 'mph',
        location: String(c.location ?? ''),
        weatherCode: Number(c.weatherCode ?? -1),
        updatedAt,
        timeZone: typeof c.timeZone === 'string' ? c.timeZone : undefined,
      }
    } catch {
      // try next key
    }
  }
  return null
}

export function weatherDescription(code: number): string {
  const codes: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Rime fog',
    51: 'Light drizzle',
    53: 'Drizzle',
    55: 'Dense drizzle',
    61: 'Rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    71: 'Snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    95: 'Thunderstorm',
    96: 'Thunderstorm with hail',
    99: 'Severe thunderstorm',
  }
  return codes[code] ?? 'Unknown conditions'
}

async function reverseLocation(lat: number, lon: number, signal?: AbortSignal): Promise<string> {
  const cached = readCachedLocationLabel(lat, lon)
  if (cached) return cached

  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`,
      {
        signal,
        headers: { Accept: 'application/json', 'User-Agent': NOMINATIM_UA },
      },
    )
    if (r.status === 429) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
    if (!r.ok) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
    const data = await r.json()
    const a = data?.address ?? {}
    const city = a.city || a.town || a.village || a.hamlet || a.county
    const region = a.state || a.region
    const label =
      city && region
        ? `${city}, ${region}`
        : city
          ? String(city)
          : data?.display_name?.split(',').slice(0, 2).join(', ') || `${lat.toFixed(4)}, ${lon.toFixed(4)}`
    writeCachedLocationLabel(lat, lon, label)
    return label
  } catch {
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
  }
}

export type FetchWeatherOptions = { signal?: AbortSignal }

export async function fetchWeather(
  lat: number | null,
  lon: number | null,
  opts?: FetchWeatherOptions,
): Promise<WeatherResult> {
  const { signal } = opts ?? {}
  if (lat == null || lon == null) return { error: 'No GPS fix available' }
  try {
    const cachedLabel = readCachedLocationLabel(lat, lon)
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto`,
      { signal },
    )
    if (response.status === 429) {
      const stale = weatherFromCache(86_400_000, '(rate limited — cached)')
      if (stale) return stale
      return { error: 'Weather busy — wait a few minutes' }
    }
    if (!response.ok) {
      const stale = weatherFromCache(86_400_000)
      if (stale) return stale
      return { error: `Weather service error (${response.status})` }
    }
    const location =
      cachedLabel ?? (await reverseLocation(lat, lon, signal))
    const data = await response.json()
    const current = data?.current
    if (!current) return { error: 'No weather data' }

    const timeZone = typeof data.timezone === 'string' ? data.timezone : undefined

    // US imperial unit normalization. We explicitly request
    // `windspeed_unit=mph` from Open-Meteo, but the API returns the unit
    // STRING as the literal "mp/h" (with the slash). Several TTS engines
    // mispronounce that token (heard as "meters per hour" on iOS Safari
    // / WebKit). We override to a canonical "mph" string here so both
    // the panel render and the voice formatter agree on the same unit
    // and TTS engines speak it cleanly.
    const humidityRaw = current.relative_humidity_2m
    const humidity =
      humidityRaw != null && Number.isFinite(Number(humidityRaw))
        ? Math.round(Number(humidityRaw))
        : null

    const out = {
      temperature: Math.round(Number(current.temperature_2m ?? 0)),
      humidity: humidity ?? 0,
      windSpeed: Number(current.wind_speed_10m ?? 0),
      condition: weatherDescription(Number(current.weather_code ?? -1)),
      unit: String(data.current_units?.temperature_2m ?? '°F'),
      windUnit: 'mph',
      location,
      weatherCode: Number(current.weather_code ?? -1),
      updatedAt: Date.now(),
      ...(timeZone ? { timeZone } : {}),
    }

    try {
      localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(out))
    } catch {
      // ignore cache failures
    }
    return out
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      throw err
    }
    const stale = weatherFromCache(86_400_000)
    if (stale) return stale
    return { error: err instanceof Error ? err.message : 'Weather fetch failed' }
  }
}
