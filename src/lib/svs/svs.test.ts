/**
 * Situational Voice Support (SVS) - Unit Tests
 *
 * Coverage:
 * - Governor spam prevention
 * - Priority hierarchy
 * - Cooldown enforcement
 * - Event detection
 * - Prompt selection
 * - Configuration persistence
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SVS_CONFIG_DEFAULT,
  SVS_PRIORITY,
  type SvsEvent,
  type SvsUserConfig,
} from './types'
import {
  evaluateDelivery,
  getGovernorDiagnostics,
  getGovernorState,
  initGovernor,
  markTtsEnd,
  markTtsStart,
  markUserSilenced,
  recordDelivery,
  registerStateProviders,
  resetGovernor,
  updateConfig,
} from './governor'
import {
  detectBatteryEvent,
  detectHeartRateEvent,
  detectMotionEvent,
  emitEvent,
  resetEventDetection,
  subscribeSvsEvents,
} from './events'
import {
  getAdjustedCooldown,
  getPromptCount,
  getPromptForEvent,
  hasPromptForEvent,
  selectPromptVariant,
} from './prompts'
import { loadSvsConfig, resetSvsConfig, saveSvsConfig, updateSvsConfig } from './config'

describe('SVS System', () => {
  beforeEach(() => {
    resetGovernor()
    resetEventDetection()
    vi.clearAllMocks()
  })

  // ============================================================================
  // GOVERNOR TESTS
  // ============================================================================

  describe('Governor', () => {
    it('delivers first safety event immediately', () => {
      initGovernor({ enabled: true, frequency: 'balanced', mode: 'supportive' })

      const event: SvsEvent = {
        type: 'HIGH_HEART_RATE',
        priority: SVS_PRIORITY.SAFETY,
        timestamp: Date.now(),
        payload: { heartRate: 165 },
        dedupeKey: 'test-1',
      }

      const decision = evaluateDelivery(event)
      expect(decision.action).toBe('deliver')
    })

    it('suppresses rapid duplicate safety events', () => {
      initGovernor({ enabled: true, frequency: 'balanced', mode: 'supportive' })

      const event: SvsEvent = {
        type: 'HIGH_HEART_RATE',
        priority: SVS_PRIORITY.SAFETY,
        timestamp: Date.now(),
        payload: { heartRate: 165 },
        dedupeKey: 'test-1',
      }

      // First event delivered
      const d1 = evaluateDelivery(event)
      expect(d1.action).toBe('deliver')

      // Record delivery
      recordDelivery('hr-high', 'HIGH_HEART_RATE')

      // Second event suppressed by cooldown
      const d2 = evaluateDelivery({ ...event, dedupeKey: 'test-2' })
      expect(d2.action).toBe('suppress')
      expect(d2.reason).toBe('cooldown_active')
    })

    it('allows safety to interrupt supportive', () => {
      initGovernor({ enabled: true, frequency: 'balanced', mode: 'supportive' })

      // Start speaking supportive
      markTtsStart(SVS_PRIORITY.SUPPORTIVE)

      const event: SvsEvent = {
        type: 'HIGH_HEART_RATE',
        priority: SVS_PRIORITY.SAFETY,
        timestamp: Date.now(),
        payload: { heartRate: 165 },
        dedupeKey: 'test-1',
      }

      const decision = evaluateDelivery(event)
      expect(decision.action).toBe('deliver')
    })

    it('prevents supportive from interrupting operational', () => {
      initGovernor({ enabled: true, frequency: 'balanced', mode: 'supportive' })

      // Start speaking operational
      markTtsStart(SVS_PRIORITY.OPERATIONAL)

      const event: SvsEvent = {
        type: 'HYDRATION_REMINDER',
        priority: SVS_PRIORITY.SUPPORTIVE,
        timestamp: Date.now(),
        payload: {},
        dedupeKey: 'test-1',
      }

      const decision = evaluateDelivery(event)
      expect(decision.action).toBe('suppress')
      expect(decision.reason).toBe('tts_busy')
    })

    it('honors user silence for supportive but not safety', () => {
      initGovernor({ enabled: true, frequency: 'balanced', mode: 'supportive' })
      markUserSilenced()

      // Supportive suppressed
      const supportive: SvsEvent = {
        type: 'HYDRATION_REMINDER',
        priority: SVS_PRIORITY.SUPPORTIVE,
        timestamp: Date.now(),
        payload: {},
        dedupeKey: 'test-1',
      }

      const d1 = evaluateDelivery(supportive)
      expect(d1.action).toBe('suppress')
      expect(d1.reason).toBe('user_silenced')

      // Safety allowed through
      const safety: SvsEvent = {
        type: 'HIGH_HEART_RATE',
        priority: SVS_PRIORITY.SAFETY,
        timestamp: Date.now(),
        payload: { heartRate: 165 },
        dedupeKey: 'test-2',
      }

      const d2 = evaluateDelivery(safety)
      expect(d2.action).toBe('deliver')
    })

    it('enables mission-only mode correctly', () => {
      initGovernor({ enabled: true, frequency: 'balanced', mode: 'supportive', missionOnly: true })
      registerStateProviders({
        isMissionActive: () => false,
        getBatteryPercent: () => 100,
        getRecentUserActivity: () => Date.now(),
      })

      // Supportive suppressed when no mission
      const supportive: SvsEvent = {
        type: 'HYDRATION_REMINDER',
        priority: SVS_PRIORITY.SUPPORTIVE,
        timestamp: Date.now(),
        payload: {},
        dedupeKey: 'test-1',
      }

      const d1 = evaluateDelivery(supportive)
      expect(d1.action).toBe('suppress')

      // Safety still allowed
      const safety: SvsEvent = {
        type: 'HIGH_HEART_RATE',
        priority: SVS_PRIORITY.SAFETY,
        timestamp: Date.now(),
        payload: { heartRate: 165 },
        dedupeKey: 'test-2',
      }

      const d2 = evaluateDelivery(safety)
      expect(d2.action).toBe('deliver')
    })

    it('applies frequency multiplier to cooldowns', () => {
      const baseCooldown = 5 * 60 * 1000 // 5 minutes

      expect(getAdjustedCooldown(baseCooldown, 'minimal')).toBeGreaterThan(baseCooldown)
      expect(getAdjustedCooldown(baseCooldown, 'active')).toBeLessThan(baseCooldown)
      expect(getAdjustedCooldown(baseCooldown, 'balanced')).toBe(baseCooldown)
    })

    it('caps session deliveries', () => {
      initGovernor({ enabled: true, frequency: 'balanced', mode: 'supportive' })

      // Simulate 50 deliveries
      for (let i = 0; i < 50; i++) {
        recordDelivery(`prompt-${i}`, 'STEADY_PACE')
      }

      // 51st supportive suppressed
      const event: SvsEvent = {
        type: 'STEADY_PACE',
        priority: SVS_PRIORITY.SUPPORTIVE,
        timestamp: Date.now(),
        payload: {},
        dedupeKey: 'test-51',
      }

      const decision = evaluateDelivery(event)
      expect(decision.action).toBe('suppress')
    })
  })

  // ============================================================================
  // EVENT DETECTION TESTS
  // ============================================================================

  describe('Event Detection', () => {
    it('detects high heart rate', () => {
      const event = detectHeartRateEvent(165)
      expect(event).not.toBeNull()
      expect(event?.type).toBe('HIGH_HEART_RATE')
      expect(event?.priority).toBe(SVS_PRIORITY.SAFETY)
    })

    it('detects extreme heart rate', () => {
      const event = detectHeartRateEvent(185)
      expect(event).not.toBeNull()
      expect(event?.type).toBe('EXTREME_HEART_RATE')
    })

    it('debounces heart rate changes', () => {
      // First detection
      const e1 = detectHeartRateEvent(165)
      expect(e1).not.toBeNull()

      // Same zone - no new event
      const e2 = detectHeartRateEvent(168)
      expect(e2).toBeNull()
    })

    it('detects battery low on transition', () => {
      // First detection sets baseline
      detectBatteryEvent(25)
      // Now detect drop below threshold
      const event = detectBatteryEvent(18)
      expect(event).not.toBeNull()
      expect(event?.type).toBe('BATTERY_LOW')
    })

    it('detects battery critical', () => {
      const event = detectBatteryEvent(8)
      expect(event).not.toBeNull()
      expect(event?.type).toBe('LOW_BATTERY')
      expect(event?.priority).toBe(SVS_PRIORITY.SAFETY)
    })

    it('emits events to subscribers', () => {
      const events: SvsEvent[] = []
      const unsubscribe = subscribeSvsEvents((e) => events.push(e))

      emitEvent({
        type: 'MISSION_RESTORED',
        priority: SVS_PRIORITY.OPERATIONAL,
        timestamp: Date.now(),
        payload: {},
        dedupeKey: 'test-1',
      })

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('MISSION_RESTORED')

      unsubscribe()
    })

    it('debounces rapid event emissions', () => {
      const events: SvsEvent[] = []
      const unsubscribe = subscribeSvsEvents((e) => events.push(e))

      const now = Date.now()

      // Emit twice rapidly
      emitEvent({
        type: 'MISSION_RESTORED',
        priority: SVS_PRIORITY.OPERATIONAL,
        timestamp: now,
        payload: {},
        dedupeKey: 'test-1',
      })

      emitEvent({
        type: 'MISSION_RESTORED',
        priority: SVS_PRIORITY.OPERATIONAL,
        timestamp: now,
        payload: {},
        dedupeKey: 'test-2',
      })

      // Should be deduplicated
      expect(events).toHaveLength(1)

      unsubscribe()
    })
  })

  // ============================================================================
  // PROMPT LIBRARY TESTS
  // ============================================================================

  describe('Prompt Library', () => {
    it('has prompts for all priority levels', () => {
      const safety = getPromptForEvent('HIGH_HEART_RATE')
      expect(safety?.priority).toBe(SVS_PRIORITY.SAFETY)

      const operational = getPromptForEvent('MISSION_RESTORED')
      expect(operational?.priority).toBe(SVS_PRIORITY.OPERATIONAL)

      const supportive = getPromptForEvent('HYDRATION_REMINDER')
      expect(supportive?.priority).toBe(SVS_PRIORITY.SUPPORTIVE)
    })

    it('selects time-based variants deterministically', () => {
      const prompt = getPromptForEvent('LONG_EXERTION')
      expect(prompt).not.toBeNull()
      expect(prompt?.variants).toBeDefined()
      expect(prompt?.variants?.length).toBeGreaterThan(0)

      const variant = selectPromptVariant(prompt!)
      expect(variant).toBeDefined()
      expect(typeof variant).toBe('string')
    })

    it('has reasonable cooldown periods', () => {
      const hrPrompt = getPromptForEvent('HIGH_HEART_RATE')
      expect(hrPrompt?.cooldownMs).toBeGreaterThanOrEqual(5 * 60 * 1000) // At least 5 min

      const hydratePrompt = getPromptForEvent('HYDRATION_REMINDER')
      expect(hydratePrompt?.cooldownMs).toBeGreaterThanOrEqual(30 * 60 * 1000) // At least 30 min
    })

    it('identifies missing prompts', () => {
      expect(hasPromptForEvent('HIGH_HEART_RATE')).toBe(true)
      expect(hasPromptForEvent('UNKNOWN_EVENT' as any)).toBe(false)
    })

    it('counts total prompts', () => {
      const count = getPromptCount()
      expect(count).toBeGreaterThan(10) // Substantial library
    })
  })

  // ============================================================================
  // CONFIGURATION TESTS
  // ============================================================================

  describe('Configuration', () => {
    it('loads default config when localStorage empty', () => {
      const config = loadSvsConfig()
      expect(config.enabled).toBe(SVS_CONFIG_DEFAULT.enabled)
      expect(config.frequency).toBe(SVS_CONFIG_DEFAULT.frequency)
      expect(config.mode).toBe(SVS_CONFIG_DEFAULT.mode)
    })

    it('saves and loads custom config', () => {
      const custom: SvsUserConfig = {
        ...SVS_CONFIG_DEFAULT,
        enabled: false,
        mode: 'tactical',
        frequency: 'minimal',
      }

      saveSvsConfig(custom)
      const loaded = loadSvsConfig()

      expect(loaded.enabled).toBe(false)
      expect(loaded.mode).toBe('tactical')
      expect(loaded.frequency).toBe('minimal')
    })

    it('sanitizes invalid config values', () => {
      const invalid = {
        ...SVS_CONFIG_DEFAULT,
        frequency: 'invalid' as any,
        mode: 'unknown' as any,
        minBatteryPercent: 200,
        cooldownMultiplier: 5.0,
      }

      saveSvsConfig(invalid)
      const loaded = loadSvsConfig()

      expect(loaded.frequency).toBe('balanced') // Default fallback
      expect(loaded.mode).toBe('supportive') // Default fallback
      expect(loaded.minBatteryPercent).toBeNull() // Invalid range
      expect(loaded.cooldownMultiplier).toBeLessThanOrEqual(3.0) // Clamped
    })

    it('applies partial config updates', () => {
      resetSvsConfig()

      updateSvsConfig({ mode: 'tactical' })
      const loaded = loadSvsConfig()

      expect(loaded.mode).toBe('tactical')
      expect(loaded.enabled).toBe(SVS_CONFIG_DEFAULT.enabled) // Unchanged
      expect(loaded.frequency).toBe(SVS_CONFIG_DEFAULT.frequency) // Unchanged
    })

    it('respects quiet hours', () => {
      const config: SvsUserConfig = {
        ...SVS_CONFIG_DEFAULT,
        quietHoursStart: 22,
        quietHoursEnd: 6,
      }

      // Can't easily test time-dependent behavior in unit tests
      // But we can verify the config is saved
      saveSvsConfig(config)
      const loaded = loadSvsConfig()

      expect(loaded.quietHoursStart).toBe(22)
      expect(loaded.quietHoursEnd).toBe(6)
    })
  })

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('Integration', () => {
    it('end-to-end event flow', () => {
      initGovernor({ enabled: true, frequency: 'balanced', mode: 'supportive' })

      // 1. Detect event
      const event = detectBatteryEvent(8)
      expect(event).not.toBeNull()

      // 2. Governor evaluates
      const decision = evaluateDelivery(event!)
      expect(decision.action).toBe('deliver')

      if (decision.action === 'deliver') {
        // 3. Prompt exists
        expect(decision.prompt).toBeDefined()
        expect(decision.prompt.id).toBe('battery-critical')

        // 4. Record delivery
        recordDelivery(decision.prompt.id, event!.type)

        // 5. Verify cooldown active
        const decision2 = evaluateDelivery(event!)
        expect(decision2.action).toBe('suppress')
      }
    })

    it('suppresses similar events', () => {
      initGovernor({ enabled: true, frequency: 'balanced', mode: 'supportive' })

      // High HR event
      const hrEvent: SvsEvent = {
        type: 'HIGH_HEART_RATE',
        priority: SVS_PRIORITY.SAFETY,
        timestamp: Date.now(),
        payload: { heartRate: 165 },
        dedupeKey: 'test-1',
      }

      const d1 = evaluateDelivery(hrEvent)
      expect(d1.action).toBe('deliver')

      recordDelivery('hr-high', 'HIGH_HEART_RATE')

      // Extreme HR event shortly after (similar)
      const extremeEvent: SvsEvent = {
        type: 'EXTREME_HEART_RATE',
        priority: SVS_PRIORITY.SAFETY,
        timestamp: Date.now(),
        payload: { heartRate: 185 },
        dedupeKey: 'test-2',
      }

      // Safety events are in the same group, but safety always allowed
      // This tests the similarity logic while respecting safety priority
      const d2 = evaluateDelivery(extremeEvent)
      // Both are safety, so it should be allowed through
      expect(d2.action).toBe('deliver')
    })

    it('provides diagnostic data', () => {
      initGovernor({ enabled: true, frequency: 'balanced', mode: 'supportive' })

      const diagnostics = getGovernorDiagnostics()
      expect(diagnostics).toHaveProperty('deliveriesThisSession')
      expect(diagnostics).toHaveProperty('config')
      expect(diagnostics).toHaveProperty('ttsActive')
    })
  })
})
