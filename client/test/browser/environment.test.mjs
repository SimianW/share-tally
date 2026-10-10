// A start-up that fails part-way disposes everything it had already started.
// Needs Docker: node --test test/browser/environment.test.mjs
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { clientRoot, startEnvironment } from './environment.mjs';

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

test('a completed component scenario lets the runner exit naturally', { timeout: 30_000 }, async () => {
  const { stdout } = await run(process.execPath, ['test/browser/run.mjs', 'avatar'], {
    cwd: clientRoot, timeout: 25_000,
  });
  assert.match(stdout, /1 of 1 browser scenarios passed/);
});

for (const signal of ['SIGTERM', 'SIGINT']) test(`the runner awaits container cleanup on ${signal}`, { timeout: 60_000 }, async () => {
  const runnerId = randomUUID();
  const runner = spawn(process.execPath, ['test/browser/run.mjs', 'group-refresh'], {
    cwd: clientRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SHARE_TALLY_BROWSER_RUNNER: runnerId },
  });
  let output = '';
  for (const stream of [runner.stdout, runner.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-8000); });
  const exited = once(runner, 'exit');
  try {
    let browserContainerId;
    const deadline = Date.now() + 30_000;
    while (!browserContainerId && Date.now() < deadline) {
      const { stdout } = await run('docker', ['ps', '-q', '--filter', `label=share-tally.browser-runner=${runnerId}`]);
      browserContainerId = stdout.trim();
      if (runner.exitCode !== null || runner.signalCode !== null) break;
      if (!browserContainerId) await delay(100);
    }
    assert.ok(browserContainerId, `Runner did not start a browser container: ${output}`);
    runner.kill(signal);
    const [code] = await exited;
    assert.equal(code, 130, output);
    assert.equal(await containerExists(browserContainerId), false, 'Runner exited before removing its browser container');
  } finally {
    if (runner.exitCode === null && runner.signalCode === null) {
      runner.kill('SIGKILL');
      await exited;
    }
  }
});
