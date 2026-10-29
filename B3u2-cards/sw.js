/* ==========================================================================
   U2 学习卡 Service Worker
   · 三页（首页 / 生词卡 / 词组卡）预缓存，离线可用
   · 页面导航：网络优先（保证改版能立刻生效），断网或超时回落到缓存
   · 静态资源：缓存优先
   · 只清理本应用自己的旧缓存，不触碰同域名下其它应用的缓存
   ========================================================================== */
const VERSION = '1.0.0';
const CACHE = 'u2cards-' + VERSION;

const CORE = [
  './',
  './index.html',
  './words/index.html',
  './phrases/index.html',
  './manifest.json',
  './shared/hub-bridge.js',
  './assets/cover.jpg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

const NAV_TIMEOUT = 3500;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CORE.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})   // 单个失败不影响整体
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE && /^u2cards-/.test(k)).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function pathKey(url) {
  const u = new URL(url);
  return u.origin + u.pathname;         // 去掉 ?query，避免 ?hub=1 生成重复缓存
}

async function fromCache(request) {
  const key = pathKey(request.url);
  return (await caches.match(key))
      || (await caches.match(request, { ignoreSearch: true }))
      || (await caches.match('./index.html'))
      || (await caches.match('./'));
}

async function cachePut(request, response) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(pathKey(request.url), response.clone());
  } catch (e) {}
}

function navStrategy(request) {
  return new Promise(resolve => {
    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      resolve(await fromCache(request));
    };
    const timer = setTimeout(finish, NAV_TIMEOUT);
    fetch(request).then(res => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (res && res.ok) cachePut(request, res);
      resolve(res);
    }).catch(() => { clearTimeout(timer); finish(); });
  });
}

async function cacheFirst(request) {
  const hit = await caches.match(request, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && res.ok) cachePut(request, res);
    return res;
  } catch (e) {
    return (await caches.match('./index.html')) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const hit = await caches.match(request);
  const network = fetch(request).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cachePut(request, res);
    return res;
  }).catch(() => null);
  return hit || (await network) || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (url.origin !== self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));   // 字体等第三方
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(navStrategy(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});
