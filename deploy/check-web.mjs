// HTTP checks for the production web container, run by deploy/check-web.sh.
// This process also serves as the `api` upstream that Nginx proxies /api/ to.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { after, before, test } from 'node:test';
import { gunzipSync } from 'node:zlib';

const web = 'http://web';
// Requests reach the container through Caddy, which adds Via; Nginx treats those as proxied.
const browser = { 'Accept-Encoding': 'gzip, deflate, br, zstd', Via: '1.1 Caddy' };

// Mirrors the API's JSON and SSE headers (server/src/app.ts, server/src/realtime/group-events.ts).
const apiJsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-powered-by': 'Express' };
const api = createServer((req, res) => {
  if (req.url === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    // Stay open like a live group stream; only the first event is expected promptly.
    res.write('event: ready\ndata: {}\n\n');
    return;
  }
  res.writeHead(200, apiJsonHeaders);
  // Large enough that Nginx would compress it if gzip applied to /api/.
  res.end(JSON.stringify({ groups: Array.from({ length: 200 }, (_, i) => ({ id: `group-${i}`, name: 'Costco friends' })) }));
});

before(async () => {
  api.listen(3000);
  await once(api, 'listening');
  await waitForWeb();
});
after(() => {
  api.closeAllConnections();
  api.close();
});

test('the hashed entry chunk is gzipped for browsers that accept it', async () => {
  const response = await get(await entryChunk(), browser);
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-encoding'], 'gzip');
  assert.match(response.headers.vary ?? '', /Accept-Encoding/i);
  assert.ok(gunzipSync(response.body).length > response.body.length);
});

test('index.html, stylesheets and fonts are gzipped too', async () => {
  const index = (await get('/')).body.toString();
  const stylesheet = index.match(/href="(\/assets\/index-[^"]+\.css)"/)?.[1];
  assert.ok(stylesheet, 'index.html links a hashed stylesheet');
  for (const path of ['/', stylesheet, '/fonts/dm-sans-400-normal.ttf']) {
    const response = await get(path, browser);
    assert.equal(response.headers['content-encoding'], 'gzip', path);
  }
});

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
};

test('HTML and static responses carry security headers', async () => {
  for (const path of ['/', '/index.html', await entryChunk(), '/favicon.svg']) {
    const { status, headers } = await get(path, browser);
    assert.equal(status, 200, path);
    for (const [name, value] of Object.entries(securityHeaders)) assert.equal(headers[name], value, `${name} on ${path}`);
  }
});

test('hashed assets are cached for a year and index.html is revalidated', async () => {
  assert.equal((await get(await entryChunk(), browser)).headers['cache-control'], 'public, max-age=31536000, immutable');
  // Hash routes are client-side, so other paths fall back to the same index.html.
  for (const path of ['/', '/index.html', '/no-such-page']) {
    const response = await get(path, browser);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers['cache-control'], 'no-cache', path);
  }
});

test('a missing file is a 404, not cached index.html', async () => {
  for (const path of ['/assets/index-missing.js', '/fonts/missing.woff2', '/missing.svg']) {
    const response = await get(path, browser);
    assert.equal(response.status, 404, path);
    // A rollback can make the same hashed name valid again; never cache its absence.
    assert.equal(response.headers['cache-control'], 'no-store', path);
    assert.doesNotMatch(text(response), /id="root"/, path);
  }
});

test('API responses keep their own headers and are not compressed', async () => {
  const response = await get('/api/groups', browser);
  assert.equal(response.status, 200);
  for (const [name, value] of Object.entries(apiJsonHeaders)) assert.equal(response.headers[name], value);
  // Nginx may only add transport headers; anything else changes API behavior.
  const allowed = new Set([...Object.keys(apiJsonHeaders), 'server', 'date', 'connection', 'content-length', 'transfer-encoding']);
  assert.deepEqual(Object.keys(response.headers).filter((name) => !allowed.has(name)), []);
  assert.equal(JSON.parse(response.body).groups.length, 200);
});

test('the group SSE stream delivers events without waiting for more data', async () => {
  const { response, first } = await firstChunk('/api/events', browser);
  try {
    assert.equal(response.headers['content-type'], 'text/event-stream');
    assert.equal(response.headers['content-encoding'], undefined);
    assert.match(first.toString(), /event: ready/);
  } finally {
    response.destroy();
  }
});

/** Resolve the Vite entry chunk named in index.html. */
async function entryChunk() {
  const { body } = await get('/');
  const path = body.toString().match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  assert.ok(path, 'index.html names a hashed entry chunk');
  return path;
}

async function waitForWeb() {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await get('/');
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

function text({ headers, body }) {
  return (headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body).toString();
}

/** Resolve with the first body chunk, failing if Nginx holds it back. */
function firstChunk(path, headers) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no data from ${path} within 2s`)), 2000);
    request(new URL(path, web), { headers }, (response) => {
      response.once('data', (first) => {
        clearTimeout(timer);
        resolve({ response, first });
      });
      response.on('error', reject);
    }).on('error', reject).end();
  });
}

/** Raw request: bodies stay encoded so the checks see exactly what Nginx sent. */
function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    // A connection Nginx accepts but never answers must still fail the check.
    request(new URL(path, web), { headers, timeout: 5000 }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    }).on('timeout', function () {
      this.destroy(new Error(`no response from ${path} within 5s`));
    }).on('error', reject).end();
  });
}
