import { describe, expect, it, vi } from 'vitest'
import {
  isFieldWakeLockSupported,
  setFieldWakeLockActive,
} from './fieldWakeLock'

describe('fieldWakeLock', () => {
  it('reports unsupported when API missing', () => {
    expect(isFieldWakeLockSupported()).toBe(false)
  })

  it('setFieldWakeLockActive is safe when unsupported', () => {
    expect(() => setFieldWakeLockActive(true)).not.toThrow()
    expect(() => setFieldWakeLockActive(false)).not.toThrow()
  })

  it('acquires when API present', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const request = vi.fn().mockResolvedValue({ release })
    ;(navigator as Navigator & { wakeLock?: { request: typeof request } }).wakeLock = {
      request,
    }
    setFieldWakeLockActive(true)
    await Promise.resolve()
    expect(request).toHaveBeenCalledWith('screen')
    setFieldWakeLockActive(false)
    await Promise.resolve()
    expect(release).toHaveBeenCalled()
  })
})
