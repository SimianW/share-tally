import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Bill } from '@share-tally/domain/contracts/bills';
import type { GroupLedger, Summary } from '@share-tally/domain/contracts/ledger';
import type { ListedGroup } from '@share-tally/domain/contracts/groups';

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let child: ChildProcess | undefined;
let baseUrl: string;

before(async () => {
  // Never use the developer's DATABASE_URL or .env: migrate an isolated real DB.
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  const running = fork(new URL('./server-process.ts', import.meta.url), {
    execArgv: ['--import=tsx'],
    env: { PATH: process.env.PATH, DATABASE_URL: container.getConnectionUri() },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  child = running;
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server startup timed out')), 30_000);
    running.once('message', message => {
      clearTimeout(timer);
      if (typeof message === 'number') resolve(message);
      else reject(new Error('Invalid server port'));
    });
    running.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Test server exited before startup: ${code}`));
    });
  });
  baseUrl = `http://127.0.0.1:${port}`;
}, { timeout: 120_000 });

after(async () => {
  try {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      const timer = setTimeout(() => child?.kill('SIGKILL'), 5_000);
      child.kill('SIGTERM');
      try { await exited; } finally { clearTimeout(timer); }
    }
  } finally {
    try { await pool?.end(); } finally { await container?.stop(); }
  }
});

// Every UUID and persisted timestamp is fixed, including rows whose DB defaults
// normally generate them. This makes optional before/after byte snapshots useful.
const uuid = (namespace: number, value: number) =>
  `${namespace.toString(16).padStart(8, '0')}-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const users = { alice: uuid(1, 1), bob: uuid(1, 2), carol: uuid(1, 3) };
const groups = { A: uuid(2, 1), B: uuid(2, 2) };
type GroupKey = keyof typeof groups;
const createdAt = '2025-01-01T00:00:00.000Z';
const confirmedAt = '2025-01-02T00:00:00.000Z';
const expiredAt = '2000-01-01T00:00:00.000Z';
const expiresAt = '2099-01-01T00:00:00.000Z';
const billId = (group: GroupKey, index: number) => uuid(group === 'A' ? 3 : 4, index + 1);
const itemId = (group: GroupKey, index: number, item: number) => uuid(group === 'A' ? 5 : 6, index * 3 + item + 1);
const draftId = (group: GroupKey, index: number) => uuid(group === 'A' ? 7 : 8, index + 1);
const manualId = (index: number) => uuid(9, index + 1);
const members = (group: GroupKey) => group === 'A' ? [users.alice, users.bob, users.carol] : [users.alice, users.bob];
const pages = [{ pageNumber: 1, width: 8.5, height: 11, unit: 'inch' }, { pageNumber: 2, width: 850, height: 1100, unit: 'pixel' }];
const region = (group: GroupKey, index: number, item: number) => ({
  pageNumber: group === 'A' ? 1 : 2,
  polygon: [index + item + 0.1, 0.2, index + item + 0.3, 0.2, index + item + 0.3, 0.4, index + item + 0.1, 0.4],
});
const sentinels = ['PRIVATE_CONTENT', 'PRIVATE_PRODUCT_CODE', 'PRIVATE_PRICE_REGION', 'PRIVATE_CONFIDENCE', 'PRIVATE_TAX_DETAILS', 'PRIVATE_RAW_ANALYSIS'];
const receipt = { subtotalCents: 600, taxCents: 0, discountCents: 0, extraCents: 0, pricesIncludeTax: false, totalCents: 605 };

async function fixture(size: number) {
  await pool.query('TRUNCATE TABLE note_photos, item_claims, bill_items, receipt_evidence, receipt_photos, receipt_drafts, repayments, bill_shares, bills, group_members, groups, users');
  // Seed the same identities as server-process, rather than accepting random IDs
  // generated on the first authenticated request. Reads still authenticate over HTTP.
  for (const [name, id] of Object.entries(users)) {
    await pool.query('INSERT INTO users (id, clerk_user_id, display_name, created_at) VALUES ($1,$2,$3,$4)',
      [id, `user_test_${name}`, name[0]!.toUpperCase() + name.slice(1), createdAt]);
  }
  for (const group of ['A', 'B'] as const) {
    await pool.query('INSERT INTO groups (id, name, icon, created_by, created_at) VALUES ($1,$2,$3,$4,$5)',
      [groups[group], `Group ${group}`, 'lucide:shopping-cart', users.alice, createdAt]);
    for (const user of members(group)) {
      await pool.query('INSERT INTO group_members (group_id,user_id,joined_at) VALUES ($1,$2,$3)', [groups[group], user, createdAt]);
    }
    for (let index = 0; index < (group === 'A' ? size : 3); index++) await insertItemBill(group, index);
  }
  for (let index = 0; index < 2; index++) {
    await pool.query(`INSERT INTO bills (id,group_id,initiator_id,request_id,request_payload,title,purchase_date,total_cents,mode,created_at,completed_at,adjustment_cents)
      VALUES ($1,$2,$3,$4,$5,$6,'2025-01-01',300,'manual',$7,$8,$9)`,
      [manualId(index), groups.A, users.alice, uuid(10, index + 1), '{}', `Manual ${index}`, createdAt, index === 0 ? confirmedAt : null, index === 0 ? 0 : null]);
    for (const [user, amount] of [[users.alice, 100], [users.bob, 200], [users.carol, 0]] as const) {
      await pool.query('INSERT INTO bill_shares (bill_id,user_id,amount_cents,confirmed_at) VALUES ($1,$2,$3,$4)',
        [manualId(index), user, amount, index === 0 ? confirmedAt : null]);
    }
  }
  for (const [index, group, sender, recipient, amount, status] of [
    [0, 'A', users.bob, users.alice, 50, 'confirmed'],
    [1, 'A', users.alice, users.bob, 99, 'pending'],
    [2, 'B', users.alice, users.bob, 20, 'confirmed'],
  ] as const) {
    await pool.query(`INSERT INTO repayments (id,group_id,sender_id,recipient_id,request_id,amount_cents,status,created_at,decided_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [uuid(11, index + 1), groups[group], sender, recipient, uuid(12, index + 1), amount, status, createdAt, status === 'confirmed' ? confirmedAt : null]);
  }
}

async function insertItemBill(group: GroupKey, index: number) {
  const complete = index % 3 === 0;
  const canceled = index % 3 === 2;
  await pool.query(`INSERT INTO bills (id,group_id,initiator_id,request_id,request_payload,title,purchase_date,total_cents,mode,created_at,completed_at,adjustment_cents,canceled_at,revision,receipt,frozen_tax_base_cents,frozen_discount_base_cents,frozen_extra_base_cents)
    VALUES ($1,$2,$3,$4,$5,$6,'2025-01-01',605,'items',$7,$8,$9,$10,7,$11,0,600,600)`,
    [billId(group, index), groups[group], group === 'A' ? users.alice : users.bob, uuid(group === 'A' ? 13 : 14, index + 1), '{}', `${group} item bill ${index}`, createdAt, complete ? confirmedAt : null, complete ? 5 : null, canceled ? confirmedAt : null, JSON.stringify(receipt)]);
  // Insertion order differs from position order; equal positions test the id tie-break.
  for (const item of [2, 0, 1]) {
    const cost = [120, 180, 300][item]!;
    await pool.query(`INSERT INTO bill_items (id,bill_id,position,name,original_text,quantity,amount_cents,final_cents,tax_cents,discount_cents,extra_cents,version,taxable,manual_final,allocated_discount_cents)
      VALUES ($1,$2,$3,$4,$5,'1',$6,$6,0,0,0,$7,false,false,0)`,
      [itemId(group, index, item), billId(group, index), [2, 0, 0][item], `${group} item ${index}/${item}`, `PRINTED ${group}/${index}/${item}`, cost, item + 2]);
    if (complete || item === 0) {
      await pool.query('INSERT INTO item_claims (item_id,user_id,numerator,denominator,confirmed_at) VALUES ($1,$2,1,3,$3)',
        [itemId(group, index, item), users.alice, confirmedAt]);
      await pool.query('INSERT INTO item_claims (item_id,user_id,numerator,denominator,confirmed_at) VALUES ($1,$2,$3,$4,$5)',
        [itemId(group, index, item), users.bob, complete ? 2 : 1, complete ? 3 : 6, complete ? confirmedAt : null]);
    }
  }
  for (const user of members(group)) {
    const amount = complete ? (user === users.alice ? 200 : user === users.bob ? 400 : 0) : (user === users.alice ? 40 : null);
    await pool.query('INSERT INTO bill_shares (bill_id,user_id,amount_cents,confirmed_at) VALUES ($1,$2,$3,$4)',
      [billId(group, index), user, amount, complete ? confirmedAt : null]);
  }
  if (index % 3 === 2) return; // No photo source at all.
  const data = {
    mode: 'items', title: `${group} receipt ${index}`, purchaseDate: '2025-01-01', timeZone: 'UTC', notes: '', totalCents: 605,
    participantIds: members(group),
    receipt: { ...receipt, evidence: { pages, taxDetails: [{ description: 'PRIVATE_TAX_DETAILS', amount: 0 }] } },
    items: [0, 1, 2].map(item => ({
      id: itemId(group, index, item), name: `${group} item ${index}/${item}`, originalText: `PRINTED ${group}/${index}/${item}`, quantity: '1',
      amountCents: [120, 180, 300][item], finalCents: [120, 180, 300][item], discountCents: 0,
      evidence: {
        ...(item === 0 ? { regions: [region(group, index, item), region(group, index, 9)], descriptionRegions: [region(group, index, 8)] } : {}),
        ...(item === 1 ? { regions: [], descriptionRegions: [region(group, index, item), region(group, index, 9)] } : {}),
        content: 'PRIVATE_CONTENT', productCode: 'PRIVATE_PRODUCT_CODE',
        priceRegions: [{ pageNumber: 1, polygon: [999, 999], marker: 'PRIVATE_PRICE_REGION' }],
        descriptionConfidence: 0.123456789, priceConfidence: 0.234567891, confidences: 'PRIVATE_CONFIDENCE',
      },
    })),
  };
  await pool.query(`INSERT INTO receipt_drafts (id,group_id,initiator_id,data,bill_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
    [draftId(group, index), groups[group], group === 'A' ? users.alice : users.bob, JSON.stringify(data), billId(group, index), createdAt]);
  await pool.query('INSERT INTO receipt_photos (draft_id,base64,expires_at,uploaded_at) VALUES ($1,$2,$3,$4)',
    [draftId(group, index), 'dGVzdC1vbmx5LXBob3Rv', index % 3 === 1 ? expiredAt : expiresAt, createdAt]);
  await pool.query('INSERT INTO receipt_evidence (draft_id,analysis,scanned_at) VALUES ($1,$2,$3)',
    [draftId(group, index), JSON.stringify({ content: 'PRIVATE_RAW_ANALYSIS' }), createdAt]);
}

async function get(path: string, token = 'alice-token', counted = true) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...(counted ? { 'x-count-queries': '1' } : {}) },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  for (const sentinel of [...sentinels, '0.123456789', '0.234567891']) assert.ok(!text.includes(sentinel), `Leaked ${sentinel} from ${path}`);
  const header = response.headers.get('x-query-count');
  if (counted) assert.match(header ?? '', /^\d+$/, 'request query counter must be present');
  else assert.equal(header, null, 'uncounted requests keep their normal headers');
  return { text, queries: header === null ? null : Number(header) };
}

type GroupBills = { bills: Bill[]; ledger: GroupLedger; summary: Summary; repayments: { id: string; status: string }[] };
function assertItemBill(bill: Bill, group: GroupKey, index: number) {
  assert.equal(bill.id, billId(group, index));
  assert.equal(bill.groupId, groups[group]);
  assert.equal(bill.mode, 'items');
  assert.equal(bill.revision, 7);
  assert.equal(bill.completedAt, index % 3 === 0 ? confirmedAt : null);
  assert.equal(bill.canceledAt, index % 3 === 2 ? confirmedAt : null);
  assert.equal(bill.adjustmentCents, index % 3 === 0 ? 5 : null);
  assert.deepEqual(bill.items?.map(item => item.id), [1, 2, 0].map(item => itemId(group, index, item)));
  for (const item of [0, 1, 2]) {
    const actual: NonNullable<Bill['items']>[number] = bill.items!.find(row => row.id === itemId(group, index, item))!;
    assert.equal(actual.version, item + 2);
    assert.equal(actual.name, `${group} item ${index}/${item}`);
    assert.equal(actual.amountCents, [120, 180, 300][item]);
    assert.equal(actual.finalCents, [120, 180, 300][item]);
    assert.equal(actual.allocatedTaxCents, 0);
    assert.equal(actual.allocatedDiscountCents, 0);
    assert.equal(actual.allocatedExtraCents, 0);
    const expectedClaims = index % 3 === 0 || item === 0 ? [
      { itemId: actual.id, userId: users.alice, numerator: 1, denominator: 3, confirmedAt },
      { itemId: actual.id, userId: users.bob, numerator: index % 3 === 0 ? 2 : 1, denominator: index % 3 === 0 ? 3 : 6, confirmedAt: index % 3 === 0 ? confirmedAt : null },
    ] : [];
    // Claim order has no contractual sort; check content without inventing one.
    assert.deepEqual([...actual.claims].sort((a, b) => a.userId.localeCompare(b.userId)), expectedClaims);
    assert.deepEqual(actual.receiptRegion, index % 3 === 0 && item !== 2 ? region(group, index, item) : null);
  }
  assert.deepEqual(bill.photo, index % 3 === 2 ? null : {
    draftId: draftId(group, index), expiresAt: index % 3 === 0 ? expiresAt : expiredAt,
    expired: index % 3 === 1, ...(index % 3 === 0 ? { pages } : {}),
  });
  assert.deepEqual(bill.participants.map(p => ({ userId: p.userId, amountCents: p.amountCents, confirmedAt: p.confirmedAt, isCurrentUser: p.isCurrentUser })),
    members(group).map(userId => ({ userId, amountCents: index % 3 === 0 ? (userId === users.alice ? 200 : userId === users.bob ? 400 : 0) : (userId === users.alice ? 40 : null), confirmedAt: index % 3 === 0 ? confirmedAt : null, isCurrentUser: userId === users.alice })));
  assert.equal(bill.submittedCents, index % 3 === 0 ? 600 : 40);
  assert.equal(bill.differenceCents, index % 3 === 0 ? 5 : 565);
  assert.equal(bill.confirmedCount, index % 3 === 0 ? members(group).length : 0);
}

const sizes = [1, 10, 100] as const;
const endpoints = {
  bills: `/groups/${groups.A}/bills`, summary: '/summary', groups: '/groups', deletion: `/groups/${groups.A}/deletion`,
  single: `/bills/${billId('A', 0)}`,
};
type Endpoint = keyof typeof endpoints;
type Measurement = { size: number; endpoint: Endpoint; queries: number; medianMs: number };
const measurements: Measurement[] = [];

for (const size of sizes) {
  test(`${size} item bills preserve HTTP details, isolation and accounting; measure read costs`, async t => {
    await fixture(size);
    assert.ok((await get('/groups')).queries! > 0, 'counter observes actual pg queries');
    await get('/groups', 'alice-token', false);
    const groupA = JSON.parse((await get(endpoints.bills)).text) as GroupBills;
    const groupB = JSON.parse((await get(`/groups/${groups.B}/bills`)).text) as GroupBills;
    assert.deepEqual(groupA.bills.map(bill => bill.id), [...Array.from({ length: size }, (_, i) => billId('A', i)), manualId(0), manualId(1)]);
    assert.deepEqual(groupB.bills.map(bill => bill.id), [billId('B', 0), billId('B', 1), billId('B', 2)]);
    for (const [group, result] of [['A', groupA], ['B', groupB]] as const) {
      const other: GroupKey = group === 'A' ? 'B' : 'A';
      const text = JSON.stringify(result);
      // Bill, item, claim itemId, photo draftId, regions and ledger/repayment IDs
      // are all independently group-specific, not just the top-level bill filter.
      assert.ok(!text.includes(groups[other]));
      assert.ok(!text.includes(`${other} item`));
      for (let index = 0; index < (other === 'A' ? size : 3); index++) {
        assert.ok(!text.includes(billId(other, index)));
        assert.ok(!text.includes(draftId(other, index)));
        for (const item of [0, 1, 2]) assert.ok(!text.includes(itemId(other, index, item)));
      }
      const count = group === 'A' ? size : 3;
      for (let index = 0; index < count; index++) {
        assertItemBill(result.bills.find(bill => bill.id === billId(group, index))!, group, index);
      }
      // Exercise single reads independently for live, expired and missing photos.
      for (let index = 0; index < Math.min(count, 3); index++) {
        const single = JSON.parse((await get(`/bills/${billId(group, index)}`)).text) as { bill: Bill };
        assertItemBill(single.bill, group, index);
        assert.deepEqual(single.bill, result.bills.find(bill => bill.id === single.bill.id));
      }
    }
    for (const index of [0, 1]) {
      const manual = groupA.bills.find(bill => bill.id === manualId(index))!;
      assert.equal(manual.mode, 'manual');
      assert.equal(manual.totalCents, 300);
      assert.equal(manual.items, undefined);
      assert.equal(manual.photo, undefined);
      assert.deepEqual(manual.participants.map(p => p.amountCents), [100, 200, 0]);
      assert.equal(manual.completedAt, index === 0 ? confirmedAt : null);
      assert.equal(manual.adjustmentCents, index === 0 ? 0 : null);
      const single = JSON.parse((await get(`/bills/${manual.id}`)).text) as { bill: Bill };
      assert.deepEqual(single.bill, manual);
    }
    const netA = { 1: 550, 10: 1750, 100: 13750 }[size];
    assert.deepEqual(JSON.parse((await get(endpoints.deletion)).text), {
      eligible: false,
      reasons: [
        { code: 'incomplete_bills', count: { 1: 1, 10: 4, 100: 34 }[size] },
        { code: 'pending_repayments', count: 1 },
        { code: 'nonzero_balances', members: [
          { userId: users.alice, displayName: 'Alice', netCents: netA },
          { userId: users.bob, displayName: 'Bob', netCents: -netA },
        ] },
      ],
    });
    assert.deepEqual(groupA.summary, { receivableCents: netA, payableCents: 0, netCents: netA });
    assert.deepEqual(groupB.summary, { receivableCents: 0, payableCents: 180, netCents: -180 });
    assert.deepEqual(JSON.parse((await get('/summary')).text).summary, { receivableCents: netA, payableCents: 180, netCents: netA - 180 });
    const listed = JSON.parse((await get('/groups')).text).groups as ListedGroup[];
    assert.deepEqual(listed.map(group => [group.id, group.netCents]), [[groups.A, netA], [groups.B, -180]]);
    assert.deepEqual(groupA.ledger.members.map(member => [member.userId, member.netCents]), [[users.alice, netA], [users.bob, -netA], [users.carol, 0]]);
    assert.deepEqual(groupB.ledger.members.map(member => [member.userId, member.netCents]), [[users.alice, -180], [users.bob, 180]]);
    assert.equal(groupA.ledger.entries.filter(entry => entry.kind === 'repayment').length, 1);
    assert.ok(!groupA.ledger.entries.some(entry => entry.id === uuid(11, 2)), 'pending repayment has no effect');
    assert.ok(!JSON.stringify(groupA).includes(uuid(11, 3)));
    assert.ok(!JSON.stringify(groupB).includes(uuid(11, 1)));
    assert.ok(!JSON.stringify(groupB).includes(uuid(11, 2)));
    const denied = await fetch(`${baseUrl}/api/bills/${billId('B', 0)}`, { headers: { Authorization: 'Bearer carol-token' } });
    assert.equal(denied.status, 404, await denied.text());

    for (const [endpoint, path] of Object.entries(endpoints) as [Endpoint, string][]) {
      const warm = await get(path);
      // Optional evidence capture only; never used as the semantic test oracle.
      if (process.env.BILL_READS_SNAPSHOT_DIR) {
        await mkdir(process.env.BILL_READS_SNAPSHOT_DIR, { recursive: true });
        await writeFile(join(process.env.BILL_READS_SNAPSHOT_DIR, `${size}-${endpoint}.json`), warm.text);
      }
      const times: number[] = [];
      for (let run = 0; run < 7; run++) {
        const start = performance.now();
        const response = await get(path);
        times.push(performance.now() - start);
        assert.equal(response.queries, warm.queries, 'request count is repeatable and excludes background sweeps');
      }
      const medianMs = times.sort((a, b) => a - b)[3]!;
      measurements.push({ size, endpoint, queries: warm.queries!, medianMs });
      t.diagnostic(`${size} ${endpoint}: ${warm.queries} queries; median ${medianMs.toFixed(2)} ms (7 requests)`);
    }
  });
}

test('read query counts stay fixed across 1, 10 and 100 item bills', async t => {
  console.log('Bill read measurements (endpoint | items | queries | median ms)');
  for (const row of measurements) console.log(`${row.endpoint.padEnd(8)} | ${String(row.size).padStart(3)} | ${String(row.queries).padStart(3)} | ${row.medianMs.toFixed(2)}`);
  assert.equal(measurements.length, sizes.length * Object.keys(endpoints).length, 'all fixtures completed');
  // Separate subtests let the red phase report every endpoint, not just the first.
  for (const endpoint of Object.keys(endpoints) as Endpoint[]) {
    await t.test(`${endpoint} has a fixed request query count`, () => {
      const counts = measurements.filter(row => row.endpoint === endpoint).map(row => row.queries);
      assert.deepEqual(counts, [counts[0], counts[0], counts[0]], `${endpoint}: query count must not grow with item bills`);
      assert.ok(counts[0]! > 0 && counts[0]! <= 15, `${endpoint}: bounded nonzero count`);
    });
  }
});
