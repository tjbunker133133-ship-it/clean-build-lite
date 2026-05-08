import { describe, expect, it } from 'vitest'
import { breadcrumbIntervalMs, breadcrumbMinStepMeters } from './breadcrumbIntervalMs'

describe('breadcrumbIntervalMs', () => {
  it('uses longer intervals for lower-power GPS modes', () => {
    expect(breadcrumbIntervalMs('active_navigation')).toBeLessThan(breadcrumbIntervalMs('stable_tracking'))
    expect(breadcrumbIntervalMs('stable_tracking')).toBeLessThan(breadcrumbIntervalMs('stationary_low'))
  })

  it('defaults undefined mode to active_navigation cadence', () => {
    expect(breadcrumbIntervalMs(undefined)).toBe(breadcrumbIntervalMs('active_navigation'))
  })
})

describe('breadcrumbMinStepMeters', () => {
  it('requires larger steps when GPS is throttled', () => {
    expect(breadcrumbMinStepMeters('active_navigation')).toBeLessThan(breadcrumbMinStepMeters('stationary_low'))
  })
})
