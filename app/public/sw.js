// 오프라인용 서비스 워커: 앱 파일(과 있으면 문항·그림)을 캐시해 두고 먼저 꺼내 쓴다.
// 클라우드(Supabase) 요청은 캐시하지 않는다. 클라우드 문항은 앱이 IndexedDB에 따로 남긴다.
// 새로 빌드하면 build.sh가 VERSION을 바꿔 새로 받게 한다.
const VERSION = "__VERSION__";
const CACHE = `bioquiz-${VERSION}`;
const CORE = ["./", "index.html", "app.js", "styles.css", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
// 공개 사이트(GitHub Pages)에는 문항 파일이 없다. 있으면 같이 받아 둔다.
const OPTIONAL = ["data/questions.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(CORE).then(() => Promise.all(OPTIONAL.map((u) => c.add(u).catch(() => {})))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("bioquiz-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok && (new URL(e.request.url).origin === location.origin || e.request.url.includes("fonts.g"))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        }),
    ),
  );
});
