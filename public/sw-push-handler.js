/* Web Push + notification click — loaded via Workbox importScripts alongside sw-message-handler.js */

self.addEventListener('push', (event) => {
  let payload = { title: 'Signal One HUD', body: 'Emergency alert', data: { url: '/' } }
  try {
    if (event.data) {
      const parsed = event.data.json()
      if (parsed && typeof parsed === 'object') payload = { ...payload, ...parsed }
    }
  } catch {
    const text = event.data ? event.data.text() : ''
    if (text) payload.body = text
  }

  const title = payload.title || 'Signal One HUD'
  const options = {
    body: payload.body || 'Emergency alert',
    icon: '/hud-icon-192.png',
    badge: '/hud-icon-192.png',
    tag: payload.tag || 'signal-one-alert',
    renotify: true,
    data: payload.data || { url: '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
    }),
  )
})
