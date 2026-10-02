// Receipt scenarios: corrections. Each starts from its own group and records.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { receiptEnvironment, receiptGroup, claimSheet, itemOption } from './fixtures.mjs';

export const scenarios = [
  { name: 'correction-races', environment: receiptEnvironment, run: correctionRaces },
  { name: 'price-correction', environment: receiptEnvironment, run: priceCorrection },
  { name: 'legacy-price-correction', environment: receiptEnvironment, run: legacyPriceCorrection },
];

// Item corrections racing with other tabs and claims.
async function correctionRaces(env) {
  const { api, base } = env;
  const { group, memberIds, alice } = await receiptGroup(env);
  // A correction sends only rows edited since the editor opened, and marks only those rows reviewed.
  const raceDraftId = randomUUID();
  const raceItems = ["Apples", "Milk", "Bread"].map((name) => ({ id: randomUUID(), name, originalText: name.toUpperCase(), quantity: "1", amountCents: 300, discountCents: 0, taxable: false, finalCents: 300, manualFinal: false }));
  const raceDraft = (await api(`/groups/${group.id}/receipt-drafts/${raceDraftId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Correction races", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 900, participantIds: [memberIds.Alice, memberIds.Bob],
      receipt: { subtotalCents: 900, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
      items: raceItems,
    },
  })).draft;
  const raceBill = (await api(`/receipt-drafts/${raceDraftId}/initialize`, "alice-token", "POST", { revision: raceDraft.revision })).bill;
  const [raceApples, raceMilk, raceBread] = raceItems;
  await api(`/bills/${raceBill.id}/claims`, "alice-token", "POST", {
    reviewedItems: raceBill.items.map(({ id, version }) => ({ itemId: id, version })),
    claims: [{ itemId: raceMilk.id, numerator: 1, denominator: 2 }],
  });
  // Another tab corrects an item, as the initiator.
  const correctElsewhere = async (item, amountCents) => {
    const current = (await api(`/bills/${raceBill.id}`)).bill.items.find(({ id }) => id === item.id);
    await api(`/bills/${raceBill.id}/items/${item.id}`, "alice-token", "PATCH", {
      version: current.version, name: item.name, quantity: "1", amountCents, discountCents: 0, taxable: false, manualFinal: false,
    });
  };
  await alice.goto(`${base}#/bills/${raceBill.id}`);
  await alice.getByRole("button", { name: "Edit items & prices" }).click();
  await alice.getByRole("button", { name: "Edit Apples", exact: true }).click();
  await alice.getByLabel("Printed price", { exact: true }).fill("2.70");
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  // Bread is unselected, so its live change leaves Save enabled; its untouched row must not be sent.
  await correctElsewhere(raceBread, 350);
  await expect(alice.getByRole("button", { name: "View Bread · $3.50", exact: true })).toBeVisible();
  const racePatches = [];
  alice.on("request", (request) => {
    if (request.method() === "PATCH" && new URL(request.url()).pathname.startsWith(`/api/bills/${raceBill.id}/items/`))
      racePatches.push(new URL(request.url()).pathname.split("/").at(-1));
  });
  // Milk, which Alice holds, changes while the Apples correction is in flight.
  const applesPath = `/api/bills/${raceBill.id}/items/${raceApples.id}`;
  let raceError;
  await alice.route(`**${applesPath}`, async (route) => {
    try { await correctElsewhere(raceMilk, 400); } catch (error) { raceError = error; }
    await route.continue();
  }, { times: 1 });
  const applesSaved = alice.waitForResponse((response) => response.request().method() === "PATCH" &&
    new URL(response.url()).pathname === applesPath);
  await alice.getByRole("button", { name: "Save item changes", exact: true }).click();
  assert.equal((await applesSaved).status(), 200);
  assert.equal(raceError, undefined);
  await expect(alice.getByRole("button", { name: "Keep current items", exact: true })).toHaveCount(0);
  assert.deepEqual(racePatches, [raceApples.id]);
  await expect(alice.getByRole("button", { name: "View Milk · $4.00", exact: true })).toBeVisible();
  const raceRow = (name) => alice.locator(".claim-list .receipt-compact-row").filter({ has: alice.getByRole("button", { name: new RegExp(`^View ${name} ·`) }) });
  await expect(raceRow("Milk")).toContainText("Price $3.00 → $4.00");
  await expect(raceRow("Apples")).not.toContainText("Price");
  await expect(alice.getByRole("button", { name: "Confirm my item claims" })).toBeDisabled();
  // Milk still awaits review, but a correction from a freshly opened editor is not held back by it.
  await alice.getByRole("button", { name: "Edit items & prices" }).click();
  await alice.getByRole("button", { name: "Edit Bread", exact: true }).click();
  await alice.getByLabel("Printed price", { exact: true }).fill("3.20");
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await alice.getByRole("button", { name: "Save item changes", exact: true }).click();
  await expect(alice.getByRole("button", { name: "View Bread · $3.20", exact: true })).toBeVisible();
  await expect(raceRow("Milk")).toContainText("Price $3.00 → $4.00");
  await expect(alice.getByRole("button", { name: "Confirm my item claims" })).toBeDisabled();
  // A successful claim does not mark an unselected item's concurrent change as reviewed.
  await raceRow("Milk").getByRole("button").click();
  await claimSheet(alice, "Milk").getByRole("button", { name: "I've seen the new price", exact: true }).click();
  // Acknowledging moves on like a pick does, to Bread.
  await claimSheet(alice, "Bread").getByRole("button", { name: "Close claim", exact: true }).click();
  await expect(raceRow("Milk")).not.toContainText("Price");
  await alice.route(`**/api/bills/${raceBill.id}/claims`, async (route) => {
    try { await correctElsewhere(raceBread, 360); } catch (error) { raceError = error; }
    await route.continue();
  }, { times: 1 });
  const raceClaimed = alice.waitForResponse((response) => response.request().method() === "POST" &&
    new URL(response.url()).pathname === `/api/bills/${raceBill.id}/claims`);
  await alice.getByRole("button", { name: "Confirm my item claims" }).click();
  assert.equal((await raceClaimed).status(), 200);
  assert.equal(raceError, undefined);
  // Bread was unselected, so its change is shown quietly until Alice looks at it; it never blocks.
  await expect(raceRow("Bread")).toContainText("Updated");
  await expect(alice.getByRole("button", { name: "Confirm my item claims" })).toBeEnabled();
  await alice.getByRole("button", { name: "View Bread · $3.60", exact: true }).click();
  await expect(raceRow("Bread")).not.toContainText("Updated");
  await itemOption(alice, "1/4 · $0.90", "Bread").click();
  await expect(claimSheet(alice, "Bread")).toBeHidden();
  await expect(alice.getByRole("button", { name: "Confirm my item claims" })).toBeEnabled();

}

// Correcting prices on initiated bills whose stored receipt freezes the tax base.
async function priceCorrection(env) {
  const { api, base } = env;
  const { group, memberIds, alice } = await receiptGroup(env);
  // Post-initiation correction uses the same row and editor sheet on both widths.
  // A stored receipt freezes the tax base: only the edited item is repriced.
  const correctionDraftId = randomUUID();
  const initiatorId = memberIds.Alice;
  const correctionItems = [
    { id: randomUUID(), name: "Taxable pears", originalText: "PEARS RECEIPT LINE", quantity: "1", amountCents: 1000, discountCents: 0, taxable: true, finalCents: 1000, manualFinal: false },
    { id: randomUUID(), name: "Bread", originalText: "BREAD RECEIPT LINE", quantity: "1", amountCents: 2000, discountCents: 0, taxable: false, finalCents: 2000, manualFinal: false },
  ];
  const correctionDraft = (await api(`/groups/${group.id}/receipt-drafts/${correctionDraftId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Frozen rate correction", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 2910, participantIds: [initiatorId],
      receipt: { subtotalCents: 3000, discountCents: 300, taxCents: 180, extraCents: 30, pricesIncludeTax: false },
      items: correctionItems,
    },
  })).draft;
  const correctionBill = (await api(`/receipt-drafts/${correctionDraftId}/initialize`, "alice-token", "POST", { revision: correctionDraft.revision })).bill;
  assert.deepEqual(correctionBill.items.map(item => item.finalCents), [1090, 1820]);
  assert.deepEqual(correctionBill.frozenTaxRate, { taxCents: 180, taxableBaseCents: 900 });
  await alice.route(`**/api/bills/${correctionBill.id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const upstream = new URL(route.request().url());
    upstream.hostname = "127.0.0.1";
    const response = await route.fetch({ url: upstream.href });
    const body = await response.json();
    body.bill.receipt.taxLabel = "HST (13%)";
    await route.fulfill({ response, body: JSON.stringify(body) });
  });
  await alice.goto(`${base}#/bills/${correctionBill.id}`);
  await alice.getByRole("button", { name: "Receipt summary", exact: true }).click();
  const receiptSummary = alice.getByRole("dialog", { name: "Receipt summary", exact: true });
  await expect(receiptSummary).toContainText("HST (13%)");
  await receiptSummary.getByRole("button", { name: "Done", exact: true }).click();
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    await alice.setViewportSize(viewport);
    await alice.getByRole("button", { name: /View Taxable pears · \$/ }).click();
    const derivation = alice.getByRole("dialog", { name: "Taxable pears", exact: true });
    await expect(derivation).toContainText("PEARS RECEIPT LINE");
    await expect(derivation).toContainText("Receipt discount share");
    await expect(derivation).toContainText("Tax share");
    await expect(derivation).toContainText("Other adjustments share");
    await alice.getByRole("button", { name: "Close claim", exact: true }).click();
    await alice.getByRole("button", { name: "Edit items & prices" }).click();
    const pears = alice.getByRole("button", { name: "Edit Taxable pears", exact: true });
    await expect(pears).toContainText("10.90");
    await pears.click();
    const sheet = alice.getByRole("dialog", { name: "Correct item price" });
    await expect(sheet).toContainText("PEARS RECEIPT LINE");
    const box = await sheet.boundingBox();
    if (viewport.width < 700) {
      assert.ok(Math.abs(box.y + box.height - viewport.height) < 3, "Mobile correction editor is a bottom sheet");
    } else {
      assert.ok(box.x > viewport.width / 2, "Desktop correction editor is a side panel");
    }
    await alice.getByLabel("Printed price", { exact: true }).fill("12.00");
    await alice.getByLabel("Item discount", { exact: true }).fill("1.00");
    await expect(pears).toContainText("11.99");
    await expect(sheet.getByText("$1.98", { exact: true })).toBeVisible();
    await alice.getByRole("button", { name: "Next item", exact: true }).click();
    await expect(alice.getByLabel("Item name", { exact: true })).toHaveValue("Bread");
    await alice.getByRole("button", { name: "Previous item", exact: true }).click();
    await expect(alice.getByLabel("Item name", { exact: true })).toHaveValue("Taxable pears");
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await expect(alice.getByRole("button", { name: "Edit Bread", exact: true })).toContainText("18.20");
    if (viewport.width === 1280) {
      await alice.getByRole("button", { name: "Keep current items" }).click();
    } else {
      await alice.getByRole("button", { name: "Save item changes" }).click();
      await expect.poll(async () => (await api(`/bills/${correctionBill.id}`)).bill.items[0].finalCents).toBe(1199);
    }
  }
  const frozenCorrection = (await api(`/bills/${correctionBill.id}`)).bill;
  assert.deepEqual(frozenCorrection.items.map(item => item.finalCents), [1199, 1820]);
  assert.equal(frozenCorrection.items[0].allocatedTaxCents, 198);
  assert.equal(frozenCorrection.items[0].manualFinal, false);
  assert.equal(frozenCorrection.items[1].amountCents, 2000);
  // Explicit manual final still works, and returning to the frozen calculation restores the derived cost.
  await alice.getByRole("button", { name: "Edit items & prices" }).click();
  await alice.getByRole("button", { name: "Edit Taxable pears", exact: true }).click();
  await alice.getByRole("button", { name: "Set final manually", exact: true }).click();
  await alice.getByLabel("Final cost · CAD", { exact: true }).fill("12.20");
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await alice.getByRole("button", { name: "Save item changes" }).click();
  await expect.poll(async () => (await api(`/bills/${correctionBill.id}`)).bill.items[0].manualFinal).toBe(true);
  await alice.getByRole("button", { name: /View Taxable pears · \$/ }).click();
  await expect(alice.getByRole("dialog", { name: "Taxable pears", exact: true })).toContainText("Set manually by Alice");
  await alice.getByRole("button", { name: "Close claim", exact: true }).click();
  await alice.getByRole("button", { name: "Edit items & prices" }).click();
  await alice.getByRole("button", { name: "Edit Taxable pears", exact: true }).click();
  await alice.getByRole("button", { name: "Use receipt calculation", exact: true }).click();
  await alice.getByRole("checkbox", { name: "Taxable", exact: true }).uncheck();
  await expect(alice.getByRole("button", { name: "Edit Taxable pears", exact: true })).toContainText("10.01");
  await expect(alice.getByRole("dialog", { name: "Correct item price" }).getByText("$0.00", { exact: true })).toBeVisible();
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await alice.getByRole("button", { name: "Save item changes" }).click();
  await expect.poll(async () => (await api(`/bills/${correctionBill.id}`)).bill.items[0].finalCents).toBe(1001);
  const untaxedCorrection = (await api(`/bills/${correctionBill.id}`)).bill.items[0];
  assert.equal(untaxedCorrection.taxCents, 0);
  assert.equal(untaxedCorrection.manualFinal, false);

  // Included-tax receipts retain zero additional tax even when corrected prices change.
  const inclusiveDraftId = randomUUID();
  const inclusiveDraft = (await api(`/groups/${group.id}/receipt-drafts/${inclusiveDraftId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Tax-inclusive correction", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 2730, participantIds: [initiatorId],
      receipt: { subtotalCents: 3000, discountCents: 300, taxCents: 180, extraCents: 30, pricesIncludeTax: true },
      items: correctionItems.map(item => ({ ...item, id: randomUUID() })),
    },
  })).draft;
  const inclusiveBill = (await api(`/receipt-drafts/${inclusiveDraftId}/initialize`, "alice-token", "POST", { revision: inclusiveDraft.revision })).bill;
  assert.deepEqual(inclusiveBill.items.map(item => item.finalCents), [910, 1820]);
  await alice.goto(`${base}#/bills/${inclusiveBill.id}`);
  await alice.getByRole("button", { name: "Edit items & prices" }).click();
  await alice.getByRole("button", { name: "Edit Taxable pears", exact: true }).click();
  await alice.getByLabel("Printed price", { exact: true }).fill("12.00");
  await alice.getByLabel("Item discount", { exact: true }).fill("1.00");
  await expect(alice.getByRole("button", { name: "Edit Taxable pears", exact: true })).toContainText("10.01");
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await alice.getByRole("button", { name: "Save item changes" }).click();
  await expect.poll(async () => (await api(`/bills/${inclusiveBill.id}`)).bill.items[0].finalCents).toBe(1001);
  assert.equal((await api(`/bills/${inclusiveBill.id}`)).bill.items[0].taxCents, 0);
  // Printed Azure rate controls corrections even when printed tax ÷ base differs.
  const printedRateId = randomUUID();
  const printedRateDraft = (await api(`/groups/${group.id}/receipt-drafts/${printedRateId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Printed-rate correction", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 305, participantIds: [initiatorId],
      receipt: { subtotalCents: 300, discountCents: 0, taxCents: 5, extraCents: 0, pricesIncludeTax: false,
        evidence: { taxDetails: [{ rate: 0.13, description: "HST" }] } },
      items: [100, 200].map((amountCents, index) => ({ id: randomUUID(), name: `Taxed item ${index + 1}`,
        originalText: "PRINTED RATE", quantity: "1", amountCents, discountCents: 0,
        taxable: true, finalCents: 0, manualFinal: false })),
    },
  })).draft;
  const printedRateBill = (await api(`/receipt-drafts/${printedRateId}/initialize`, "alice-token", "POST",
    { revision: printedRateDraft.revision })).bill;
  assert.deepEqual(printedRateBill.frozenTaxRate, { taxCents: 13, taxableBaseCents: 100 });
  assert.equal(printedRateBill.items.reduce((sum, item) => sum + item.allocatedTaxCents, 0), 5);
  await alice.goto(`${base}#/bills/${printedRateBill.id}`);
  for (const scenario of [
    { printed: "2.00", cost: "2.26", finalCents: 226, taxCents: 26 },
    { printed: "0.01", cost: "0.01", finalCents: 1, taxCents: 0 },
    { printed: "1.00", cost: "1.02", finalCents: 102, taxCents: 2 },
  ]) {
    await alice.getByRole("button", { name: "Edit items & prices" }).click();
    await alice.getByRole("button", { name: "Edit Taxed item 1", exact: true }).click();
    await alice.getByLabel("Printed price", { exact: true }).fill(scenario.printed);
    await expect(alice.getByRole("button", { name: "Edit Taxed item 1", exact: true })).toContainText(scenario.cost);
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await alice.getByRole("button", { name: "Save item changes" }).click();
    await expect.poll(async () => (await api(`/bills/${printedRateBill.id}`)).bill.items[0].finalCents).toBe(scenario.finalCents);
    const corrected = (await api(`/bills/${printedRateBill.id}`)).bill;
    assert.equal(corrected.items[0].allocatedTaxCents, scenario.taxCents);
    assert.deepEqual(corrected.items[1], printedRateBill.items[1]);
  }
}

// Correcting legacy bills without stored receipt summaries.
async function legacyPriceCorrection(env) {
  const { api, base, pool } = env;
  const { group, memberIds, alice } = await receiptGroup(env);
  // Legacy initiated bills keep editable per-item components and add/delete controls.
  // Only fixture setup uses SQL: these bills predate stored receipt summaries.
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    const draftId = randomUUID();
    const ownerId = memberIds.Alice;
    const items = [
      { name: "Legacy apples", amountCents: 1000 },
      { name: "Historical cost", amountCents: 200 },
      { name: "Legacy override", amountCents: 100 },
    ].map(item => ({ ...item, id: randomUUID(), originalText: item.name.toUpperCase(), quantity: "1", discountCents: 0, finalCents: item.amountCents, manualFinal: false }));
    const draft = (await api(`/groups/${group.id}/receipt-drafts/${draftId}`, "alice-token", "PUT", {
      revision: 0, data: { mode: "items", title: `Legacy corrections ${viewport.width}`, purchaseDate: "2026-09-24", timeZone: "America/Toronto",
        notes: "", totalCents: 1300, participantIds: [ownerId], items },
    })).draft;
    const legacy = (await api(`/receipt-drafts/${draftId}/initialize`, "alice-token", "POST", { revision: draft.revision })).bill;
    await pool.query("UPDATE bills SET receipt = NULL, frozen_tax_base_cents = NULL, frozen_discount_base_cents = NULL, frozen_extra_base_cents = NULL WHERE id = $1", [legacy.id]);
    await pool.query("UPDATE bill_items SET taxable = NULL, manual_final = NULL, allocated_discount_cents = NULL, frozen_tax_rounding_cents = NULL, frozen_discount_rounding_cents = NULL, frozen_extra_rounding_cents = NULL WHERE bill_id = $1", [legacy.id]);
    await pool.query("UPDATE bill_items SET final_cents = 275 WHERE id = $1", [items[1].id]);
    await alice.setViewportSize(viewport);
    await alice.goto(`${base}#/bills/${legacy.id}`);
    const row = name => alice.getByRole("button", { name: `Edit ${name}`, exact: true });
    const open = () => alice.getByRole("button", { name: "Edit items & prices", exact: true }).click();
    const save = async () => {
      const reviewedItems = (await api(`/bills/${legacy.id}`)).bill.items.map(({ id, version }) => ({ itemId: id, version }));
      const response = alice.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname === `/api/bills/${legacy.id}/items`);
      await alice.getByRole("button", { name: "Save item changes", exact: true }).click();
      const result = await response;
      assert.deepEqual(result.request().postDataJSON().reviewedItems, reviewedItems);
      assert.equal("revision" in result.request().postDataJSON(), false);
      assert.equal(result.status(), 200);
      // The editor closes once saved; its Save button alone would vanish while it reads "Saving…".
      await expect(alice.locator(".receipt-correction")).toHaveCount(0);
    };
    await open();
    await expect(row("Historical cost")).toContainText("2.75");
    await row("Historical cost").click();
    const sheet = alice.getByRole("dialog", { name: /^Correct (legacy item|item price)$/ });
    await expect(sheet.getByRole("heading", { name: "Correct legacy item", exact: true })).toBeFocused();
    await expect(sheet.getByRole("checkbox", { name: "Taxable", exact: true })).toHaveCount(0);
    await expect(sheet).toContainText("Taxability is unavailable");
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await save();
    let current = (await api(`/bills/${legacy.id}`)).bill;
    assert.deepEqual(current.items.map(item => [item.finalCents, item.manualFinal]), [[1000, null], [275, null], [100, null]], "Opening and saving must not recalculate historical costs");
    await open();
    await row("Legacy apples").click();
    await sheet.getByLabel("Printed price", { exact: true }).fill("20.00");
    await expect(sheet.getByLabel("Final cost", { exact: true })).toHaveText("$20.00");
    await expect(sheet.getByRole("checkbox", { name: "Taxable", exact: true })).toHaveCount(0);
    await expect(sheet).toContainText("Taxability is unavailable");
    await sheet.getByLabel("Tax", { exact: true }).fill("1.00");
    await sheet.getByLabel("Item discount", { exact: true }).fill("0.25");
    await sheet.getByLabel("Other adjustment", { exact: true }).fill("-0.50");
    await expect(sheet.getByLabel("Final cost", { exact: true })).toHaveText("$20.25");
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await row("Legacy override").click();
    await sheet.getByRole("button", { name: "Set final manually", exact: true }).click();
    await sheet.getByLabel("Final cost · CAD", { exact: true }).fill("0.90");
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await alice.getByRole("button", { name: "Add an item", exact: true }).click();
    await expect(sheet.getByLabel("Item name", { exact: true })).toBeFocused();
    await sheet.getByLabel("Item name", { exact: true }).fill("Added legacy item");
    await sheet.getByLabel("Printed price", { exact: true }).fill("4.00");
    await expect(sheet.getByLabel("Final cost", { exact: true })).toHaveText("$4.00");
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await row("Added legacy item").click();
    await expect(sheet.getByRole("heading", { name: "Correct legacy item", exact: true })).toBeFocused();
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await save();
    current = (await api(`/bills/${legacy.id}`)).bill;
    assert.deepEqual(current.items.map(item => [item.finalCents, item.manualFinal]), [[2025, false], [275, null], [90, true], [400, false]]);
    assert.deepEqual([current.items[0].amountCents, current.items[0].taxCents, current.items[0].extraCents, current.items[0].discountCents], [2000, 100, -50, 25]);
    assert.equal(current.totalCents, 1300);
    await alice.reload();
    await open();
    await expect(row("Legacy override")).toContainText("Manual override");
    await row("Legacy override").click();
    await expect(sheet.getByLabel("Final cost · CAD", { exact: true })).toHaveValue("0.90");
    await sheet.getByRole("button", { name: "Use item calculation", exact: true }).click();
    await expect(sheet.getByLabel("Final cost", { exact: true })).toHaveText("$1.00");
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await row("Added legacy item").click();
    await sheet.getByRole("button", { name: "Remove item", exact: true }).click();
    await save();
    current = (await api(`/bills/${legacy.id}`)).bill;
    assert.deepEqual(current.items.map(item => [item.name, item.finalCents, item.manualFinal]), [["Legacy apples", 2025, false], ["Historical cost", 275, null], ["Legacy override", 100, false]]);
    assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
}
