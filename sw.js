const CACHE_NAME = 'strava3-cache-v3';
const ASSETS_TO_CACHE = [
  './', './index.html', './style.css', './app.js', './ui.js', './auth.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )));
});

self.addEventListener('fetch', event => {
  // Negeer POST requests (AI / Database) en Chrome Extensies
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
      return; 
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const resClone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});