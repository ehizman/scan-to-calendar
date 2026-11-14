/* Scan to Calendar service worker: keeps the app working offline.
 * Bump VERSION whenever you deploy changed files so phones pick up the new copy. */
const VERSION = "v4";
const CACHE = "scan-to-calendar-" + VERSION;
const FILES = [
  "./",
  "./index.html",
  "./admin.html",
  "./styles.css",
  "./app.js",
  "./admin.js",
  "./calendar.js",
  "./vendor/jsQR.js",
  "./vendor/qrcode.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", event => {
  // cache: "reload" skips the browser's HTTP cache so a new VERSION always stores fresh files.
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("scan-to-calendar-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Same-origin GETs: answer from cache straight away, refresh the cache in the background.
/*
 * Calendar files for iPhone and iPad: ./ics/<name>.ics?d=<base64url .ics text>
 * iOS Safari silently blocks page navigations to data: URLs, so app.js sends Safari
 * here instead. The file is built on the phone and answered by this worker, so it
 * never reaches the server. Safari sees a normal text/calendar response and opens
 * the Add to Calendar sheet.
 */
const ICS_PATH = new URL("./ics/", self.registration.scope).pathname;
const ICS_MAX_CHARS = 20000;

function icsResponse(url) {
  let text = "";
  try {
    const b = (url.searchParams.get("d") || "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b + "===".slice((b.length + 3) % 4));
    text = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  } catch {}
  if (!text.startsWith("BEGIN:VCALENDAR") || !/END:VCALENDAR\s*$/.test(text) || text.length > ICS_MAX_CHARS) {
    return new Response("This calendar link is damaged. Go back and tap Apple Calendar again.", {
      status: 400, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  }
  return new Response(text, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" },
  });
}

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === "GET" && url.origin === self.location.origin && url.pathname.startsWith(ICS_PATH)) {
    event.respondWith(icsResponse(url));
    return;
  }
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
