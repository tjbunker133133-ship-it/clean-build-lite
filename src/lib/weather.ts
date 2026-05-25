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
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`,
      { signal },
    )
    if (!r.ok) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
    const data = await r.json()
    const a = data?.address ?? {}
    const city = a.city || a.town || a.village || a.hamlet || a.county
    const region = a.state || a.region
    if (city && region) return `${city}, ${region}`
    if (city) return String(city)
    return data?.display_name?.split(',').slice(0, 2).join(', ') || `${lat.toFixed(4)}, ${lon.toFixed(4)}`
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
    const [response, location] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto`,
        { signal },
      ),
      reverseLocation(lat, lon, signal),
    ])
    if (!response.ok) return { error: `Weather service error (${response.status})` }
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
    try {
      const cached = localStorage.getItem(WEATHER_CACHE_KEY)
      if (cached) {
        const c = JSON.parse(cached)
        // Cache entries written prior to the windUnit normalization may
        // still contain the raw "mp/h" API value; force "mph" on read so
        // legacy caches do not resurface the TTS pronunciation issue.
        return {
          ...c,
          humidity: typeof c.humidity === 'number' ? c.humidity : 0,
          condition: `${c.condition} (cached)`,
          windUnit: 'mph',
        }
      }
    } catch {
      // ignore cache parse failures
    }
    return { error: err instanceof Error ? err.message : 'Weather fetch failed' }
  }
}
