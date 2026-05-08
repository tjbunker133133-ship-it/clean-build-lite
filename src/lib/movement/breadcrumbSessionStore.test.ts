import { describe, expect, it, beforeEach } from 'vitest'
import { installMemoryLocalStorage } from '../checkIn/testMemoryLocalStorage'
import {
  appendBreadcrumbPoint,
  clearBreadcrumbSession,
  getBreadcrumbSessionSnapshot,
} from './breadcrumbSessionStore'

describe('breadcrumbSessionStore', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    localStorage.clear()
    clearBreadcrumbSession()
  })

  it('accumulates session distance across crumbs', () => {
    const t = 1_700_000_000_000
    appendBreadcrumbPoint(45, -120, t)
    appendBreadcrumbPoint(45.001, -120, t + 30_000)
    const s = getBreadcrumbSessionSnapshot()
    expect(s.points.length).toBe(2)
    expect(s.sessionMeters).toBeGreaterThan(50)
    expect(s.sessionMeters).toBeLessThan(200_000)
  })

  it('clear resets points and distance', () => {
    appendBreadcrumbPoint(10, 20, Date.now())
    clearBreadcrumbSession()
    const s = getBreadcrumbSessionSnapshot()
    expect(s.points.length).toBe(0)
    expect(s.sessionMeters).toBe(0)
  })
})
