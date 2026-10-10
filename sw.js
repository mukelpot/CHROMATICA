// CHROMATICA concert booklet: the offline copy. After one visit online, the booklet also opens without a connection
// (say, in the theatre). This file sits next to the page, in the site's top folder, and the page switches it on
// (offline.js). It:
//  - keeps a copy of the booklet page, and of the picture files the page hands it (the social logos, any photos);
//  - online, always fetches the booklet fresh, so changes show up straight away, and updates the copy;
//  - offline, or when the network takes longer than 4 seconds, opens the saved copy instead.
// Links to other sites (the socials, BookMyShow) are never touched.
// Changing CACHE (say to 'chromatica-booklet-2') clears every saved copy on the next visit.
const CACHE = 'chromatica-booklet-1';
const PAGE = new URL('./', self.registration.scope).href; // the booklet itself: the site's top address
const WAIT = 4000; // how long to wait for the network (ms) before opening the saved copy

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => save(c, PAGE, fetch(PAGE))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('chromatica-booklet-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// the page sends the list of picture files to keep (offline.js), so pages the visitor hasn't opened yet work offline too
self.addEventListener('message', (e) => {
  const files = e.data && Array.isArray(e.data.keep) ? e.data.keep : null;
  if (!files) return;
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(files.map(async (f) => {
    try {
      const url = new URL(f, self.registration.scope);
      if (url.origin !== location.origin || (await c.match(url.href, { ignoreVary: true }))) return;
      await save(c, url.href, fetch(url.href));
    } catch (err) { /* a file that can't be fetched now is simply tried again next visit */ }
  }))));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // other sites: straight to the network, as usual
  const fresh = fetch(req); // start the network straight away
  const copy = fresh.then((r) => r.clone()); // (attached first, so the copy is taken before the page reads the answer)
  const key = req.mode === 'navigate' ? url.origin + url.pathname : req.url;
  const kept = caches.open(CACHE).then((c) => save(c, key, copy)).catch(() => {});
  e.waitUntil(kept); // the copy keeps updating in the background, even after the saved one has been shown
  e.respondWith(req.mode === 'navigate' ? openPage(req, fresh) : openFile(req, fresh));
});

// The booklet page: the network if it answers in time (and isn't an error page), otherwise the saved copy.
async function openPage(req, fresh) {
  const saved = async () => (await caches.match(req, { cacheName: CACHE, ignoreSearch: true, ignoreVary: true }))
    || caches.match(PAGE, { cacheName: CACHE, ignoreVary: true });
  try {
    const r = await within(fresh, WAIT);
    if (r.ok || r.type === 'opaqueredirect') return r;
    return (await saved()) || r;
  } catch (err) {
    return (await saved()) || fresh; // nothing saved yet: keep waiting for the network after all
  }
}

// Pictures and other files from this site: the saved file straight away if there is one, otherwise the network.
async function openFile(req, fresh) {
  const hit = await caches.match(req, { cacheName: CACHE, ignoreVary: true });
  return hit || fresh;
}

// Saves a good, complete answer from this site under `key` (a redirect is stored as the page it leads to).
// `pending` is an answer nobody else reads.
async function save(cache, key, pending) {
  const r = await pending;
  if (!r || r.status !== 200 || r.type !== 'basic') return;
  await cache.put(key, r.redirected ? new Response(await r.blob(), { status: 200, statusText: 'OK', headers: r.headers }) : r);
}

function within(p, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('slow')), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (er) => { clearTimeout(t); rej(er); });
  });
}
