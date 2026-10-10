// Run: cd client && node scripts/measure-emoji-picker.mjs (Chromium must be installed).
// EMOJI_RUNS=5 controls cold runs per profile; EMOJI_CPU_RATE=4 optionally throttles CPU.
// EMOJI_REPORT=/path/report.json overrides test-results/emoji-measurement.json.
// EMOJI_RETRIES=3 retries whole cold runs ONLY for ERR_NETWORK_CHANGED; discarded
// runs are reported separately, never included in the successful-run medians.
// Builds production assets outside dist, substitutes only Clerk/API, and measures
// actual Chromium requests (CDP encodedDataLength includes HTTP headers). Static
// bodies are served with gzip; decoded bytes come from browser response bodies.
// deploy/nginx.conf gzips these assets too (#192), at a different level, so
// transfer sizes approximate the deployment rather than reproduce it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium, expect } from '@playwright/test';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { themeBootstrap } from '../build/theme-bootstrap.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const runs = Number(process.env.EMOJI_RUNS ?? 5);
const cpuRate = Number(process.env.EMOJI_CPU_RATE ?? 1);
const retries = Number(process.env.EMOJI_RETRIES ?? 3);
assert(Number.isInteger(retries) && retries >= 0, 'EMOJI_RETRIES must be a nonnegative integer');
assert(Number.isInteger(runs) && runs > 0, 'EMOJI_RUNS must be a positive integer');
assert(Number.isFinite(cpuRate) && cpuRate >= 1, 'EMOJI_CPU_RATE must be at least 1');
const profiles = [
  { name: 'unthrottled', latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  { name: 'fast-4g', latency: 60, downloadThroughput: 9_000_000 / 8, uploadThroughput: 1_500_000 / 8 },
];
const phases = ['home', 'group', 'icon-picker', 'emoji'];
const member = { id: 'alice', displayName: 'Alice', imageUrl: null, fallbackImageUrl: null,
  joinedAt: '2026-01-01T00:00:00.000Z', isOwner: true, isCurrentUser: true };
const group = { id: 'measurement-group', name: 'Measurement friends', icon: { type: 'lucide', value: 'shopping-basket' },
  createdBy: member.id, ownerId: member.id, ownerName: member.displayName, createdAt: member.joinedAt, joinedAt: member.joinedAt,
  memberCount: 1, isOwner: true };
const fixtures = {
  '/api/groups': { groups: [{ ...group, netCents: 0, pendingActionCount: 0, memberPreview: [member] }] },
  '/api/attention': { actions: [] },
  '/api/groups/measurement-group': { group: { ...group, members: [member] } },
  '/api/groups/measurement-group/bills': { bills: [], repayments: [],
    summary: { netCents: 0, receivableCents: 0, payableCents: 0 },
    ledger: { members: [{ userId: member.id, displayName: member.displayName, netCents: 0 }],
      formerMembers: [], suggestions: [], incompleteBillIds: [], entries: [], directDebts: [] } },
  '/api/groups/measurement-group/receipt-drafts': { drafts: [] },
};
const temp = await mkdtemp(join(tmpdir(), 'share-tally-emoji-'));
let server, browser;
try {
  execFileSync(process.execPath, [join(root, '../scripts/build-domain.mjs')], { cwd: root, stdio: 'inherit' });
  await build({
    root, configFile: false, envDir: false, logLevel: 'warn',
    define: { 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify('test-only-clerk-boundary') },
    plugins: [themeBootstrap(), { name: 'measure-clerk', enforce: 'pre', resolveId(id) {
      if (id === '@clerk/react') return `${root}/test/clerk.tsx`;
    } }, react()],
    build: { outDir: temp, emptyOutDir: true },
  });
  // Compress before the measurement, so compression CPU is not part of UI timing.
  const assets = new Map();
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' };
  async function loadAssets(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), url = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await loadAssets(path, url);
      else {
        const body = await readFile(path);
        assets.set(url, { body, gzip: gzipSync(body), type: types[extname(path)] ?? 'application/octet-stream' });
      }
    }
  }
  await loadAssets(temp);
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const asset = assets.get(path) ?? assets.get('/index.html');
    const compressed = /\bgzip\b/.test(request.headers['accept-encoding'] ?? '');
    const body = compressed ? asset.gzip : asset.body;
    response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': body.length,
      'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...(compressed ? { 'Content-Encoding': 'gzip' } : {}) });
    response.end(body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  });
  const results = [], discardedRuns = [];
  for (const profile of profiles) for (let run = 1; run <= runs; run++) for (let attempt = 1; ; attempt++) {
    const requests = [], errors = [], contexts = [], pendingBodies = new Set();
    let phase = 'home';
    async function pageFor() {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      contexts.push(context);
      await context.addInitScript(() => localStorage.setItem('smoke-token', 'alice-token'));
      await context.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: 'event: ready\ndata: {}\n\n' });
        if (!fixtures[path]) errors.push(`Unexpected API request: ${route.request().method()} ${path}`);
        await route.fulfill({ status: fixtures[path] ? 200 : 404, json: fixtures[path] ?? { error: 'Unexpected measurement API request' } });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      page.on('pageerror', error => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency,
        downloadThroughput: profile.downloadThroughput, uploadThroughput: profile.uploadThroughput });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
      const active = new Map();
      cdp.on('Network.requestWillBeSent', event => {
        const url = new URL(event.request.url);
        const record = { phase, url: url.pathname, type: event.type, api: url.pathname.startsWith('/api/'),
          transferredBytes: 0, uncompressedBytes: 0 };
        requests.push(record); active.set(event.requestId, record);
      });
      cdp.on('Network.responseReceived', event => {
        const record = active.get(event.requestId);
        if (!record) return;
        record.status = event.response.status;
        record.encoding = Object.entries(event.response.headers).find(([key]) => key.toLowerCase() === 'content-encoding')?.[1] ?? 'identity';
        record.cached = !!(event.response.fromDiskCache || event.response.fromServiceWorker);
      });
      cdp.on('Network.loadingFinished', event => {
        const record = active.get(event.requestId);
        if (!record) return;
        record.transferredBytes = event.encodedDataLength;
        record.finished = true;
        const task = cdp.send('Network.getResponseBody', { requestId: event.requestId }).then(({ body, base64Encoded }) => {
          record.uncompressedBytes = Buffer.byteLength(body, base64Encoded ? 'base64' : 'utf8');
        }).catch(error => { if (!record.api) errors.push(`Response body unavailable for ${record.url}: ${error.message}`); })
          .finally(() => pendingBodies.delete(task));
        pendingBodies.add(task);
      });
      cdp.on('Network.loadingFailed', event => {
        const record = active.get(event.requestId);
        if (record) record.failure = event.errorText;
        if (record && !record.api) errors.push(`Static request failed: ${record.url}: ${event.errorText}`);
      });
      return page;
    }
    async function settle(page) {
      await page.waitForLoadState('networkidle');
      await Promise.all([...pendingBodies]);
    }
    // Group is also a cold direct load, not a warm hash navigation. Home remains
    // open for the first picker opening so no extra Home navigation pollutes c/d.
    try {
      const home = await pageFor();
      const groupPage = await pageFor();
      await home.goto(base);
      await expect(home.locator('.home-group-name')).toHaveText(group.name);
      await expect(home.getByRole('button', { name: 'New group', exact: true }).first()).toBeVisible();
      await settle(home);
      phase = 'group';
      await groupPage.goto(`${base}/#/group-bills/${group.id}`);
      await expect(groupPage.getByRole('heading', { name: /You're settled up/ })).toBeVisible();
      await expect(groupPage.getByRole('region', { name: 'Open bills', exact: true })).toContainText('No open bills.');
      await settle(groupPage);
      phase = 'icon-picker';
      await home.getByRole('button', { name: 'New group', exact: true }).first().click();
      async function clickTimed(button, condition) {
        await button.evaluate(element => element.addEventListener('click', () => { window.measureEmojiStart = performance.now(); }, { once: true }));
        await button.click();
        const finished = await home.waitForFunction(condition, undefined, { polling: 'raf' });
        return await finished.jsonValue() - await home.evaluate(() => window.measureEmojiStart);
      }
      const pickerMs = await clickTimed(home.getByRole('button', { name: 'Choose group icon' }), () => {
        const input = document.querySelector('[aria-label="Search icons and emoji"]');
        return input && !input.disabled && document.activeElement === input && input.getBoundingClientRect().width > 0 && performance.now();
      });
      await expect(home.getByLabel('Search icons and emoji')).toBeEditable();
      await settle(home);
      phase = 'emoji';
      const emojiMs = await clickTimed(home.getByRole('button', { name: /^Emoji/ }), () => {
        const button = document.querySelector('.picker-grid button');
        return document.querySelector('.picker-sources button[aria-pressed="true"]')?.textContent.startsWith('Emoji') &&
          button && !button.disabled && button.getBoundingClientRect().width > 0 && performance.now();
      });
      await expect(home.getByRole('group', { name: 'Search results' }).getByRole('button').first()).toBeEnabled();
      await home.getByLabel('Search icons and emoji').fill('pizza');
      const pizza = home.getByRole('button', { name: 'Select pizza', exact: true });
      await expect(pizza).toBeVisible();
      await expect(pizza).toBeEnabled();
      await pizza.click();
      await expect(pizza).toHaveAttribute('aria-pressed', 'true');
      await settle(home);
      assert.deepEqual(errors, [], 'Browser/API measurement errors');
      const emojiChunks = requests.filter(request => request.phase === 'emoji' && !request.api && request.url.endsWith('.js'));
      assert(emojiChunks.length > 0, 'Emoji tab must request its on-demand JS chunk');
      for (const request of emojiChunks) {
        assert(!requests.some(earlier => earlier.phase !== 'emoji' && earlier.url === request.url), `${request.url} requested before Emoji tab`);
      }
      assert(!requests.some(request => request.phase !== 'emoji' && /\/emoji[^/]*\.js$/i.test(request.url)), 'Emoji chunk requested before Emoji tab');
      for (const request of requests.filter(request => !request.api)) {
        assert.equal(request.finished, true, `Incomplete static request: ${request.url}`);
        assert.equal(request.cached, false, `Cached static request: ${request.url}`);
        assert.equal(request.encoding, 'gzip', `Static response was not gzip: ${request.url}`);
        assert.equal(request.status, 200, `Static response failed: ${request.url}`);
      }
      results.push({ profile: profile.name, run, pickerMs, emojiMs, emojiChunks: emojiChunks.map(request => request.url), requests });
      console.log(`${profile.name} ${run}/${runs}: icon ${pickerMs.toFixed(1)} ms, emoji ${emojiMs.toFixed(1)} ms`);
      break;
    } catch (error) {
      console.error(`${profile.name} run ${run}, attempt ${attempt}: ${error.message}`);
      if (errors.length) console.error(errors.join('\n'));
      if (!requests.some(request => request.failure === 'net::ERR_NETWORK_CHANGED') || attempt > retries) throw error;
      console.error('Discarding interrupted run (ERR_NETWORK_CHANGED); retrying in fresh cold contexts.');
      discardedRuns.push({ profile: profile.name, run, attempt, phase, error: error.message, errors, requests });
    } finally { await Promise.all(contexts.map(context => context.close())); }
  }
  function median(values) {
    const sorted = values.toSorted((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  const summary = profiles.flatMap(profile => phases.map(phase => {
    const measurements = results.filter(result => result.profile === profile.name);
    const assetsFor = result => result.requests.filter(request => request.phase === phase && !request.api);
    const sum = (result, field) => assetsFor(result).reduce((total, request) => total + request[field], 0);
    return { profile: profile.name, phase, requests: median(measurements.map(result => assetsFor(result).length)),
      gzipTransferBytes: median(measurements.map(result => sum(result, 'transferredBytes'))),
      uncompressedBytes: median(measurements.map(result => sum(result, 'uncompressedBytes'))),
      medianInteractiveMs: phase === 'icon-picker' ? median(measurements.map(result => result.pickerMs)) :
        phase === 'emoji' ? median(measurements.map(result => result.emojiMs)) : null };
  }));
  console.log(`\n${runs} cold runs/profile; desktop 1280×900; CPU ×${cpuRate}; ${discardedRuns.length} network-interrupted runs discarded.`);
  console.log('Fast 4G: 9 Mbps down, 1.5 Mbps up, 60 ms latency; unthrottled: no network limit.');
  console.log('Static requests only in table (HTML/CSS/JS/etc); JSON records every request including stubbed API.');
  console.log('Gzip transfer includes HTTP headers; uncompressed = decoded response body bytes.');
  console.log('Icon timing: Choose group icon → focused usable search. Emoji timing: Emoji → first visible enabled result.');
  console.log('Deployment observation: nginx does not enable gzip and deployed JS had no Content-Encoding; this models gzip delivery.');
  console.table(summary.map(row => ({ ...row, medianInteractiveMs: row.medianInteractiveMs?.toFixed(1) ?? '—' })));
  const report = process.env.EMOJI_REPORT ?? join(root, 'test-results/emoji-measurement.json');
  await mkdir(dirname(report), { recursive: true });
  await writeFile(report, JSON.stringify({ commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    measuredAt: new Date().toISOString(), browserVersion: browser.version(), nodeVersion: process.version,
    runs, cpuRate, profiles, summary, results, discardedRuns }, null, 2) + '\n');
  console.log(`Report: ${report}`);
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
