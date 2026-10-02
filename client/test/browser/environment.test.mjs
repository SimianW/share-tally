// A start-up that fails part-way disposes everything it had already started.
// Needs Docker: node --test test/browser/environment.test.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { startEnvironment } from './environment.mjs';

const run = promisify(execFile);
const containerExists = id => run('docker', ['inspect', id]).then(() => true, () => false);
function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

// Starts an environment that fails right after `stage`, keeping what each stage reported.
async function failAfter(stage) {
  const started = {};
  await assert.rejects(startEnvironment({
    checkpoint: async (reached, details) => {
      Object.assign(started, details);
      if (reached === stage) throw new Error(`Injected failure after ${stage}`);
    },
  }), new RegExp(`Injected failure after ${stage}`));
  return started;
}

test('a failure after the database starts removes its container', async () => {
  const { containerId } = await failAfter('database');
  assert.ok(containerId);
  assert.equal(await containerExists(containerId), false, 'PostgreSQL container was left behind');
});

test('a failure after the API starts stops it and removes the database', async () => {
  const { containerId, pid } = await failAfter('api');
  assert.ok(containerId && pid);
  assert.equal(processExists(pid), false, 'API process was left running');
  assert.equal(await containerExists(containerId), false, 'PostgreSQL container was left behind');
});

test('a failure after Vite starts closes it', async () => {
  const { base } = await failAfter('vite');
  await assert.rejects(fetch(base), 'Vite server was left running');
});

for (const stage of ['browser-container-created', 'browser-container', 'browser']) test(`a failure at ${stage} removes the browser container and application resources`, async () => {
  const { browser, browserContainerId, containerId, pid, base } = await failAfter(stage);
  assert.ok(browserContainerId);
  assert.equal(await containerExists(browserContainerId), false, 'Browser container was left behind');
  assert.equal(await containerExists(containerId), false, 'PostgreSQL container was left behind');
  assert.equal(processExists(pid), false, 'API process was left running');
  await assert.rejects(fetch(base), 'Vite server was left running');
  if (browser) assert.equal(browser.isConnected(), false, 'Chromium was left running');
});

test('normal disposal removes the browser container and is safe to call twice', async () => {
  let browserContainerId;
  const env = await startEnvironment({ backend: false, checkpoint(stage, details) {
    if (stage === 'browser-container') browserContainerId = details.browserContainerId;
  } });
  await env.dispose();
  await env.dispose();
  assert.equal(await containerExists(browserContainerId), false);
  assert.equal(env.browser.isConnected(), false);
});

for (const remoteHost of [null, 'receipt.test']) test(`browser and route.fetch keep the ${remoteHost ?? 'localhost'} origin`, async () => {
  const env = await startEnvironment({ backend: false, remoteHost });
  try {
    const page = await env.pageFor(null);
    let fetched = false;
    await page.route('**/relay-check', async route => {
      const upstream = new URL(env.base);
      upstream.hostname = '127.0.0.1';
      const response = await route.fetch({ url: upstream.href });
      fetched = response.ok();
      await route.fulfill({ response, contentType: 'text/html', body: '<p>Relay works</p>' });
    });
    await page.goto(`${env.base}relay-check`);
    assert.equal(fetched, true, 'route.fetch could not reach the application from the browser container');
    assert.equal(await page.locator('p').innerText(), 'Relay works');
    assert.equal(await page.evaluate(() => isSecureContext), !remoteHost);
    assert.equal(new URL(page.url()).hostname, remoteHost ?? '127.0.0.1');
  } finally { await env.dispose(); }
});

test('a failed browser connection removes the already started container', async () => {
  let browserContainerId;
  await assert.rejects(startEnvironment({ backend: false, async checkpoint(stage, details) {
    if (stage === 'browser-container') {
      browserContainerId = details.browserContainerId;
      await run('docker', ['stop', '--time', '1', browserContainerId]);
    }
  } }));
  assert.equal(await containerExists(browserContainerId), false);
});
