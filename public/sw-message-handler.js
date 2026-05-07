/* Service worker helper — loaded via Workbox importScripts. Enables SKIP_WAITING from clients. */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
