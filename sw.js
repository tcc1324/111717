const CACHE = 'park-music-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type !== 'cache-track' || !d.url) return;
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    if (await c.match(d.url)) return;
    const res = await fetch(d.url);
    if (res.status !== 200) return;
    await c.put(d.url, res);
    const cs = await self.clients.matchAll();
    cs.forEach((cl) => cl.postMessage({ type: 'cached', url: d.url }));
  })().catch(() => {}));
});
