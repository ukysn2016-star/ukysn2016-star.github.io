/* ==========================================================================
   U2 学习卡 Service Worker
   v1.0.2 · 2026-10-29 路由修复版

   修复背景
   ---------
   手机端安装后打开「生词卡」只看到首页式排版、没有单词。实测定位到三条叠加缺陷：
     1) 导航超时 3.5 s 过短：生词卡页面 1.13 MB，弱网（约 7 KB/s）需 2~3 分钟，
        每次导航都超时转入缓存分支；
     2) 缓存兜底跨路径：找不到当前页时无条件回落 `./index.html`（首页），
        于是「打开生词卡却拿到首页」；
     3) 缓存键不归一：`/words/` 与 `/words/index.html` 是两个键，
        从目录入口进入即使缓存完整也会走到第 2 条的兜底；
     4) 预缓存失败被静默吞掉，CACHE 版本与首包同名，缺失项永不重建。

   本版策略
   ---------
   · 导航：**缓存优先 + 后台静默更新**（有缓存立即秒开，更新下次生效）
   · 无缓存时才走网络，超时放宽到 20 s
   · 全都失败 → 返回本应用自己的「尚未缓存完成」提示页，**绝不返回其它页面**
   · 缓存键归一：目录与 index.html 互认
   · 安装尽力缓存（45 s 预算）；activate 与 repair 消息可补齐缺失项（自愈）
   · 只清理本应用自己的旧缓存（u2cards-*），不触碰同域名下其它应用
   ========================================================================== */
const VERSION = '1.0.2';
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

const NAV_TIMEOUT = 20000;      // 仅「无缓存」时才等网络
const INSTALL_BUDGET = 45000;   // 安装阶段尽力而为的时间预算

const abs = u => new URL(u, self.registration.scope).href;

/* 同一页面的两种写法互认：/words/ <-> /words/index.html */
function variants(href) {
  const u = new URL(href);
  const p = u.pathname;
  const out = [u.origin + p];
  if (p.endsWith('/')) out.push(u.origin + p + 'index.html');
  else if (p.endsWith('/index.html')) out.push(u.origin + p.slice(0, -'index.html'.length));
  return out;
}

async function addOne(cache, url) {
  for (let i = 0; i < 2; i++) {
    try { await cache.add(new Request(url, { cache: 'reload' })); return true; }
    catch (e) { if (i === 1) return false; }
  }
  return false;
}

async function missingCore(cache) {
  const miss = [];
  for (const u of CORE) {
    const hit = await cache.match(abs(u));
    if (!hit) miss.push(u);
  }
  return miss;
}

/* 按归一化键查缓存；查不到返回 null（绝不跨路径兜底） */
async function lookup(request) {
  const cache = await caches.open(CACHE);
  for (const v of variants(request.url)) {
    const r = await cache.match(v);
    if (r) return r;
  }
  return (await cache.match(request, { ignoreSearch: true })) || null;
}

async function put(request, response) {
  try {
    if (!response || !response.ok || response.type === 'opaqueredirect') return;
    const cache = await caches.open(CACHE);
    await cache.put(variants(request.url)[0], response.clone());
  } catch (e) {}
}

function offlinePage() {
  const html = '<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>正在加载 · 学习卡</title><style>' +
    'body{font-family:system-ui,-apple-system,"Noto Sans SC",sans-serif;background:#f7f9fb;color:#3c3c3c;' +
    'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}' +
    '.b{max-width:330px}h1{font-size:19px;margin:0 0 10px}p{font-size:14px;color:#777;line-height:1.75;margin:0 0 18px}' +
    'button{border:none;border-radius:12px;background:#58cc02;color:#fff;font-size:15px;font-weight:800;padding:12px 24px}' +
    '</style><div class="b"><h1>这一页还没下载完</h1>' +
    '<p>当前网络较慢，页面内容仍在传输。已下载的部分会被保留，连上 Wi-Fi 后重试通常一次就能完成。</p>' +
    '<button onclick="location.reload()">重试</button></div></html>';
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

/* ---------------- 生命周期 ---------------- */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.race([
      Promise.all(CORE.map(u => addOne(cache, abs(u)))),
      new Promise(r => setTimeout(r, INSTALL_BUDGET))
    ]);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE && /^u2cards-/.test(k)).map(k => caches.delete(k))
    );
    await self.clients.claim();                 // 先接管，别让补齐拖住首屏
    const cache = await caches.open(CACHE);
    const miss = await missingCore(cache);      // 自愈：补齐上次没下完的
    if (miss.length) await Promise.all(miss.map(u => addOne(cache, abs(u))));
  })());
});

/* 页面可发 {type:'repair'} 主动要求补齐缓存 */
self.addEventListener('message', event => {
  const d = event.data || {};
  if (d.type !== 'repair') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const miss = await missingCore(cache);
    if (miss.length) await Promise.all(miss.map(u => addOne(cache, abs(u))));
    const clients = await self.clients.matchAll();
    clients.forEach(c => c.postMessage({ type: 'repair-done', missing: miss.length }));
  })());
});

/* ---------------- 策略 ---------------- */
async function navStrategy(request, event) {
  const hit = await lookup(request);
  if (hit) {                                    // 有缓存：秒开 + 后台更新
    event.waitUntil((async () => {
      try {
        const res = await fetch(request);
        await put(request, res);
      } catch (e) {}
    })());
    return hit;
  }
  try {                                         // 无缓存：等网络，给足耐心
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), NAV_TIMEOUT);
    const res = await fetch(request, { signal: ctrl.signal });
    clearTimeout(timer);
    await put(request, res);
    return res;
  } catch (e) {
    return offlinePage();                       // 只给自己的提示页
  }
}

async function cacheFirst(request) {
  const hit = await lookup(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    await put(request, res);
    return res;
  } catch (e) {
    return Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const hit = await caches.match(request);
  const network = fetch(request).then(async res => {
    try {
      if (res && (res.ok || res.type === 'opaque')) {
        const cache = await caches.open(CACHE);
        await cache.put(request, res.clone());
      }
    } catch (e) {}
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
    event.respondWith(navStrategy(request, event));
    return;
  }
  event.respondWith(cacheFirst(request));
});
