import { beforeEach, describe, expect, it, vi } from 'vitest'
import { showInboundTeamMessageNotification } from './missionCommsNotification'

describe('missionCommsNotification', () => {
  beforeEach(() => {
    vi.stubGlobal('Notification', {
      permission: 'granted',
    })
  })

  it('no-ops when notification permission is not granted', async () => {
    vi.stubGlobal('Notification', { permission: 'default' })
    await expect(
      showInboundTeamMessageNotification('Alpha', 'hold at gate'),
    ).resolves.toBeUndefined()
  })

  it('shows notification via Notification API when service worker unavailable', async () => {
    class MockNotification {
      static permission = 'granted'
      static last: { title: string; options: NotificationOptions } | null = null
      constructor(title: string, options?: NotificationOptions) {
        MockNotification.last = { title, options: options ?? {} }
      }
    }
    vi.stubGlobal('window', {})
    vi.stubGlobal('Notification', MockNotification)
    vi.stubGlobal('navigator', {} as Navigator)
    await showInboundTeamMessageNotification('Alpha', 'hold at gate')
    expect(MockNotification.last?.title).toBe('Alpha — team message')
    expect(MockNotification.last?.options).toMatchObject({
      body: 'hold at gate',
      tag: 'signal-one-team-message',
    })
  })
})
