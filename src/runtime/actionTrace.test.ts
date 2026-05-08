import { describe, expect, it, vi } from 'vitest'
import { traceAction } from './actionTrace'

describe('traceAction', () => {
  it('dedupes identical action-phase payloads', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    traceAction('force_update_app', 'handler_enter', { a: 1 })
    traceAction('force_update_app', 'handler_enter', { a: 1 })
    traceAction('force_update_app', 'state_result', { a: 1 })
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})

