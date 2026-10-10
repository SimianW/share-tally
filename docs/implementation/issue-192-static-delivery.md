# Issue 192: static asset delivery

Implementation of [issue #192](https://github.com/SimianW/share-tally/issues/192): compression, security headers and cache headers from the production web container.

## Public path

The public request path is Cloudflare, then Caddy on the VPS, then FRP, then the web container's Nginx, which listens for plain HTTP on host `127.0.0.1:11119`. Cloudflare terminates browser TLS. Before this change, Cloudflare already compressed responses for browsers. The origin sent decoded bytes over FRP, and Cloudflare added `Cache-Control: max-age=14400` to responses without one. Caddy adds `Via: 1.1 Caddy`.

## Container behavior

`deploy/nginx.conf` gzips static text at request time: HTML, JavaScript, CSS, JSON, SVG, TTF fonts and plain text of at least 1 KiB. `gzip_proxied any` keeps compression on for requests that carry Caddy's `Via` header. Runtime gzip was chosen over precompressed files to avoid another build step; Cloudflare caches assets, so few requests reach the origin. Brotli is unavailable in `nginx:alpine`.

`/api/` turns gzip off and adds no headers, so JSON responses and the group SSE stream pass through as before.

Static responses, including their 404s, send `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`. These are in `deploy/nginx-static-headers.conf`, which every static location includes. A location that sets its own `add_header` loses the server-level headers, and server-level headers would also reach `/api/`.

Caching:

| Response | `Cache-Control` |
| --- | --- |
| `/assets/*` (Vite content-hashed) | `public, max-age=31536000, immutable` |
| `index.html`, including the fallback for unknown paths | `no-cache` |
| Unhashed public files: favicon, `/fonts/` | `no-cache` |
| Missing file: any path whose last segment has an extension | 404 with `no-store` |

App routes are hash URLs, so only extensionless paths still fall back to `index.html`. Before this change, a missing `/assets/` file returned `index.html` with status 200. Cloudflare cached that HTML under the `.js` URL for four hours.

## HSTS

The container does not send `Strict-Transport-Security`, because TLS does not terminate there. Enable HSTS at Cloudflare under SSL/TLS, Edge Certificates, HTTP Strict Transport Security, or in Caddy if it serves HTTPS to browsers. That configuration is not in this repository. Choosing `max-age`, `includeSubDomains` and preload is the domain owner's decision, because each one commits every subdomain to HTTPS.

## Measurements

Home's JavaScript is a single request: the entry chunk. The group-icon picker and emoji data are lazy chunks.

| Entry chunk, browser `Accept-Encoding` | Before (`afa7962`) | After (`ee8ed5e`) |
| --- | ---: | ---: |
| Decoded size | 873,912 B | 883,313 B |
| Origin container to FRP | 873,912 B, uncompressed | 253,340 B, gzip |
| Public `https://sharetally.app` | 286,429 B, gzip from Cloudflare | 253,340 B, gzip from the origin |

Both columns were measured on 2026-10-10 with `curl`, counting body bytes without HTTP headers. "Before" is the deployed `afa7962` image. "After" is `ee8ed5e`: PR #234 deployed right after #238 and includes it. #234 also grew the entry chunk by 9,401 B. Before, the origin sent the chunk uncompressed and Cloudflare compressed it. Now Cloudflare forwards the origin's gzip unchanged and caches it, so the public and origin sizes match. Repeated requests returned the same size. Cloudflare served gzip even when the request also accepted `br` and `zstd`.

## Validation

`deploy/check-web.sh <web image>` runs `deploy/check-web.mjs` beside the built web container. The script also plays the `api` upstream. It checks compression, security and cache headers, missing-file 404s, unchanged `/api/` headers without compression, and the first SSE event arriving without delay. `deploy/check.sh` runs it in CI after building the web image.

Public-path checks of `ee8ed5e` on 2026-10-10:

- `/` and the entry chunk carry all four security headers. `/` has `Cache-Control: no-cache`, so Cloudflare kept the origin's value. The entry chunk has `public, max-age=31536000, immutable`.
- `/api/health` still sends only its own `Content-Type`, `Cache-Control: no-store` and `X-Powered-By`, uncompressed.
- A missing `/assets/` file returns 404 with the security headers. The origin sent no lifetime on that 404, so Cloudflare added `Cache-Control: max-age=14400`. That breaks rollbacks. A tab still running the old build can request a lazy chunk that the new build lacks, and cache the 404. A rollback makes that name valid again, but the browser keeps serving the cached 404, and purging Cloudflare does not clear browser caches. Static 404s now send `Cache-Control: no-store`, which Cloudflare passes through without substituting its Browser Cache TTL. Check this on the public path after this change deploys.
- No `Strict-Transport-Security` is sent yet. Enabling it at Cloudflare is still the domain owner's decision; see [HSTS](#hsts).
- The group SSE stream wasn't checked publicly, because that requires a signed-in user. The container check covers its prompt first event.
