import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readWizardCompletedFlag, shouldAutoReopenWizard } from './PermissionPromptOverlay'

function stubLocalStorage() {
  const m = new Map<string, string>()
  vi.stubGlobal(
    'localStorage',
    {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v)
      },
      removeItem: (k: string) => {
        m.delete(k)
      },
      clear: () => {
        m.clear()
      },
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() {
        return m.size
      },
    } as Storage,
  )
}

describe('readWizardCompletedFlag (wizardCompleted)', () => {
  beforeEach(() => {
    stubLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns false when key is absent', () => {
    expect(readWizardCompletedFlag()).toBe(false)
  })

  it('returns true only when localStorage is exactly "true"', () => {
    localStorage.setItem('wizardCompleted', 'true')
    expect(readWizardCompletedFlag()).toBe(true)
    localStorage.setItem('wizardCompleted', '1')
    expect(readWizardCompletedFlag()).toBe(false)
  })

  it('returns false when localStorage.getItem throws (private / locked storage)', () => {
    vi.stubGlobal(
      'localStorage',
      {
        getItem: () => {
          throw new Error('Access denied')
        },
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: () => null,
        length: 0,
      } as Storage,
    )
    expect(readWizardCompletedFlag()).toBe(false)
  })
})

describe('shouldAutoReopenWizard (iOS watchdog gate)', () => {
  // Truth table — both gates must be `false` to allow reopen. Any future
  // simplification of the predicate must keep the table identical.
  it('blocks reopen when dismissed in memory only (private-mode safe)', () => {
    expect(
      shouldAutoReopenWizard({ dismissedInMemory: true, wizardCompletedPersisted: false }),
    ).toBe(false)
  })

  it('blocks reopen when wizard persisted as completed only', () => {
    expect(
      shouldAutoReopenWizard({ dismissedInMemory: false, wizardCompletedPersisted: true }),
    ).toBe(false)
  })

  it('blocks reopen when both gates set', () => {
    expect(
      shouldAutoReopenWizard({ dismissedInMemory: true, wizardCompletedPersisted: true }),
    ).toBe(false)
  })

  it('allows reopen ONLY when neither gate is set (first-run / not-yet-dismissed)', () => {
    expect(
      shouldAutoReopenWizard({ dismissedInMemory: false, wizardCompletedPersisted: false }),
    ).toBe(true)
  })
})
