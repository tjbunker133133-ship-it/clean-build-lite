/**
 * useWeatherAtmosphere
 *
 * Modern Layer only. Derives an atmospheric context from live weather data.
 * Consumers use this to subtly adapt the immersive environment:
 *   - CSS color filters / tints
 *   - Vignette intensity
 *   - Lightning pulses (storms)
 *   - Ambient ambient glow color
 *
 * Design contract:
 *   - All values are calibrated to be SUBTLE. Max dimFactor is 0.20.
 *   - Never call from Classic or Balanced code paths.
 */

import { useMemo } from 'react'
import { usePanelData } from '../context/PanelDataContext'
import { isWeatherSuccess } from '../lib/weather'

export type AtmosphericTone =
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'storm'
  | 'snow'
  | 'fog'
  | 'showers'

export type AtmosphericLevel = 'calm' | 'active' | 'intense'

export interface WeatherAtmosphere {
  tone: AtmosphericTone
  level: AtmosphericLevel
  weatherCode: number
  /** 0–0.20 overlay dim. Used for vignette darkness. */
  dimFactor: number
  /** CSS filter string for ambient color shift (or 'none'). */
  colorFilter: string
  /** RGBA ambient glow color painted as a subtle map tint. */
  ambientRgba: string
  /** Whether active weather is present (atmospheric tone only). */
  hasActiveWeather: boolean
  /** Human-readable condition label. */
  label: string
  /** True for thunderstorm codes — enables lightning pulse FX. */
  isThunderstorm: boolean
}

const CALM: WeatherAtmosphere = {
  tone: 'clear',
  level: 'calm',
  weatherCode: 0,
  dimFactor: 0,
  colorFilter: 'none',
  ambientRgba: 'rgba(0,0,0,0)',
  hasActiveWeather: false,
  label: 'Clear',
  isThunderstorm: false,
}

function deriveAtmosphere(code: number): WeatherAtmosphere {
  // WMO weather code interpretation
  if (code === 0 || code === 1) {
    return CALM
  }
  if (code === 2 || code === 3) {
    return {
      tone: 'cloudy',
      level: 'calm',
      weatherCode: code,
      dimFactor: 0.04,
      colorFilter: 'saturate(0.9)',
      ambientRgba: 'rgba(120,140,160,0.03)',
      hasActiveWeather: false,
      label: code === 2 ? 'Partly Cloudy' : 'Overcast',
      isThunderstorm: false,
    }
  }
  if (code === 45 || code === 48) {
    return {
      tone: 'fog',
      level: 'active',
      weatherCode: code,
      dimFactor: 0.08,
      colorFilter: 'saturate(0.65) brightness(0.97)',
      ambientRgba: 'rgba(190,200,215,0.07)',
      hasActiveWeather: true,
      label: 'Foggy',
      isThunderstorm: false,
    }
  }
  if (code >= 51 && code <= 57) {
    return {
      tone: 'rain',
      level: 'active',
      weatherCode: code,
      dimFactor: 0.07,
      colorFilter: 'saturate(0.82) hue-rotate(-4deg)',
      ambientRgba: 'rgba(80,120,200,0.05)',
      hasActiveWeather: true,
      label: 'Drizzle',
      isThunderstorm: false,
    }
  }
  if (code >= 61 && code <= 67) {
    return {
      tone: 'rain',
      level: 'active',
      weatherCode: code,
      dimFactor: 0.12,
      colorFilter: 'saturate(0.78) hue-rotate(-7deg) brightness(0.93)',
      ambientRgba: 'rgba(60,100,180,0.09)',
      hasActiveWeather: true,
      label: code <= 63 ? 'Rain' : 'Heavy Rain',
      isThunderstorm: false,
    }
  }
  if (code >= 71 && code <= 77) {
    return {
      tone: 'snow',
      level: 'active',
      weatherCode: code,
      dimFactor: 0.05,
      colorFilter: 'saturate(0.6) brightness(1.04)',
      ambientRgba: 'rgba(210,225,255,0.06)',
      hasActiveWeather: true,
      label: code === 77 ? 'Snow Grains' : 'Snow',
      isThunderstorm: false,
    }
  }
  if (code >= 80 && code <= 84) {
    return {
      tone: 'showers',
      level: 'active',
      weatherCode: code,
      dimFactor: 0.14,
      colorFilter: 'saturate(0.74) hue-rotate(-9deg) brightness(0.91)',
      ambientRgba: 'rgba(50,90,160,0.11)',
      hasActiveWeather: true,
      label: code <= 82 ? 'Showers' : 'Snow Showers',
      isThunderstorm: false,
    }
  }
  if (code >= 85 && code <= 86) {
    return {
      tone: 'snow',
      level: 'active',
      weatherCode: code,
      dimFactor: 0.07,
      colorFilter: 'saturate(0.6) brightness(1.03)',
      ambientRgba: 'rgba(200,215,255,0.07)',
      hasActiveWeather: true,
      label: 'Heavy Snow Showers',
      isThunderstorm: false,
    }
  }
  if (code >= 95) {
    return {
      tone: 'storm',
      level: 'intense',
      weatherCode: code,
      dimFactor: 0.19,
      colorFilter: 'saturate(0.68) hue-rotate(-14deg) brightness(0.87)',
      ambientRgba: 'rgba(40,55,130,0.14)',
      hasActiveWeather: true,
      label: code >= 99 ? 'Severe Thunderstorm' : 'Thunderstorm',
      isThunderstorm: true,
    }
  }
  return CALM
}

export function useWeatherAtmosphere(): WeatherAtmosphere {
  const { weather } = usePanelData()

  return useMemo(() => {
    if (!isWeatherSuccess(weather)) return CALM
    return deriveAtmosphere(weather.weatherCode)
  }, [weather])
}
