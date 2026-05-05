export type WeatherResult =
  | {
      temperature: number
      windSpeed: number
      condition: string
      unit: string
      windUnit: string
      location: string
      weatherCode: number
      updatedAt: number
    }
  | { error: string }

const WEATHER_CACHE_KEY = 'titanium_weather_cache_v1'

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

async function reverseLocation(lat: number, lon: number): Promise<string> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`,
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

export async function fetchWeather(lat: number | null, lon: number | null): Promise<WeatherResult> {
  if (lat == null || lon == null) return { error: 'No GPS fix available' }
  try {
    const [response, location] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto`,
      ),
      reverseLocation(lat, lon),
    ])
    if (!response.ok) return { error: `Weather service error (${response.status})` }
    const data = await response.json()
    if (!data?.current_weather) return { error: 'No weather data' }

    const out = {
      temperature: Math.round(Number(data.current_weather.temperature ?? 0)),
      windSpeed: Number(data.current_weather.windspeed ?? 0),
      condition: weatherDescription(Number(data.current_weather.weathercode ?? -1)),
      unit: String(data.current_weather_units?.temperature ?? '°F'),
      windUnit: String(data.current_weather_units?.windspeed ?? 'mph'),
      location,
      weatherCode: Number(data.current_weather.weathercode ?? -1),
      updatedAt: Date.now(),
    }

    try {
      localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(out))
    } catch {
      // ignore cache failures
    }
    return out
  } catch (err) {
    try {
      const cached = localStorage.getItem(WEATHER_CACHE_KEY)
      if (cached) {
        const c = JSON.parse(cached)
        return { ...c, condition: `${c.condition} (cached)` }
      }
    } catch {
      // ignore cache parse failures
    }
    return { error: err instanceof Error ? err.message : 'Weather fetch failed' }
  }
}
