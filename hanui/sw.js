// 오프라인용 서비스 워커: 앱 파일만 캐시한다. 문항은 앱이 IndexedDB에 따로 남기고,
// Supabase 요청은 캐시하지 않는다. 배포할 때 워크플로가 VERSION을 바꿔 새로 받게 한다.
const VERSION = "20261028101206";
const CACHE = `hanui-${VERSION}`;
const CORE = ["./", "index.html", "app.js", "cards.js", "boot.js", "app.css", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("hanui-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const mine = url.origin === location.origin && url.pathname.startsWith(new URL("./", self.registration.scope).pathname);
  const font = url.hostname.includes("fonts.g");
  if (!mine && !font) return;
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        }),
    ),
  );
});
