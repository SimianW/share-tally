// The one browser-test environment: isolated PostgreSQL with migrations, the
// test Express application, Vite with the test-only Clerk substitute, and
// Chromium pages bound to test identities. Every scenario starts its own and
// disposes everything it started, including after a partial start-up.
// Real UI + Express + temporary PostgreSQL. Only Clerk and the receipt
// providers are replaced; this does not verify Google OAuth, production
// credentials, or session lifetime.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { themeBootstrap } from '../../build/theme-bootstrap.ts';

export const clientRoot = fileURLToPath(new URL('../../', import.meta.url));
export const serverRoot = fileURLToPath(new URL('../../../server/', import.meta.url));
export const screenshots = `${clientRoot}test-results`;
// Server-side test dependencies (PostgreSQL, migrations, image fixtures) come from the server package.
export const serverRequire = createRequire(`${serverRoot}package.json`);

const postgresImage = 'postgres:17.6-alpine';
const apiStartupTimeout = 30_000;

// Options:
// - backend: start PostgreSQL and the API (default). Component-only scenarios turn it off.
// - remoteHost: serve the app under this non-loopback host name over plain HTTP, mapped to
//   127.0.0.1 inside Chromium, to reproduce a remote development browser's insecure context.
// - firstExtractionFails: the test receipt provider fails its first scan on purpose.
// - checkpoint(stage, details): awaited after each start-up stage. Throwing from it
//   simulates a failed start-up; resources already started are still disposed.
export async function startEnvironment({ backend = true, remoteHost = null, firstExtractionFails = false, checkpoint = async () => {} } = {}) {
  const disposers = [];
  const errors = [];
  const networkChangeFailures = new Map();
  let disposal;
  const dispose = () => disposal ??= (async () => {
    const failures = [];
    while (disposers.length) {
      try { await disposers.pop()(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Browser test environment was not fully disposed');
  })();
  try {
    let pool, api;
    if (backend) {
      const { PostgreSqlContainer } = serverRequire('@testcontainers/postgresql');
      const { Pool } = serverRequire('pg');
      const { drizzle } = serverRequire('drizzle-orm/node-postgres');
      const { migrate } = serverRequire('drizzle-orm/node-postgres/migrator');
      const container = await new PostgreSqlContainer(postgresImage).start();
      disposers.push(() => container.stop());
      await checkpoint('database', { containerId: container.getId() });
      pool = new Pool({ connectionString: container.getConnectionUri() });
      disposers.push(() => pool.end());
      await migrate(drizzle(pool), { migrationsFolder: `${serverRoot}drizzle` });
      api = await startApi(container.getConnectionUri(), { firstExtractionFails }, disposers);
      await checkpoint('api', { pid: api.child.pid });
    }

    const vite = await createServer({
      root: clientRoot, configFile: false, envDir: false, logLevel: 'warn',
      // Keep the test-only Clerk bundle separate from production dependency caching.
      cacheDir: `${clientRoot}node_modules/.vite-smoke`,
      define: { 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify('test-only-clerk-boundary') },
      plugins: [themeBootstrap(), { name: 'smoke-clerk', enforce: 'pre', resolveId(id) {
        if (id === '@clerk/react') return `${clientRoot}test/clerk.tsx`;
      } }, react()],
      optimizeDeps: { exclude: ['@clerk/react'] },
      server: {
        host: '127.0.0.1', port: 0,
        ...(remoteHost ? { allowedHosts: [remoteHost] } : {}),
        ...(api ? { proxy: { '/api': api.url } } : {}),
      },
    });
    disposers.push(() => vite.close());
    await vite.listen();
    const origin = new URL(vite.resolvedUrls.local[0]);
    if (remoteHost) origin.hostname = remoteHost;
    await checkpoint('vite', { base: origin.href });

    const browser = await chromium.launch({
      // Playwright would otherwise exit the process on a signal before the database is disposed.
      handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
      ...(remoteHost ? { args: [`--host-resolver-rules=MAP ${remoteHost} 127.0.0.1`, '--no-proxy-server'] } : {}),
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    });
    disposers.push(() => browser.close());
    await checkpoint('browser', { browser });
    await mkdir(screenshots, { recursive: true });

    // A page in its own browser context, signed in as `identity` (or signed out when null).
    async function pageFor(identity, viewport) {
      const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] });
      if (identity) await context.addInitScript(token => {
        if (!sessionStorage.getItem('smoke-initialized')) {
          localStorage.setItem('smoke-token', token);
          sessionStorage.setItem('smoke-initialized', 'yes');
        }
      }, identity);
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('requestfailed', request => {
        if (request.failure()?.errorText !== 'net::ERR_NETWORK_CHANGED') return;
        // Report resource paths only, never authorization headers or query strings.
        const resource = `${request.resourceType()} ${new URL(request.url()).pathname}`;
        networkChangeFailures.set(resource, (networkChangeFailures.get(resource) ?? 0) + 1);
      });
      page.on('console', message => {
        if (message.text().includes('net::ERR_NETWORK_CHANGED')) return;
        if (message.type() !== 'error') return;
        console.error('Browser console:', message.text());
        if (message.text().includes('Encountered two children')) errors.push(message.text());
      });
      return page;
    }

    // An authenticated JSON request straight to the API; any failure status fails the test.
    async function apiRequest(path, token = 'alice-token', method = 'GET', body) {
      const response = await fetch(`${api.url}/api${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.ok(response.ok, await response.clone().text());
      return response.json();
    }

    return {
      base: origin.href, apiUrl: api?.url, pool, vite, browser, errors, networkChangeFailures,
      pageFor, api: apiRequest,
      // Sends a test-provider command to the API process.
      sendToServer: message => api.child.send(message),
      // Resolves when the API process sends `expected`, after sending `command` if given.
      waitForServer: (expected, command) => api.waitFor(expected, command),
      dispose,
    };
  } catch (error) {
    try { await dispose(); } catch (disposalError) { console.error(disposalError); }
    throw error;
  }
}

// The test entry point replaces Clerk and the receipt providers; production entry points never import it.
async function startApi(databaseUrl, { firstExtractionFails }, disposers) {
  const child = fork(`${serverRoot}test/server-process.ts`, {
    cwd: serverRoot, execArgv: ['--import=tsx'],
    env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl, TEST_FIRST_EXTRACTION_FAILS: firstExtractionFails ? '1' : '0' },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  // Waits still pending at disposal are dropped, so they cannot fail a later scenario.
  const pending = new Set();
  disposers.push(async () => {
    for (const { timer, received } of pending) { clearTimeout(timer); child.off('message', received); }
    pending.clear();
    await stopProcess(child);
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API startup timed out')), apiStartupTimeout);
    child.once('message', value => { clearTimeout(timer); resolve(value); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`API exited: ${code}`)); });
  });
  function waitFor(expected, command) {
    return new Promise((resolve, reject) => {
      const wait = {};
      const settle = () => { clearTimeout(wait.timer); child.off('message', wait.received); pending.delete(wait); };
      wait.timer = setTimeout(() => {
        settle();
        reject(new Error(`Timed out waiting for server message ${expected}`));
      }, 15_000);
      wait.received = message => {
        if (message !== expected) return;
        settle();
        resolve();
      };
      pending.add(wait);
      child.on('message', wait.received);
      if (command) child.send(command);
    });
  }
  return { child, url: `http://127.0.0.1:${port}`, waitFor };
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  child.kill('SIGTERM');
  try { await exited; } finally { clearTimeout(timer); }
}
