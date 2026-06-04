import { describe, expect, it, vi } from 'vitest'
import {
  fireConditionsVoiceMessage,
  waterConditionsVoiceMessage,
} from './environmentalVoice'

describe('voice stub wiring runtime', () => {
  it('fire brief resolves from fetchWeather', async () => {
    const fetchWeather = vi.fn().mockResolvedValue({
      temperature: 90,
      humidity: 15,
      windSpeed: 22,
      condition: 'Clear sky',
      unit: '°F',
      windUnit: 'mph',
      location: 'Field',
      weatherCode: 0,
      updatedAt: Date.now(),
    })
    const result = await fireConditionsVoiceMessage({
      lat: 39.55,
      lng: -105.78,
      fetchWeather,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.message).not.toContain('Coming in Tier')
      expect(result.message).toContain('show fire map')
    }
    expect(fetchWeather).toHaveBeenCalledOnce()
  })

  it('water brief fails without GPS', async () => {
    const result = await waterConditionsVoiceMessage({
      lat: null,
      lng: null,
      fetchWeather: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('GPS')
  })
})
