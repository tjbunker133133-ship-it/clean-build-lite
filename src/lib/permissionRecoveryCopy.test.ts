import { describe, expect, it } from 'vitest'
import { mergePersistedGeolocationState } from './permissionRecoveryCopy'

describe('mergePersistedGeolocationState', () => {
  it('trusts persisted grant when API reports prompt (Android quirk)', () => {
    expect(mergePersistedGeolocationState('prompt', 'granted')).toBe('granted')
  })

  it('trusts persisted deny when API still reports granted (revoke lag)', () => {
    expect(mergePersistedGeolocationState('granted', 'denied')).toBe('denied')
  })

  it('leaves denied when storage empty', () => {
    expect(mergePersistedGeolocationState('denied', null)).toBe('denied')
  })

  it('leaves prompt when storage empty', () => {
    expect(mergePersistedGeolocationState('prompt', null)).toBe('prompt')
  })

  it('trusts persisted deny when API reports prompt (revoke / stale query)', () => {
    expect(mergePersistedGeolocationState('prompt', 'denied')).toBe('denied')
  })
})
