import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { screenshots } from '../environment.mjs';
import { expect } from '@playwright/test';
import { aliceBill, costcoFriends } from './fixtures.mjs';
import { groupNet } from '../ui.mjs';

export const scenarios = [{ name: 'shared-sse-renewal', run: sharedRenewal }];

async function sharedRenewal(env) {
  const { group } = await costcoFriends(env);
  const page = await env.pageFor('alice-token', { width: 1280, height: 900 });
  const streams = [];
  page.on('request', request => { if (new URL(request.url()).pathname === `/api/groups/${group.id}/events`) streams.push(request); });
  await page.goto(`${env.base}#/group-bills/${group.id}`);
  await expect(groupNet(page)).toContainText("You're settled up");
  assert.equal(streams.length, 1, 'Workspace and drafts share a subscription');
  await page.getByRole('button', { name: 'Members & invites', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Bob');
  assert.equal(streams.length, 1, 'A late members view joins the existing subscription');
  await expect.poll(() => streams.length, { timeout: 28_000 }).toBe(2);
  await expect(page.getByText('Live updates interrupted', { exact: false })).toHaveCount(0);
  const members = (await env.api(`/groups/${group.id}`, 'bob-token')).group.members;
  await env.api(`/groups/${group.id}/bills`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), title: 'After renewal', purchaseDate: '2026-10-03', timeZone: 'America/Toronto', notes: '',
    totalCents: 100, participantIds: [members.find(member => member.isCurrentUser).id],
  });
  await expect(page.getByRole('region', { name: 'Open bills', exact: true })).toContainText('After renewal');
  assert.equal(streams.length, 2, 'Renewal creates one replacement');
}

// Observe and delay the browser's HTTP boundary, retaining the real API streams.
async function observeStreams(page) {
  await page.addInitScript(() => {
    window.sseTest = { attempts: 0, active: 0, maxActive: 0, holds: {}, failures: [], starts: [], closed: [] };
    const original = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      if (!String(url).endsWith('/events')) return original(url, options);
      const state = window.sseTest;
      state.ready ??= 0; state.gaps ??= 0;
      const attempt = ++state.attempts;
      state.starts.push(performance.now());
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      let ended = false, subscribed = false;
      const close = () => { if (!ended) { ended = true; state.active--; state.closed.push(attempt);
        if (subscribed) { state.ready--; if (state.ready === 0 && document.visibilityState === 'visible') state.gaps++; } } };
      options.signal.addEventListener('abort', close, { once: true });
      try {
        if (state.failures.includes(attempt)) { close(); return new Response(null, { status: 503 }); }
        const response = await original(url, options);
        if (state.holds[attempt]) await new Promise(resolve => setTimeout(resolve, state.holds[attempt]));
        if (!response.body) return response;
        let frames = '';
        const decoder = new TextDecoder();
        const observed = response.body.pipeThrough(new TransformStream({
          transform(chunk, controller) {
            frames += decoder.decode(chunk, { stream: true });
            let end;
            while ((end = frames.indexOf('\n\n')) >= 0) {
              const frame = frames.slice(0, end); frames = frames.slice(end + 2);
              if (frame.startsWith('event: ready') && !subscribed && !ended) {
                subscribed = true; state.ready++;
                state.firstReadyAt ??= performance.now();
              }
            }
            controller.enqueue(chunk);
          },
          flush: close,
        }));
        return new Response(observed, { status: response.status, headers: response.headers });
      } catch (error) { close(); throw error; }
    };
    window.smokeTokenControl = { calls: 0 };
    window.interruptions = [];
    window.addEventListener('DOMContentLoaded', () => new MutationObserver(() => {
      if (document.body.innerText.includes('Live updates interrupted')) window.interruptions.push(performance.now());
    }).observe(document.body, { subtree: true, childList: true, characterData: true }));
  });
}

async function setupRenewal(env, lifetime = 7000) {
  await env.waitForServer('stream-lifetime-set', { streamLifetimeMs: lifetime });
  const { group, ids } = await costcoFriends(env);
  const page = await env.pageFor('alice-token', { width: 1280, height: 900 });
  await observeStreams(page);
  await page.goto(`${env.base}#/group-bills/${group.id}`);
  await expect(groupNet(page)).toContainText("You're settled up");
  return { page, group, ids };
}
async function createBill(env, group, ids, title) {
  return env.api(`/groups/${group.id}/bills`, 'alice-token', 'POST', {
    requestId: crypto.randomUUID(), title, purchaseDate: '2026-10-03', timeZone: 'America/Toronto', notes: '',
    totalCents: 100, participantIds: [ids.Alice, ids.Bob],
  });
}

async function candidateRecovery(env) {
  const { page, group, ids } = await setupRenewal(env);
  await page.evaluate(() => { window.sseTest.failures = [2]; window.sseTest.holds[3] = 8000; });
  await expect.poll(() => page.evaluate(() => window.sseTest.attempts), { timeout: 5000 }).toBe(3);
  await expect(page.getByText('Live updates interrupted', { exact: false })).toHaveCount(0);
  await createBill(env, group, ids, 'While old stream is healthy');
  await expect(page.getByRole('region', { name: 'Open bills', exact: true })).toContainText('While old stream is healthy');
  await expect(page.getByText('Live updates interrupted', { exact: false }).first()).toBeVisible({ timeout: 7000 });
  assert.equal(await page.evaluate(() => window.sseTest.attempts), 3, 'Old expiry does not compete with the pending candidate');
  await expect(page.getByText('Live updates interrupted', { exact: false })).toHaveCount(0, { timeout: 7000 });
  assert.equal(await page.evaluate(() => window.sseTest.maxActive), 2);
}

async function readFailureAndHandoff(env) {
  const { page, group, ids } = await setupRenewal(env, 10_000);
  let release, captured = false, finished;
  const completed = new Promise(resolve => { finished = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const pattern = `**/api/groups/${group.id}/bills`;
  await page.route(pattern, async route => {
    const response = await route.fetch();
    captured = true;
    await held;
    await route.fulfill({ response });
    finished();
  }, { times: 1 });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => captured).toBe(true);
  await expect.poll(() => page.evaluate(() => window.sseTest.attempts), { timeout: 7000 }).toBe(2);
  await createBill(env, group, ids, 'New authoritative snapshot');
  await expect(page.getByRole('region', { name: 'Open bills', exact: true })).toContainText('New authoritative snapshot');
  release();
  await completed;
  await page.unroute(pattern);
  // Returning from cache must still contain the post-handoff snapshot.
  await page.getByRole('button', { name: 'Members & invites', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Bob');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('region', { name: 'Open bills', exact: true })).toContainText('New authoritative snapshot');
  let failedReads = 0;
  await page.route(pattern, route => { failedReads++; return route.fulfill({ status: 503, json: { error: 'Read unavailable' } }); });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Live updates interrupted', { exact: false })).toHaveCount(1);
  const attempts = await page.evaluate(() => window.sseTest.attempts);
  const before = failedReads;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => failedReads).toBeGreaterThan(before);
  assert.equal(await page.evaluate(() => window.sseTest.attempts), attempts, 'Manual read retry preserves a healthy channel');
  await page.unroute(pattern);
  await expect(page.getByText('Live updates interrupted', { exact: false })).toHaveCount(0, { timeout: 5000 });
}

async function tokenDeadlineAndBackground(env) {
  const { page, group, ids } = await setupRenewal(env);
  await page.evaluate(() => { window.smokeTokenControl.delayMs = 12_000; });
  await expect.poll(() => page.evaluate(() => window.smokeTokenControl.calls), { timeout: 5000 }).toBe(2);
  await expect(page.getByText('Live updates interrupted', { exact: false }).first()).toBeVisible({ timeout: 7000 });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.smokeTokenControl.delayMs = 0;
  });
  const count = await page.evaluate(() => window.sseTest.attempts);
  await createBill(env, group, ids, 'While suspended');
  await page.waitForTimeout(8000); // SDK completion arrives while hidden and must not subscribe.
  assert.equal(await page.evaluate(() => window.sseTest.attempts), count);
  assert.equal(await page.evaluate(() => window.sseTest.active), 0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByRole('region', { name: 'Open bills', exact: true })).toContainText('While suspended');
  assert.equal(await page.evaluate(() => window.sseTest.attempts), count + 1);
  await expect(page.getByText('Live updates interrupted', { exact: false })).toHaveCount(0);
  await page.goto(`${env.base}#/`);
  await expect(page.getByRole('heading', { name: /Hey Alice/ })).toBeVisible();
  assert.ok(await page.evaluate(() => window.sseTest.closed.includes(1)));
}

scenarios.push(
  { name: 'sse-candidate-recovery', run: candidateRecovery },
  { name: 'sse-read-handoff', run: readFailureAndHandoff },
  { name: 'sse-token-background', run: tokenDeadlineAndBackground },
);

async function attemptDeadline(env) {
  const { page, group, ids } = await setupRenewal(env);
  await page.evaluate(() => { window.sseTest.holds[2] = 20_000; });
  await expect.poll(() => page.evaluate(() => window.sseTest.attempts), { timeout: 4000 }).toBe(2);
  await expect(page.getByText('Live updates interrupted', { exact: false }).first()).toBeVisible({ timeout: 7000 });
  await expect.poll(() => page.evaluate(() => window.sseTest.closed.includes(2)), { timeout: 7000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.sseTest.attempts), { timeout: 3000 }).toBe(3);
  const starts = await page.evaluate(() => window.sseTest.starts);
  assert.ok(starts[2] - starts[1] >= 10_900 && starts[2] - starts[1] < 12_500, 'Setup is bounded to ten seconds, followed by the first retry delay');
  await createBill(env, group, ids, 'After timed-out setup');
  await expect(page.getByRole('region', { name: 'Open bills', exact: true })).toContainText('After timed-out setup');
  assert.equal(await page.evaluate(() => window.sseTest.maxActive), 2);
}

async function tokenFailure(env) {
  const { page, group, ids } = await setupRenewal(env);
  await page.evaluate(() => { window.smokeTokenControl.fail = true; });
  await expect.poll(() => page.evaluate(() => window.smokeTokenControl.calls), { timeout: 5000 }).toBeGreaterThan(1);
  await expect(page.getByText('Live updates interrupted', { exact: false })).toHaveCount(0);
  await createBill(env, group, ids, 'Token service is unavailable');
  await expect(page.getByRole('region', { name: 'Open bills', exact: true })).toContainText('Token service is unavailable');
  await expect(page.getByText('Live updates interrupted', { exact: false }).first()).toBeVisible({ timeout: 7000 });
  await expect(groupNet(page)).toContainText("You're settled up");
  await page.evaluate(() => { window.smokeTokenControl.fail = false; });
  await page.getByRole('button', { name: 'Try again', exact: true }).first().click();
  await expect(page.getByText('Live updates interrupted', { exact: false })).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.sseTest.attempts), 2, 'Token-provider failures never open unauthenticated requests');
}
scenarios.push(
  { name: 'sse-attempt-deadline', run: attemptDeadline },
  { name: 'sse-token-failure', run: tokenFailure },
);

// A repeatable healthy-connectivity measurement, including two real 30 s handoffs.
// Controlled tokens and a local proxy cannot validate Clerk or the public FRP path.
async function renewalSoak(env, screens) {
  const { group, ids } = await costcoFriends(env);
  const initialSnapshots = [];
  const pages = [];
  // Cold Vite transforms and twenty simultaneous page loads are a separate load
  // test. Establish each screen before measuring delivery to all twenty.
  for (let index = 0; index < screens; index++) {
    const page = await env.pageFor('alice-token', { width: 1280, height: 900 });
    await observeStreams(page);
    await page.goto(`${env.base}#/group-bills/${group.id}`);
    await expect(groupNet(page)).toContainText("You're settled up");
    initialSnapshots.push(await page.evaluate(() => ({
      openToReadyMs: window.sseTest.firstReadyAt - window.sseTest.starts[0],
      readyToRenderedSnapshotMs: performance.now() - window.sseTest.firstReadyAt,
      openToRenderedSnapshotMs: performance.now() - window.sseTest.starts[0],
    })));
    pages.push(page);
  }
  const baselineAttempts = await Promise.all(pages.map(page => page.evaluate(() => window.sseTest.attempts)));
  const measurements = [];
  const started = performance.now();
  for (let index = 0; index < 64; index++) {
    // Space writes over more than two renewal boundaries without accumulating drift.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, started + index * 850 - performance.now())));
    const title = `Soak ${index}`;
    const begin = performance.now();
    await createBill(env, group, ids, title);
    const committed = performance.now();
    const observed = await Promise.all(pages.map(async page => {
      await expect(page.getByRole('region', { name: 'Open bills', exact: true }).getByRole('link', { name: new RegExp(`^${title}\\b`) })).toBeVisible();
      return performance.now() - committed;
    }));
    measurements.push({ index, writeMs: committed - begin, commitResponseToSlowestViewMs: Math.max(...observed), writeStartedToSlowestViewMs: performance.now() - begin });
  }
  const connectionStats = await Promise.all(pages.map((page, index) => page.evaluate(baseline => ({
    attempts: window.sseTest.attempts, maxActive: window.sseTest.maxActive, active: window.sseTest.active,
    replacementsDuringSoak: window.sseTest.attempts - baseline,
    subscriptionGaps: window.sseTest.gaps, interruptionFlashes: window.interruptions.length, tokenRefreshes: window.smokeTokenControl.calls,
  }), baselineAttempts[index])));
  for (const stats of connectionStats) {
    assert.ok(stats.replacementsDuringSoak >= 2, 'At least two planned replacements per screen during measurement');
    assert.equal(stats.active, 1);
    assert.equal(stats.maxActive, 2);
    assert.equal(stats.interruptionFlashes, 0);
    assert.equal(stats.subscriptionGaps, 0);
  }
  const values = measurements.map(sample => sample.commitResponseToSlowestViewMs).sort((a, b) => a - b);
  const report = { screens, samples: values.length, path: 'local deploy nginx API directives + Vite + controlled Clerk',
    latencyDefinition: 'API commit-response received to all rendered views, including assertion polling; commit itself precedes the response. Raw samples also include request-start to all views.',
    p50Ms: values[Math.floor(values.length * .5)], p99Ms: values[Math.ceil(values.length * .99) - 1], maxMs: values.at(-1),
    initialSnapshotDefinition: 'First stream fetch to ready, then ready to rendered initial group snapshot; render timing includes browser assertion polling and measurement overhead.',
    initialSnapshots, convergenceFailures: 0, connectionStats, measurements };
  await writeFile(`${screenshots}/sse-soak-${screens}.json`, JSON.stringify(report, null, 2));
  console.log(`SSE soak through nginx: ${JSON.stringify({ screens, p50: report.p50Ms, p99: report.p99Ms, max: report.maxMs, samples: values.length, interruptionFlashes: 0 })}`);
}
scenarios.push(
  { name: 'sse-nginx-soak-one', environment: { nginx: true }, run: env => renewalSoak(env, 1) },
  { name: 'sse-nginx-soak-twenty', environment: { nginx: true }, run: env => renewalSoak(env, 20) },
);

async function deletionDuringRenewal(env) {
  const { page, group } = await setupRenewal(env);
  await page.evaluate(() => { window.sseTest.holds[2] = 5000; });
  await expect.poll(() => page.evaluate(() => window.sseTest.attempts), { timeout: 5000 }).toBe(2);
  await env.api(`/groups/${group.id}`, 'alice-token', 'DELETE');
  await expect(page.getByRole('heading', { name: /Hey Alice/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Costco friends/ })).toHaveCount(0);
  assert.ok(await page.evaluate(() => window.sseTest.closed.includes(1) && window.sseTest.closed.includes(2)), 'Deletion closes both sides of the handoff');
}
async function confirmedAuthenticationLoss(env) {
  const { page, group, ids } = await setupRenewal(env);
  await createBill(env, group, ids, 'Protected bill');
  await expect(page.getByRole('region', { name: 'Open bills', exact: true })).toContainText('Protected bill');
  await page.evaluate(() => { window.smokeTokenControl.missing = true; });
  await expect(page.getByText('Please sign in again.', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('region', { name: 'Open bills', exact: true })).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.sseTest.active), 0);
}
async function tokenDeadline(env) {
  const { page } = await setupRenewal(env);
  await page.evaluate(() => { window.smokeTokenControl.delayMs = 12_000; });
  await expect(page.getByText('Live updates interrupted', { exact: false }).first()).toBeVisible({ timeout: 9000 });
  // The first attempt times out at 12 s; its shared SDK refresh resolves at 14 s.
  await expect.poll(() => page.evaluate(() => window.sseTest.attempts), { timeout: 9000 }).toBe(2);
  assert.equal(await page.evaluate(() => window.smokeTokenControl.calls), 2, 'Overlapping deadlines share the uncancellable SDK refresh');
  await expect(page.getByText('Live updates interrupted', { exact: false })).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.sseTest.active), 1);
}
scenarios.push(
  { name: 'sse-deletion-during-renewal', run: deletionDuringRenewal },
  { name: 'sse-authentication-loss', run: confirmedAuthenticationLoss },
  { name: 'sse-token-deadline', run: tokenDeadline },
);

async function initialSubscriptionFailure(env) {
  const { group } = await costcoFriends(env);
  const page = await env.pageFor('alice-token', { width: 1280, height: 900 });
  const pattern = `**/api/groups/${group.id}/events`;
  await page.route(pattern, route => route.fulfill({ status: 503 }));
  await page.goto(`${env.base}#/group-bills/${group.id}`);
  await expect(page.getByRole('alert')).toContainText("Couldn't load this group.");
  await page.unroute(pattern);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(groupNet(page)).toContainText("You're settled up");
}
async function deniedBillRead(env, status = 403) {
  const { page, group, ids } = await setupRenewal(env, 30_000);
  const { bill } = await createBill(env, group, ids, 'Protected single bill');
  await page.goto(`${env.base}#/bills/${bill.id}`);
  await expect(page.getByRole('heading', { name: 'Protected single bill', exact: true })).toBeVisible();
  await page.route(`**/api/bills/${bill.id}`, route => route.fulfill({ status, json: { error: 'Bill access revoked.' } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toContainText('Bill access revoked.');
  await expect(page.getByText('Loading bill...', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Protected single bill', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#/bills/${bill.id}$`));
}
scenarios.push(
  { name: 'sse-initial-failure', run: initialSubscriptionFailure },
  { name: 'sse-denied-bill-read', run: deniedBillRead },
  { name: 'sse-missing-bill-with-existing-group', run: env => deniedBillRead(env, 404) },
);

async function expiredCredentials(env) {
  const { page, group, ids } = await setupRenewal(env, 30_000);
  await page.evaluate(() => { window.smokeTokenControl.ordinaryToken = 'expired-token'; });
  const before = await page.evaluate(() => window.smokeTokenControl.calls);
  await createBill(env, group, ids, 'After expired read credentials');
  await expect(page.getByRole('region', { name: 'Open bills', exact: true })).toContainText('After expired read credentials');
  assert.ok(await page.evaluate(() => window.smokeTokenControl.calls) > before, 'Unauthorized reads recover with fresh credentials');
  await expect(page.getByText('Please sign in again.', { exact: true })).toHaveCount(0);
  // An unauthorized setup also gets one fresh-token recovery within its deadline.
  let setups = 0;
  const pattern = `**/api/groups/${group.id}/events`;
  await page.route(pattern, route => { setups++; return setups === 1 ? route.fulfill({ status: 401 }) : route.continue(); });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => setups).toBe(2);
  await createBill(env, group, ids, 'After expired stream credentials');
  await expect(page.getByRole('region', { name: 'Open bills', exact: true })).toContainText('After expired stream credentials');
  await expect(page.getByText('Please sign in again.', { exact: true })).toHaveCount(0);
}
scenarios.push({ name: 'sse-expired-credentials', run: expiredCredentials });

async function commandAuthenticationLoss(env) {
  const { page, group } = await setupRenewal(env, 30_000);
  await page.goto(env.base);
  await expect(page.getByRole('heading', { name: /Hey Alice/ })).toBeVisible();
  await page.getByRole('button', { name: 'New group', exact: true }).click();
  await page.getByLabel('Group name').fill('Rejected group');
  let rejected = 0;
  await page.route('**/api/groups', route => {
    if (route.request().method() !== 'POST') return route.continue();
    rejected++;
    return route.fulfill({ status: 401, json: { error: 'Session revoked.' } });
  });
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect.poll(() => rejected).toBe(2);
  await expect.poll(() => page.evaluate(() => window.sseTest.active)).toBe(0);
  await expect(page.getByRole('link', { name: new RegExp(group.name) })).toHaveCount(0);
  await expect(page.getByRole('alert').first()).toBeVisible();
}
async function obsoleteCommandResponse(env) {
  const { page } = await setupRenewal(env);
  await page.goto(env.base);
  await expect(page.getByRole('heading', { name: /Hey Alice/ })).toBeVisible();
  await page.getByRole('button', { name: 'New group', exact: true }).click();
  await page.getByLabel('Group name').fill('Late protected group');
  let release, captured = false, finish;
  const gate = new Promise(resolve => { release = resolve; });
  const finished = new Promise(resolve => { finish = resolve; });
  await page.route('**/api/groups', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    captured = true;
    await gate;
    await route.fulfill({ response });
    finish();
  });
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect.poll(() => captured).toBe(true);
  await page.evaluate(() => { window.smokeTokenControl.missing = true; });
  await expect.poll(() => page.evaluate(() => window.sseTest.active), { timeout: 5000 }).toBe(0);
  release();
  await finished;
  await page.unroute('**/api/groups');
  await expect(page.getByRole('link', { name: /Late protected group/ })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('link', { name: /Late protected group/ })).toHaveCount(0);
}
scenarios.push(
  { name: 'sse-command-authentication-loss', run: commandAuthenticationLoss },
  { name: 'sse-obsolete-command', run: obsoleteCommandResponse },
);

async function authenticationLossAfterCommandRefresh(env) {
  const { page, group, ids } = await setupRenewal(env, 30_000);
  const { bill } = await createBill(env, group, ids, 'Protected before edit');
  await page.goto(`${env.base}#/bills/${bill.id}`);
  await expect(page.getByRole('heading', { name: 'Protected before edit', exact: true })).toBeVisible();
  await page.evaluate(({ groupId, billId }) => {
    const original = window.fetch.bind(window);
    window.refreshAuthTest = { armed: false, rejected: 0, commandStatus: null };
    window.fetch = async (url, options) => {
      const state = window.refreshAuthTest;
      const path = String(url);
      if (state.armed && path === `/api/groups/${groupId}/bills`) {
        state.rejected++;
        return new Response(JSON.stringify({ error: 'Session revoked during refresh.' }), { status: 401 });
      }
      const response = await original(url, options);
      if (path === `/api/bills/${billId}` && options?.method === 'PATCH') {
        state.commandStatus = response.status;
        state.armed = true;
      }
      return response;
    };
  }, { groupId: group.id, billId: bill.id });
  await page.getByRole('button', { name: 'Edit details & participants' }).click();
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Protected after edit');
  await page.getByRole('button', { name: 'Save & request confirmations' }).click();
  await expect.poll(() => page.evaluate(() => window.refreshAuthTest.commandStatus)).toBe(200);
  await expect.poll(() => page.evaluate(() => window.refreshAuthTest.rejected)).toBe(2);
  await expect(page.getByText('Please sign in again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Protected (before|after) edit/ })).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.sseTest.active), 0);
  assert.equal((await env.api(`/bills/${bill.id}`, 'alice-token')).bill.title, 'Protected after edit', 'The successful write remains committed');
}

async function cancelledAuthenticationErrorBody(env) {
  const { page, group } = await setupRenewal(env, 30_000);
  await page.evaluate(groupId => {
    const original = window.fetch.bind(window);
    window.cancelledAuthTest = { rejected: 0, parsing: false, enabled: true };
    window.fetch = async (url, options) => {
      const state = window.cancelledAuthTest;
      if (!state.enabled || String(url) !== `/api/groups/${groupId}/bills`) return original(url, options);
      state.rejected++;
      const response = new Response(JSON.stringify({ error: 'Obsolete authentication failure.' }), { status: 401 });
      if (state.rejected === 2) response.json = () => {
        state.parsing = true;
        return new Promise((resolve, reject) => { state.release = () => reject(new DOMException('Body read aborted', 'AbortError')); });
      };
      return response;
    };
  }, group.id);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => page.evaluate(() => window.cancelledAuthTest.parsing)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.cancelledAuthTest.enabled = false;
    window.cancelledAuthTest.release();
  });
  await expect.poll(() => page.evaluate(() => window.sseTest.active)).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => window.sseTest.active)).toBe(1);
  await expect(groupNet(page)).toContainText("You're settled up");
  await expect(page.getByText('Please sign in again.', { exact: true })).toHaveCount(0);
}
scenarios.push(
  { name: 'sse-post-command-authentication-loss', run: authenticationLossAfterCommandRefresh },
  { name: 'sse-cancelled-authentication-body', run: cancelledAuthenticationErrorBody },
);

async function serverRestartRecovery(env) {
  const { page, group, ids } = await setupRenewal(env, 30_000);
  await createBill(env, group, ids, 'Retained across restart');
  const bills = page.getByRole('region', { name: 'Open bills', exact: true });
  await expect(bills).toContainText('Retained across restart');
  await env.restartApi(async () => {
    // A proxy may retain the downstream response after the API disappears.
    // Existing heartbeat detection bounds that case at 25 seconds.
    await expect(page.getByText('Live updates interrupted', { exact: false }).first()).toBeVisible({ timeout: 28_000 });
    await expect(bills).toContainText('Retained across restart');
  });
  await createBill(env, group, ids, 'Committed after restart');
  await expect(bills).toContainText('Committed after restart');
  await expect(page.getByText('Live updates interrupted', { exact: false })).toHaveCount(0);
  assert.equal((await env.api(`/groups/${group.id}/bills`)).bills.length, 2, 'Resubscription and snapshots do not create financial records');
  assert.equal(await page.evaluate(() => window.sseTest.active), 1);
}
scenarios.push({ name: 'sse-server-restart', run: serverRestartRecovery });

async function deletedSnapshotBeforeEvent(env, billPage = false) {
  const { group, ids } = await costcoFriends(env);
  const bill = billPage ? await aliceBill(env, group.id, 'Retained completed bill', 100, [ids.Alice], [['alice-token', 100]]) : null;
  const page = await env.pageFor('bob-token', { width: 1280, height: 900 });
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.heldDeletionFrames = 0;
    window.fetch = async (url, options) => {
      const response = await original(url, options);
      if (!String(url).includes('/groups/') || !String(url).endsWith('/events') || !response.body) return response;
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let pending = '';
      const fragmented = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) { controller.enqueue(chunk.slice(0, 5)); controller.enqueue(chunk.slice(5)); },
      }));
      return new Response(fragmented.pipeThrough(new TransformStream({
        async transform(chunk, controller) {
          pending += decoder.decode(chunk, { stream: true });
          let end;
          while ((end = pending.indexOf('\n\n')) >= 0) {
            const frame = pending.slice(0, end + 2);
            pending = pending.slice(end + 2);
            if (frame.startsWith('event: group-deleted')) {
              window.heldDeletionFrames++;
              // Force the authoritative REST 404 to arrive before this final frame.
              if (!options.signal.aborted) await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
            }
            controller.enqueue(encoder.encode(frame));
          }
        },
      })), { status: response.status, headers: response.headers });
    };
  });
  await page.goto(env.base);
  await expect(page.getByRole('link', { name: /Costco friends/ })).toBeVisible();
  await page.evaluate(hash => { window.location.hash = hash; }, bill ? `#/bills/${bill.id}` : `#/group-bills/${group.id}`);
  if (bill) await expect(page.getByRole('heading', { name: bill.title, exact: true })).toBeVisible();
  else await expect(groupNet(page)).toContainText("You're settled up");
  let release, captured = false;
  const held = new Promise(resolve => { release = resolve; });
  await page.route(bill ? `**/api/bills/${bill.id}` : `**/api/groups/${group.id}/bills`, async route => {
    captured = true;
    await held;
    const response = await route.fetch();
    assert.equal(response.status(), 404);
    await route.fulfill({ response });
  }, { times: 1 });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => captured).toBe(true);
  await env.api(`/groups/${group.id}`, 'alice-token', 'DELETE');
  await expect.poll(() => page.evaluate(() => window.heldDeletionFrames)).toBe(1);
  release();
  await expect(page.getByRole('heading', { name: /Hey Bob/ })).toBeVisible();
  await expect(page.getByText('Costco friends was deleted by the group creator', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Costco friends/ })).toHaveCount(0);
}
scenarios.push({ name: 'sse-deleted-snapshot-before-event', run: deletedSnapshotBeforeEvent });
scenarios.push({ name: 'sse-deleted-bill-snapshot-before-event', run: env => deletedSnapshotBeforeEvent(env, true) });

async function deniedMemberRefresh(env) {
  const { group } = await costcoFriends(env);
  const page = await env.pageFor('bob-token', { width: 1280, height: 900 });
  await page.route(`**/api/groups/${group.id}/events`, route => route.fulfill({ status: 403 }));
  await page.goto(`${env.base}#/groups/${group.id}`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Group not found.');
  await expect(dialog.getByRole('button', { name: 'Refresh members' })).toBeDisabled();
  await expect(dialog.getByText('Loading members…', { exact: true })).toHaveCount(0);
}
scenarios.push({ name: 'sse-denied-member-refresh', run: deniedMemberRefresh });
