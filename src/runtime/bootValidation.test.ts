import { describe, expect, it, beforeEach } from 'vitest'
import {
  __resetBootValidationForTests,
  collectBootHealth,
  installBootValidation,
  recordBootGeneration,
} from './bootValidation'

describe('bootValidation', () => {
  beforeEach(() => {
    __resetBootValidationForTests()
  })

  it('collectBootHealth returns structure in node (degraded)', () => {
    const health = collectBootHealth()
    expect(health).toHaveProperty('bootOk')
    expect(health).toHaveProperty('subsystems')
    expect(health.reactMounted).toBe(false)
  })

  it('installBootValidation is idempotent', () => {
    installBootValidation()
    recordBootGeneration()
    installBootValidation()
    expect(collectBootHealth().bootGeneration).toBe(1)
  })
})
