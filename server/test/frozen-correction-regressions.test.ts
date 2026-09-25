import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let child: ChildProcess | undefined;
let baseUrl: string;

async function startServer() {
  assert.ok(container);
  // Never read .env or use the developer's DATABASE_URL in this suite.
  const processUnderTest = fork(
    new URL("./server-process.ts", import.meta.url),
    {
      execArgv: ["--import=tsx"],
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: container.getConnectionUri(),
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    },
  );
  child = processUnderTest;
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Test server startup timed out")),
      10_000,
    );
    processUnderTest.once("message", (message) => {
      clearTimeout(timer);
      if (typeof message !== "number") reject(new Error("Invalid server port"));
      else resolve(message);
    });
    processUnderTest.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Test server exited before startup: ${code}`));
    });
    processUnderTest.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopServer() {
  const running = child;
  child = undefined;
  if (!running || running.exitCode !== null || running.signalCode !== null)
    return;
  const exited = once(running, "exit");
  const timer = setTimeout(() => running.kill("SIGKILL"), 5_000);
  running.kill("SIGTERM");
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

before(
  async () => {
    container = await new PostgreSqlContainer("postgres:17.6-alpine").start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    // Apply the committed migration history, rather than creating a test-only schema.
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    await startServer();
  },
  { timeout: 120_000 },
);

after(async () => {
  try {
    await stopServer();
  } finally {
    try {
      await pool?.end();
    } finally {
      await container?.stop();
    }
  }
});

beforeEach(async () => {
  // Clear only this suite's isolated database, including dependent bill tables.
  await pool.query(
    "TRUNCATE TABLE item_claims, bill_items, receipt_photos, receipt_drafts, repayments, bill_shares, bills, group_members, groups, users CASCADE",
  );
});

// Import by URL so the server's NodeNext typecheck does not pull in the
// browser's bundler-only React dependency graph. Exercise the real preview.
const { previewCorrection } = await import(new URL("../../client/src/play/receipt-correction.ts", import.meta.url).href);

async function api(path: string, token = "alice-token", method = "GET", body?: unknown) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
}
async function json(response: Response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}
async function summarizedBill(receiptParts = {}, amounts = [100, 100], taxable: boolean | boolean[] = true, manualFinal = false) {
  const group = (await json(await api("/groups", "alice-token", "POST", {
    name: "Correction regressions", icon: { type: "unicode", value: "A" },
  }), 201)).group;
  const invite = await json(await api(`/groups/${group.id}/invitation`));
  await json(await api("/groups/join", "bob-token", "POST", { token: invite.path.split("/").at(-1) }));
  const members = (await json(await api(`/groups/${group.id}`))).group.members;
  const id = crypto.randomUUID();
  const data = {
    title: "Frozen receipt", purchaseDate: "2026-01-01", timeZone: "America/Toronto", notes: "",
    totalCents: 10000, participantIds: members.map((m: { id: string }) => m.id), mode: "items",
    receipt: { subtotalCents: amounts.reduce((a, b) => a + b, 0), discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false, ...receiptParts },
    items: amounts.map((amountCents, i) => ({ id: crypto.randomUUID(), name: `Item ${i}`, originalText: "", quantity: "1", amountCents, discountCents: 0, taxable: Array.isArray(taxable) ? taxable[i] : taxable, manualFinal, finalCents: 0 })),
  };
  const draft = (await json(await api(`/groups/${group.id}/receipt-drafts/${id}`, "alice-token", "PUT", { revision: 0, data }))).draft;
  return (await json(await api(`/receipt-drafts/${id}/initialize`, "alice-token", "POST", { revision: draft.revision }))).bill;
}

test("changed weights drop tie-breaking offsets and restoring frozen weights restores the original cents, with preview parity", async () => {
  let bill = await summarizedBill({ taxCents: 1, extraCents: 1 });
  const initial = structuredClone(bill.items);
  assert.deepEqual(initial.map((i: { finalCents: number }) => i.finalCents), [102, 100]);
  for (const amountCents of [100, 99, 50, 1, 0, 100]) {
    const item = bill.items[1];
    const input = { name: item.name, quantity: item.quantity, amountCents, discountCents: 0, taxable: true, manualFinal: false };
    const preview = previewCorrection(bill, item, { ...item, ...input });
    bill = (await json(await api(`/bills/${bill.id}/items/${item.id}`, "alice-token", "PATCH", { revision: bill.revision, ...input }))).bill;
    const corrected = bill.items[1];
    assert.deepEqual([corrected.allocatedTaxCents, corrected.allocatedExtraCents, corrected.finalCents], [0, 0, amountCents]);
    assert.deepEqual([preview.allocatedTaxCents, preview.allocatedExtraCents, preview.finalCents], [0, 0, amountCents]);
    assert.deepEqual(bill.items[0], initial[0], "sibling remains byte-identical");
  }
});


test("manual final preserves an independently available adjustment when newly taxable cost has no frozen tax base", async () => {
  const bill = await summarizedBill({ taxCents: 100, extraCents: 100 }, [1000], false);
  const item = bill.items[0];
  assert.deepEqual([item.allocatedTaxCents, item.allocatedExtraCents], [0, 100]);
  const input = { name: item.name, quantity: "1", amountCents: 2000, discountCents: 0, taxable: true, manualFinal: true, finalCents: 2300 };
  const preview = previewCorrection(bill, item, { ...item, ...input });
  const updated = (await json(await api(`/bills/${bill.id}/items/${item.id}`, "alice-token", "PATCH", { revision: bill.revision, ...input }))).bill;
  const saved = updated.items[0];
  assert.deepEqual([saved.allocatedDiscountCents, saved.allocatedTaxCents, saved.allocatedExtraCents, saved.finalCents], [0, null, 200, 2300]);
  assert.deepEqual([preview.allocatedDiscountCents, preview.allocatedTaxCents, preview.allocatedExtraCents, preview.finalCents], [0, null, 200, 2300]);
  assert.deepEqual([saved.taxCents, saved.extraCents, saved.manualFinal], [null, 200, true]);
  const reloaded = (await json(await api(`/bills/${bill.id}`))).bill;
  assert.deepEqual(reloaded.items, updated.items, "unavailable parts and available amounts survive a fresh read");
});


for (const component of ["discount", "tax", "extra"] as const) {
  test(`${component} follows the frozen rate across downward thresholds, repeated corrections and upward corrections beyond the receipt amount`, async () => {
    const numerator = component === "extra" ? -3 : 3;
    let bill = await summarizedBill({ [`${component}Cents`]: numerator });
    const sibling = structuredClone(bill.items[0]);
    const allocatedKey = `allocated${component[0]!.toUpperCase()}${component.slice(1)}Cents`;
    for (const [amountCents, positiveShare] of [[100, 1], [99, 1], [34, 1], [33, 0], [1, 0], [0, 0], [100, 1], [300, 5]]) {
      const item = bill.items[1];
      const input = { name: item.name, quantity: "1", amountCents, discountCents: 0, taxable: true, manualFinal: false };
      const share = component === "extra" && positiveShare !== 0 ? -positiveShare! : positiveShare!;
      const final = component === "discount" ? amountCents! - share : amountCents! + share;
      const preview = previewCorrection(bill, item, { ...item, ...input });
      bill = (await json(await api(`/bills/${bill.id}/items/${item.id}`, "alice-token", "PATCH", { revision: bill.revision, ...input }))).bill;
      assert.deepEqual([bill.items[1][allocatedKey], bill.items[1].finalCents], [share, final]);
      assert.deepEqual([preview[allocatedKey], preview.finalCents], [share, final]);
      assert.deepEqual(bill.items[0], sibling, "no redistribution across siblings");
    }
  });
}

test("a one-cent receipt discount never becomes negative after correcting the tie-losing item to one cent", async () => {
  const bill = await summarizedBill({ discountCents: 1 });
  const item = bill.items[1];
  const input = { name: item.name, quantity: "1", amountCents: 1, discountCents: 0, taxable: true, manualFinal: false };
  const preview = previewCorrection(bill, item, { ...item, ...input });
  const saved = (await json(await api(`/bills/${bill.id}/items/${item.id}`, "alice-token", "PATCH", { revision: bill.revision, ...input }))).bill.items[1];
  assert.deepEqual([saved.allocatedDiscountCents, saved.finalCents], [0, 1]);
  assert.deepEqual([preview.allocatedDiscountCents, preview.finalCents], [0, 1]);
});


for (const sameItem of [true, false]) {
  test(`concurrent PATCH corrections on ${sameItem ? "the same item" : "different items"} commit exactly one revision without partial writes`, async () => {
    let bill = await summarizedBill({ taxCents: 30 }, [100, 100, 100]);
    bill = (await json(await api(`/bills/${bill.id}/claims`, "bob-token", "POST", {
      revision: bill.revision, claims: [{ itemId: bill.items[2].id, numerator: 1, denominator: 2 }],
    }))).bill;
    bill = (await json(await api(`/bills/${bill.id}`))).bill;
    const initial = structuredClone(bill);
    const corrections = [
      { index: 0, amountCents: 150, taxCents: 15, finalCents: 165 },
      { index: sameItem ? 0 : 1, amountCents: 200, taxCents: 20, finalCents: 220 },
    ];
    const responses = await Promise.all(corrections.map(correction => {
      const item = initial.items[correction.index];
      return api(`/bills/${bill.id}/items/${item.id}`, "alice-token", "PATCH", {
        revision: initial.revision, name: item.name, quantity: item.quantity,
        amountCents: correction.amountCents, discountCents: 0, taxable: true, manualFinal: false,
      });
    }));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const winner = corrections[responses.findIndex(r => r.status === 200)]!;
    await Promise.all(responses.map(response => response.arrayBuffer()));
    const saved = (await json(await api(`/bills/${bill.id}`))).bill;
    const expected = structuredClone(initial.items);
    expected[winner.index] = { ...expected[winner.index], amountCents: winner.amountCents, taxCents: winner.taxCents, allocatedTaxCents: winner.taxCents, finalCents: winner.finalCents };
    assert.equal(saved.revision, initial.revision + 1);
    assert.deepEqual(saved.items, expected, "only the winner changes; every sibling and its confirmations is byte-identical");
    assert.deepEqual(saved.participants, initial.participants, "neither request changes sibling claimants' shares");
  });
}

for (const launchClaimFirst of [false, true]) {
  test(`PATCH racing a claim serializes prices and reservations (${launchClaimFirst ? "claim" : "PATCH"} launched first)`, async () => {
    let bill = await summarizedBill({ taxCents: 30 }, [100, 100, 100]);
    bill = (await json(await api(`/bills/${bill.id}/claims`, "alice-token", "POST", {
      revision: bill.revision, claims: [{ itemId: bill.items[1].id, numerator: 1, denominator: 2 }],
    }))).bill;
    const initial = structuredClone(bill);
    const item = bill.items[0];
    const input = { name: item.name, quantity: item.quantity, amountCents: 150, discountCents: 0, taxable: true, manualFinal: false };
    const claims = [{ itemId: item.id, numerator: 1, denominator: 2 }];
    const patch = () => api(`/bills/${bill.id}/items/${item.id}`, "alice-token", "PATCH", { revision: initial.revision, ...input });
    const claim = () => api(`/bills/${bill.id}/claims`, "bob-token", "POST", { revision: initial.revision, claims });
    const responses = await Promise.all((launchClaimFirst ? [claim, patch] : [patch, claim]).map(request => request()));
    const patchResponse = responses[launchClaimFirst ? 1 : 0]!;
    const claimResponse = responses[launchClaimFirst ? 0 : 1]!;
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    await Promise.all(responses.map(response => response.arrayBuffer()));
    bill = (await json(await api(`/bills/${bill.id}`))).bill;
    assert.equal(bill.revision, initial.revision + 1);
    if (claimResponse.status === 200) {
      // The old-price claim won. The stale PATCH is atomic; retry at the
      // refreshed revision must reserve exactly that claim at the new price.
      assert.equal(bill.items[0].finalCents, 110);
      assert.ok(bill.items[0].claims[0].confirmedAt);
      bill = (await json(await api(`/bills/${bill.id}/items/${item.id}`, "alice-token", "PATCH", { revision: bill.revision, ...input }))).bill;
      const reservation = bill.items[0].claims[0];
      assert.deepEqual([reservation.numerator, reservation.denominator, reservation.confirmedAt], [1, 2, null]);
      const claimant = bill.participants.find((p: { userId: string }) => p.userId === reservation.userId);
      assert.deepEqual([claimant.amountCents, claimant.confirmedAt], [0, null]);
    } else {
      assert.equal(patchResponse.status, 200);
      assert.deepEqual(bill.items[0].claims, [], "the stale old-price claim was not written");
    }
    assert.equal(bill.items[0].finalCents, 165);
    assert.deepEqual(bill.items.slice(1), initial.items.slice(1), "other items and their confirmations are untouched");
    // Refreshing and confirming always uses the corrected price, whether
    // this creates a new claim or reconfirms a reservation.
    bill = (await json(await api(`/bills/${bill.id}/claims`, "bob-token", "POST", { revision: bill.revision, claims }))).bill;
    const confirmed = bill.items[0].claims[0];
    assert.ok(confirmed.confirmedAt);
    assert.equal(bill.participants.find((p: { userId: string }) => p.userId === confirmed.userId).amountCents, 83);
    assert.deepEqual(bill.items.slice(1), initial.items.slice(1));
  });
}


for (const example of [
  { name: "nontaxable", taxable: false, pricesIncludeTax: false, taxCents: 100 },
  { name: "tax included", taxable: true, pricesIncludeTax: true, taxCents: 100 },
  { name: "zero receipt tax", taxable: true, pricesIncludeTax: false, taxCents: 0 },
]) {
  test(`unavailable discount preserves known zero tax (${example.name}) and zero adjustment with preview parity`, async () => {
    const bill = await summarizedBill({ discountCents: 1, taxCents: example.taxCents, pricesIncludeTax: example.pricesIncludeTax }, [0], example.taxable, true);
    const item = bill.items[0];
    const input = { name: item.name, quantity: "1", amountCents: 100, discountCents: 0, taxable: example.taxable, manualFinal: true, finalCents: 500 };
    const preview = previewCorrection(bill, item, { ...item, ...input });
    const saved = (await json(await api(`/bills/${bill.id}/items/${item.id}`, "alice-token", "PATCH", { revision: bill.revision, ...input }))).bill;
    assert.deepEqual([saved.items[0].allocatedDiscountCents, saved.items[0].allocatedTaxCents, saved.items[0].allocatedExtraCents, saved.items[0].finalCents], [null, 0, 0, 500]);
    assert.deepEqual([preview.allocatedDiscountCents, preview.allocatedTaxCents, preview.allocatedExtraCents, preview.finalCents], [null, 0, 0, 500]);
    await json(await api(`/bills/${bill.id}/items/${item.id}`, "alice-token", "PATCH", { revision: saved.revision, ...input, manualFinal: false }), 400);
    const reloaded = (await json(await api(`/bills/${bill.id}`))).bill;
    assert.deepEqual([reloaded.revision, reloaded.items], [saved.revision, saved.items], "an unavailable automatic total cannot replace the manual final or change the revision");
  });
}


test("making an originally non-taxable item taxable uses the available frozen rate even when its net weight is unchanged", async () => {
  let bill = await summarizedBill({ taxCents: 1 }, [100, 100], [true, false]);
  const sibling = structuredClone(bill.items[0]);
  assert.deepEqual(bill.items.map((item: { allocatedTaxCents: number }) => item.allocatedTaxCents), [1, 0]);
  for (const taxable of [true, false, true]) {
    const item = bill.items[1];
    const input = { name: item.name, quantity: "1", amountCents: 100, discountCents: 0, taxable, manualFinal: false };
    const preview = previewCorrection(bill, item, { ...item, ...input });
    bill = (await json(await api(`/bills/${bill.id}/items/${item.id}`, "alice-token", "PATCH", { revision: bill.revision, ...input }))).bill;
    const expected = taxable ? [1, 101] : [0, 100];
    assert.deepEqual([bill.items[1].allocatedTaxCents, bill.items[1].finalCents], expected);
    assert.deepEqual([preview.allocatedTaxCents, preview.finalCents], expected);
    assert.deepEqual(bill.items[0], sibling);
  }
});


for (const scenario of [
  { rate: 0.13, ratio: { taxCents: 13, taxableBaseCents: 100 }, doubledTax: 26 },
  { rate: 0.06, ratio: { taxCents: 3, taxableBaseCents: 50 }, doubledTax: 12 },
  { rate: 0, ratio: { taxCents: 0, taxableBaseCents: 1 }, doubledTax: 0 },
]) {
  test(`Azure printed rate ${scenario.rate} preserves original cents but drops residuals at changed weights with preview parity`, async () => {
    let bill = await summarizedBill({ taxCents: 5, evidence: { taxDetails: [{ rate: scenario.rate, description: "Printed tax" }] } }, [100, 200]);
    assert.deepEqual(bill.frozenTaxRate, scenario.ratio);
    assert.deepEqual(bill.items.map((item: { allocatedTaxCents: number }) => item.allocatedTaxCents), [2, 3]);
    const sibling = structuredClone(bill.items[1]);
    for (const [amountCents, taxCents] of [[100, 2], [1, 0], [200, scenario.doubledTax], [100, 2]]) {
      const item = bill.items[0];
      const input = { name: item.name, quantity: "1", amountCents, discountCents: 0, taxable: true, manualFinal: false };
      const preview = previewCorrection(bill, item, { ...item, ...input });
      bill = (await json(await api(`/bills/${bill.id}/items/${item.id}`, "alice-token", "PATCH", { revision: bill.revision, ...input }))).bill;
      assert.deepEqual([bill.items[0].allocatedTaxCents, bill.items[0].finalCents], [taxCents, amountCents! + taxCents!]);
      assert.deepEqual([preview.allocatedTaxCents, preview.finalCents], [taxCents, amountCents! + taxCents!]);
      assert.deepEqual(bill.items[1], sibling);
    }
  });
}
