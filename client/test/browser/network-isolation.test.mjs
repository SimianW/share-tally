// Keep real module requests in flight while unrelated Docker bridges change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Network } from 'testcontainers';
import { startEnvironment } from './environment.mjs';

const fixture = '/__network-isolation/';
const moduleCount = 120;

test('JavaScript modules finish loading through unrelated Docker bridge changes', async () => {
  const env = await startEnvironment({ backend: false });
  const received = Promise.withResolvers();
  const queued = Promise.withResolvers();
  const release = Promise.withResolvers();
  // Serve a small module graph before Vite's transforms. Hold the actual HTTP
  // responses until Chromium has queued all imports and the bridge changes end.
  const middleware = { route: '', handle(request, response, next) {
    if (!request.url?.startsWith(fixture)) return next();
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === `${fixture}index.html`) {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<script type="module">${Array.from({ length: moduleCount }, (_, i) => `import './module-${i}.js';`).join('\n')}document.body.textContent = 'Modules loaded';</script><body></body>`);
    } else {
      response.setHeader('Content-Type', 'text/javascript');
      received.resolve();
      release.promise.then(() => response.end('export default 1;'));
    }
  } };
  env.vite.middlewares.stack.unshift(middleware);
  try {
    const page = await env.pageFor(null);
    const modules = new Set();
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith(`${fixture}module-`)) modules.add(path);
      if (modules.size === moduleCount) queued.resolve();
    });
    const loaded = page.goto(new URL(`${fixture}index.html`, env.base).href);
    loaded.catch(() => {});
    await Promise.race([
      Promise.all([received.promise, queued.promise]),
      loaded.then(() => { throw new Error('The module fixture finished before the network experiment'); }),
    ]);
    for (let i = 0; i < 3; i++) {
      const network = await new Network().start();
      await network.stop();
    }
    release.resolve();
    await loaded;
    assert.deepEqual([...env.networkChangeFailures], [], 'Network changes aborted browser resources');
    assert.equal(await page.locator('body').innerText(), 'Modules loaded');
    assert.deepEqual(env.errors, []);
  } finally {
    release.resolve();
    env.vite.middlewares.stack.splice(env.vite.middlewares.stack.indexOf(middleware), 1);
    await env.dispose();
  }
});
