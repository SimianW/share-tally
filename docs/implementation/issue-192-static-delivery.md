# Issue 192: static asset delivery

Implementation of [issue #192](https://github.com/SimianW/share-tally/issues/192): compression, security headers and cache headers from the production web container.

## Public path

The public request path is Cloudflare, then Caddy on the VPS, then FRP, then the web container's Nginx, which listens for plain HTTP on host `127.0.0.1:11119`. Cloudflare terminates browser TLS. Before this change, Cloudflare already compressed responses for browsers. The origin sent decoded bytes over FRP, and Cloudflare added `Cache-Control: max-age=14400` to responses without one. Caddy adds `Via: 1.1 Caddy`.

## Container behavior

`deploy/nginx.conf` gzips static text at request time: HTML, JavaScript, CSS, JSON, SVG, TTF fonts and plain text of at least 1 KiB. `gzip_proxied any` keeps compression on for requests that carry Caddy's `Via` header. Runtime gzip was chosen over precompressed files to avoid another build step; Cloudflare caches assets, so few requests reach the origin. Brotli is unavailable in `nginx:alpine`.

`/api/` turns gzip off and adds no headers, so JSON responses and the group SSE stream pass through as before.

Static responses, including their 404s, send `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`. These are in `deploy/nginx-security-headers.conf`, which every static location includes. A location that sets its own `add_header` loses the server-level headers, and server-level headers would also reach `/api/`.

Caching:

| Response | `Cache-Control` |
| --- | --- |
| `/assets/*` (Vite content-hashed) | `public, max-age=31536000, immutable` |
| `index.html`, including the fallback for unknown paths | `no-cache` |
| Unhashed public files: favicon, `/fonts/` | `no-cache` |
| Missing file: any path whose last segment has an extension | 404 without `Cache-Control` |

App routes are hash URLs, so only extensionless paths still fall back to `index.html`. Before this change, a missing `/assets/` file returned `index.html` with status 200. Cloudflare cached that HTML under the `.js` URL for four hours.

## HSTS

The container does not send `Strict-Transport-Security`, because TLS does not terminate there. Enable HSTS at Cloudflare under SSL/TLS, Edge Certificates, HTTP Strict Transport Security, or in Caddy if it serves HTTPS to browsers. That configuration is not in this repository. Choosing `max-age`, `includeSubDomains` and preload is the domain owner's decision, because each one commits every subdomain to HTTPS.

## Measurements

Home's JavaScript is a single request: the entry chunk. The group-icon picker and emoji data are lazy chunks.

| Path, entry chunk with browser `Accept-Encoding` | Before | After |
| --- | ---: | ---: |
| Origin container (`127.0.0.1:11119` before, the new image locally after) | 873,912 B, uncompressed | 251,081 B, gzip |
| Public `https://sharetally.app`, Cloudflare edge | 286,429 B, gzip from Cloudflare | Pending deployment |

The "before" numbers were taken on 2026-10-10 from the deployed `afa7962` image. Repeated requests and a cache-busting query returned the same public size. Cloudflare served gzip even when the request also accepted `br` and `zstd`. These were `curl` measurements of body bytes, without HTTP headers.

## Validation

`deploy/check-web.sh <web image>` runs `deploy/check-web.mjs` beside the built web container. The script also plays the `api` upstream. It checks compression, security and cache headers, missing-file 404s, unchanged `/api/` headers without compression, and the first SSE event arriving without delay. `deploy/check.sh` runs it in CI after building the web image.

After deployment, verify on the public path:

- The entry chunk's transfer size and `Content-Encoding`, to fill in the table.
- The security headers on `/` and on the entry chunk, and unchanged headers on `/api/health`.
- `Cache-Control` on `/` and on the entry chunk. Cloudflare replaces origin lifetimes shorter than its Browser Cache TTL, currently four hours. If `index.html` arrives with `max-age=14400` instead of `no-cache`, set Browser Cache TTL to "Respect Existing Headers".
- A 404 for a missing `/assets/` file. Use a new random name, because Cloudflare cached the old fallback HTML for four hours.
