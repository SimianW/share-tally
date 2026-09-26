// Throwaway palette screenshots against the real API, temporary PostgreSQL and
// Vite's test-only Clerk boundary. Run: pnpm prototype:palettes [--palettes=classic,plum-butter] [--layouts]
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const palettes = ['classic', 'marigold', 'raspberry', 'plum-butter', 'lagoon', 'blueberry'];
const pages = ['specimen', 'home', 'group', 'bill-open', 'bill-complete', 'dialog', 'members'];
const layouts = ['current', 'column', 'sidebar', 'hero', 'board', 'table'];
const layoutsMode = process.argv.includes('--layouts');
const requested = process.argv.find(arg => arg.startsWith('--palettes='));
const selected = requested ? requested.slice('--palettes='.length).split(',') : palettes;
if (layoutsMode && requested) throw new Error('Use --layouts without --palettes; layouts always use classic.');
if (!selected.length || selected.some(name => !palettes.includes(name)) || new Set(selected).size !== selected.length) {
  throw new Error(`Choose distinct palette names from: ${palettes.join(', ')}`);
}
const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const { PostgreSqlContainer } = serverRequire('@testcontainers/postgresql');
const { Pool } = serverRequire('pg');
const { drizzle } = serverRequire('drizzle-orm/node-postgres');
const { migrate } = serverRequire('drizzle-orm/node-postgres/migrator');
const clientRoot = fileURLToPath(new URL('../', import.meta.url));
const serverRoot = fileURLToPath(new URL('../../server/', import.meta.url));
const output = '/tmp/st-palettes';
const started = Date.now();
let container, pool, child, vite, browser;

function serverPort(process) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API startup timed out')), 30_000);
    const cleanup = () => { clearTimeout(timer); process.off('error', error); process.off('exit', exit); };
    const error = cause => { cleanup(); reject(cause); };
    const exit = code => error(new Error(`API exited before startup: ${code}`));
    process.once('message', port => { cleanup(); resolve(port); });
    process.once('error', error);
    process.once('exit', exit);
  });
}
async function run(command, args) {
  const process = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  const [code] = await once(process, 'exit');
  if (code !== 0) throw new Error(`${command} exited with status ${code}`);
}
async function montage(inputs, destination, width) {
  // Resize each screenshot before montage: full-page desktop group views can be
  // much taller than the viewport and should not create enormous contact sheets.
  await run('montage', inputs.flatMap(([path, label]) => ['-label', label, path]).concat([
    '-auto-orient', '-thumbnail', `${width}x1200>`, '-background', '#f6f5f2',
    '-fill', '#242424', '-font', 'DejaVu-Sans', '-pointsize', '18',
    '-gravity', 'north', '-geometry', `${width}x+10+10`, '-tile', `${inputs.length}x1`, destination,
  ]));
}
async function captureLayouts(base, groupId) {
  const output = '/tmp/st-layouts';
  const findings = [];
  const viewports = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };
  async function screenshot(page, layout, name, device) {
    await expect(page.getByRole('heading', { name: /Costco Crew/ }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Coffee beans & pastries', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      document.activeElement?.blur();
    });
    const diagnostics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      overlay: Boolean(document.querySelector('vite-error-overlay')),
    }));
    if (diagnostics.overlay) findings.push(`${layout}/${name}-${device}: Vite error overlay`);
    if (device === 'mobile' && diagnostics.scrollWidth > diagnostics.viewportWidth)
      findings.push(`${layout}/${name}-${device}: horizontal overflow ${diagnostics.scrollWidth}px > ${diagnostics.viewportWidth}px`);
    const path = `${output}/${layout}/${name}-${device}.png`;
    await page.screenshot({ path, fullPage: true, animations: 'disabled' });
    console.log(path);
  }
  for (const layout of layouts) {
    await mkdir(`${output}/${layout}`, { recursive: true });
    for (const [device, viewport] of Object.entries(viewports)) {
      for (const [name, identity] of [['group-alice', 'alice-token'], ['group-carol', 'carol-token']]) {
        const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
        // Same Clerk stub as the palette captures, but each member has an
        // isolated context. Select the layout before the app's entrypoint runs.
        await context.addInitScript(({ layout, identity }) => {
          localStorage.setItem('prototype-palette', 'classic');
          localStorage.setItem('prototype-layout', layout);
          localStorage.setItem('prototype-hide-switcher', '1');
          localStorage.setItem('smoke-token', identity);
        }, { layout, identity });
        const page = await context.newPage();
        page.setDefaultTimeout(15_000);
        page.on('pageerror', error => {
          const finding = `${layout}/${name}-${device}: ${error.message}`;
          findings.push(finding);
          console.error(`Browser error: ${finding}`);
        });
        try {
          await page.goto(`${base}?shot=${name}-${device}#/group-bills/${groupId}`);
          await screenshot(page, layout, name, device);
          if (name === 'group-alice') {
            const showAll = page.getByRole('button', { name: /Show all/i }).first();
            if (await showAll.isVisible()) {
              await showAll.click();
              await screenshot(page, layout, 'group-alice-history', device);
            }
          }
        } finally {
          await context.close();
        }
      }
    }
  }
  for (const [name, device, comparison] of [
    ['group-alice', 'desktop', 'compare-alice-desktop'],
    ['group-carol', 'desktop', 'compare-carol-desktop'],
    ['group-alice', 'mobile', 'compare-alice-mobile'],
  ]) {
    await montage(layouts.map(layout => [`${output}/${layout}/${name}-${device}.png`, layout]),
      `${output}/${comparison}.png`, device === 'desktop' ? 480 : 300);
  }
  console.log(`Completed ${layouts.length} layouts in ${((Date.now() - started) / 1000).toFixed(1)}s; output: ${output}`);
  if (findings.length) console.warn(`Layout diagnostics (${findings.length}):\n${findings.join('\n')}`);
  else console.log('No page errors, Vite overlays or mobile horizontal overflow detected.');
}
async function main() {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(drizzle(pool), { migrationsFolder: `${serverRoot}/drizzle` });
  child = fork(`${serverRoot}/test/server-process.ts`, {
    cwd: serverRoot, execArgv: ['--import=tsx'],
    env: { PATH: process.env.PATH, DATABASE_URL: container.getConnectionUri() },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const port = await serverPort(child);
  vite = await createServer({
    root: clientRoot, configFile: false, envDir: false,
    cacheDir: `${clientRoot}/node_modules/.vite-smoke`,
    define: { 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify('test-only-clerk-boundary') },
    plugins: [{ name: 'smoke-clerk', enforce: 'pre', resolveId(id) {
      if (id === '@clerk/react') return `${clientRoot}/test/clerk.tsx`;
    } }, react()],
    optimizeDeps: { exclude: ['@clerk/react'] },
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': `http://127.0.0.1:${port}` } },
  });
  await vite.listen();
  const base = vite.resolvedUrls.local[0];
  async function api(path, token = 'alice-token', method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
    return response.json();
  }
  async function group(name, members) {
    const { group } = await api('/groups', 'alice-token', 'POST', {
      name, icon: { type: 'unicode', value: name === 'Apartment' ? '🏠' : '🛒' },
    });
    const invitation = await api(`/groups/${group.id}/invitation`);
    for (const token of members) await api('/groups/join', token, 'POST', { token: invitation.path.split('/').at(-1) });
    return (await api(`/groups/${group.id}`)).group;
  }
  const costco = await group('Costco Crew', ['bob-token', 'carol-token', 'member-1-token']);
  // The test server names extra identities "Member" and exposes no profile-name
  // write endpoint. Rename this test identity only; all membership and financial
  // fixture changes still go through the real API.
  const dan = costco.members.find(member => member.displayName === 'Member');
  assert.ok(dan, 'Missing fourth test identity');
  await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', ['Dan', dan.id]);
  const ids = Object.fromEntries(costco.members.map(member => [member.displayName, member.id]));
  ids.Dan = dan.id;
  await group('Apartment', ['bob-token']);
  const date = '2026-09-24';
  async function bill(initiator, title, totalCents, ownShareCents, names, notes) {
    return (await api(`/groups/${costco.id}/bills`, `${initiator.toLowerCase()}-token`, 'POST', {
      requestId: randomUUID(), title, purchaseDate: date, timeZone: 'America/Toronto',
      notes, totalCents, ownShareCents, participantIds: names.map(name => ids[name]),
    })).bill;
  }
  async function share(bill, person, amountCents) {
    return (await api(`/bills/${bill.id}/share`, person === 'Dan' ? 'member-1-token' : `${person.toLowerCase()}-token`, 'POST', {
      revision: bill.revision, expectedAmountCents: null, amountCents,
    })).bill;
  }
  // Alice owes Bob $40 on this bill; other completed bills make her net positive.
  let complete = await bill('Bob', 'Saturday warehouse run', 10000, 6000, ['Alice', 'Bob'], 'Pantry staples and paper towels');
  complete = await share(complete, 'Alice', 4000);
  assert.ok(complete.completedAt);
  let produce = await bill('Alice', 'Produce & freezer aisle', 18000, 4000, ['Alice', 'Carol', 'Dan'], 'Fresh berries, frozen dumplings, olive oil');
  produce = await share(produce, 'Carol', 8000);
  produce = await share(produce, 'Dan', 6000);
  assert.ok(produce.completedAt);
  const missing = await bill('Bob', 'Coffee beans & pastries', 5400, 2100, ['Alice', 'Bob', 'Carol'], 'Split the snacks after our Sunday visit');
  // Alice has a saved amount but has not confirmed the latest bill revision.
  let unconfirmed = await bill('Alice', 'Household supplies', 7600, 2600, ['Alice', 'Bob', 'Dan'], 'Dish soap, batteries and foil');
  unconfirmed = (await api(`/bills/${unconfirmed.id}`, 'alice-token', 'PATCH', {
    revision: unconfirmed.revision, title: unconfirmed.title, purchaseDate: date,
    timeZone: 'America/Toronto', notes: 'Dish soap, batteries and foil · receipt corrected',
    totalCents: 7600, participantIds: [ids.Alice, ids.Bob, ids.Dan],
  })).bill;
  const waiting = await bill('Alice', 'Bakery & breakfast', 9200, 3000, ['Alice', 'Bob', 'Carol'], 'Croissants, oats and coffee');
  const canceled = await bill('Alice', 'Duplicate register slip', 2300, 800, ['Alice', 'Bob'], 'Accidentally entered twice');
  await api(`/bills/${canceled.id}/cancel`, 'alice-token', 'POST', { revision: canceled.revision });
  if (layoutsMode) {
    // Four older, mutually offsetting completed purchases reveal the layouts'
    // "Show all" history state without changing anyone's net balance.
    for (const [index, titles] of [
      ['Pantry restock', 'Shared cleaning kit'],
      ['Holiday snacks', 'Bulk toiletries'],
    ].entries()) {
      let paidByAlice = await bill('Alice', titles[0], 3000 + index * 200, 1000 + index * 100,
        ['Alice', 'Bob'], 'Joint household shopping');
      paidByAlice = await share(paidByAlice, 'Bob', 2000 + index * 100);
      assert.ok(paidByAlice.completedAt);
      let paidByBob = await bill('Bob', titles[1], 3000 + index * 200, 1000 + index * 100,
        ['Alice', 'Bob'], 'Joint household shopping');
      paidByBob = await share(paidByBob, 'Alice', 2000 + index * 100);
      assert.ok(paidByBob.completedAt);
    }
  }
  // An own ready draft is an inexpensive real-API fixture; no image processing needed.
  const draftId = randomUUID();
  await api(`/groups/${costco.id}/receipt-drafts/${draftId}`, 'alice-token', 'PUT', {
    revision: 0,
    data: {
      mode: 'items', title: 'Costco receipt to review', purchaseDate: date,
      timeZone: 'America/Toronto', notes: 'A few items still need claiming',
      totalCents: 2400, ownShareCents: 0, participantIds: [ids.Alice, ids.Bob],
      receipt: { subtotalCents: 2400, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
      items: [{ id: randomUUID(), name: 'Organic apples', originalText: 'ORGANIC APPLES',
        quantity: '1', amountCents: 2400, discountCents: 0, taxable: false, finalCents: 2400, manualFinal: false }],
    },
  });
  const { repayment } = await api(`/groups/${costco.id}/repayments`, 'bob-token', 'POST', {
    requestId: randomUUID(), recipientId: ids.Alice, amountCents: 1250,
  });
  assert.equal(repayment.status, 'pending');
  if (layoutsMode) {
    const { repayment: outgoing } = await api(`/groups/${costco.id}/repayments`, 'carol-token', 'POST', {
      requestId: randomUUID(), recipientId: ids.Alice, amountCents: 850,
    });
    assert.equal(outgoing.status, 'pending');
    console.log('Layout fixture: Carol recorded a pending $8.50 transfer to Alice.');
  }
  const state = await api(`/groups/${costco.id}/bills`);
  assert.equal(state.bills.filter(item => item.completedAt).length, layoutsMode ? 6 : 2);
  assert.equal(state.bills.filter(item => item.canceledAt).length, 1);
  assert.equal(state.ledger.incompleteBillIds.length, 3);
  assert.ok(state.ledger.suggestions.some(item => item.fromUserId === ids.Dan && item.toUserId === ids.Alice));
  assert.ok(state.repayments.some(item => item.id === repayment.id && item.status === 'pending'));
  assert.equal((await api(`/groups/${costco.id}/receipt-drafts`)).drafts[0].processingStatus, 'ready');
  if (layoutsMode) {
    const carolView = await api(`/groups/${costco.id}/bills`, 'carol-token');
    assert.ok(carolView.summary.netCents < 0, 'Carol must owe money');
    assert.ok(carolView.ledger.suggestions.some(item => item.fromUserId === ids.Carol), 'Carol needs a pay suggestion');
    assert.ok(carolView.repayments.some(item => item.senderId === ids.Carol && item.status === 'pending'), 'Carol needs a pending sent transfer');
  }
  console.log(`Seeded Costco Crew: 4 members, 3 open, ${layoutsMode ? 6 : 2} complete, 1 canceled, 1 ready draft, ${layoutsMode ? 2 : 1} incoming repayment(s); Apartment: 2 settled members.`);

  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  });
  if (layoutsMode) {
    await captureLayouts(base, costco.id);
    return;
  }
  const routes = {
    specimen: '#/prototype/palette', home: '#', group: `#/group-bills/${costco.id}`,
    'bill-open': `#/bills/${missing.id}`, 'bill-complete': `#/bills/${complete.id}`,
    dialog: `#/group-bills/${costco.id}`, members: `#/group-bills/${costco.id}`,
  };
  for (const palette of selected) {
    await mkdir(`${output}/${palette}`, { recursive: true });
    for (const [device, viewport] of Object.entries({ desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      await context.addInitScript(name => {
        localStorage.setItem('prototype-palette', name);
        localStorage.setItem('prototype-hide-switcher', '1');
        localStorage.setItem('smoke-token', 'alice-token');
      }, palette);
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      page.on('pageerror', error => console.error(`Browser error (${palette}/${device}): ${error.message}`));
      try {
        for (const name of pages) {
          // The specimen is selected at entrypoint boot, not through the app
          // router. A distinct URL forces a document load between captures.
          await page.goto(`${base}?shot=${name}${routes[name]}`);
          if (name === 'specimen') {
            await expect(page.getByRole('heading', { name: 'Type & roles' })).toBeVisible();
          } else if (name === 'home') {
            await expect(page.getByRole('heading', { name: 'Your groups' })).toBeVisible();
            await expect(page.getByText('Costco Crew', { exact: true }).first()).toBeVisible();
            await expect(page.getByText('Apartment', { exact: true }).first()).toBeVisible();
            await expect(page.getByRole('region', { name: 'Needs your attention' })).toContainText('Enter your share');
            await expect(page.getByRole('region', { name: 'Needs your attention' })).toContainText('Confirm your share');
            await expect(page.getByRole('region', { name: 'Needs your attention' })).toContainText('Review incoming transfer');
            await expect(page.getByRole('region', { name: 'Needs your attention' })).toContainText('Review draft');
          } else if (name === 'bill-open' || name === 'bill-complete') {
            await expect(page.getByRole('heading', { name: name === 'bill-open' ? missing.title : complete.title })).toBeVisible();
            if (name === 'bill-open') await expect(page.getByText('Not submitted').first()).toBeVisible();
            else await expect(page.getByText('Completed bills are final.', { exact: false })).toBeVisible();
          } else {
            await expect(page.getByText('Costco receipt to review', { exact: true })).toBeVisible();
            await expect(page.getByText('Coffee beans & pastries', { exact: true })).toBeVisible();
            await expect(page.getByText('Household supplies', { exact: true })).toBeVisible();
            await expect(page.getByText('Bob → Alice', { exact: false }).first()).toBeVisible();
          }
          if (name === 'dialog') {
            await page.getByRole('button', { name: 'Record repayment', exact: true }).click();
            await expect(page.getByRole('dialog', { name: 'Record repayment' })).toBeVisible();
          }
          if (name === 'members') {
            await page.getByRole('button', { name: 'Members & invites', exact: true }).click();
            await expect(page.getByRole('dialog')).toContainText('Dan');
          }
          await page.evaluate(async name => {
            document.documentElement.dataset.palette = name;
            await document.fonts.ready;
            document.activeElement?.blur();
          }, palette);
          const path = `${output}/${palette}/${name}-${device}.png`;
          await page.screenshot({ path, fullPage: true, animations: 'disabled' });
          console.log(path);
        }
      } finally {
        await context.close();
      }
    }
    for (const device of ['desktop', 'mobile']) {
      await montage(pages.map(name => [`${output}/${palette}/${name}-${device}.png`, name]),
        `${output}/${palette}-sheet-${device}.png`, device === 'desktop' ? 480 : 300);
    }
  }
  for (const name of ['home', 'group']) {
    await montage(selected.map(palette => [`${output}/${palette}/${name}-desktop.png`, palette]),
      `${output}/compare-${name}.png`, 480);
  }
  console.log(`Completed ${selected.length} palette(s) in ${((Date.now() - started) / 1000).toFixed(1)}s; output: ${output}`);
}

let stopping;
function cleanup() {
  return stopping ??= (async () => {
    try { await browser?.close(); } finally {
      try { await vite?.close(); } finally {
        try {
          if (child && child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
            child.kill('SIGTERM');
            try { await exited; } finally { clearTimeout(timer); }
          }
        } finally {
          try { await pool?.end(); } finally { await container?.stop(); }
        }
      }
    }
  })();
}
for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    cleanup().then(() => { process.exitCode = exitCode; }, error => {
      console.error(`Cleanup after ${signal} failed:`, error);
      process.exitCode = exitCode;
    });
  });
}
try {
  await main();
} finally {
  await cleanup();
}
