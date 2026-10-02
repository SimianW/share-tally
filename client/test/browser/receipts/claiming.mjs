// Receipt scenarios: claiming. Each starts from its own group and records.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { receiptEnvironment, receiptGroup, claimSheet, itemOption } from './fixtures.mjs';
import { serverRequire } from '../environment.mjs';

export const scenarios = [
  { name: 'item-claims', environment: receiptEnvironment, run: itemClaims },
  { name: 'claim-controls', environment: receiptEnvironment, run: claimControls },
  { name: 'claim-auto-advance', environment: receiptEnvironment, run: claimAutoAdvance },
  { name: 'claiming-conflicts', environment: receiptEnvironment, run: claimingConflicts },
  { name: 'claim-review', environment: receiptEnvironment, run: claimReview },
  { name: 'claim-receipt-photo', environment: receiptEnvironment, run: claimReceiptPhoto },
];

// Sharing a manually entered item, claiming portions, reviewing a corrected price and completing.
async function itemClaims(env) {
  const { api, pageFor, base, errors } = env;
  const { group, alice } = await receiptGroup(env);
  await alice.setViewportSize({ width: 1280, height: 1000 });
  await alice.getByRole("button", { name: "New bill", exact: true }).click();
  await expect(
    alice.getByRole("heading", { name: "Start with your receipt" }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  await alice
    .getByRole("button", { name: "Enter items myself", exact: true })
    .click();
  await alice
    .getByRole("button", { name: "Add an item", exact: true })
    .click();
  await expect(alice.getByRole("dialog", { name: "Edit receipt item" }).getByRole("img", { name: "Receipt line" })).toHaveCount(0);
  const taxBox = await alice.getByRole("checkbox", { name: "Taxable", exact: true }).boundingBox();
  assert.ok(taxBox.width <= 24, "Tax checkbox must not inherit full-width input styling");
  await alice.getByLabel("Item name", { exact: true }).fill("Apples");
  await alice.getByLabel("Printed price", { exact: true }).fill("3.00");
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  // With no receipt total, the Items step agrees that the total paid follows the items.
  const followingBar = alice.locator(".receipt-reconciliation");
  await expect(followingBar).toContainText("Total paid follows items");
  await expect(followingBar).not.toContainText("Add the receipt total");
  await alice.getByRole("button", { name: "Continue to sharing" }).click();
  await expect(alice.getByRole("button", { name: "Edit 1 item", exact: true })).toBeVisible();
  await alice.getByLabel("Bill title", { exact: true }).fill("Shared apples");
  await alice.getByLabel("Bob", { exact: true }).check();
  await alice.getByLabel("Carol", { exact: true }).check();
  // Edits leave no standing status text; the leave guard covers unsaved work.
  await expect(alice.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
  // Split by item, the total paid follows the items unless a different charge is entered.
  const splitSection = alice.getByRole("group", { name: "Split" });
  await expect(alice.getByLabel("Total paid (CAD)", { exact: true })).toHaveCount(0);
  await expect(splitSection).toContainText("Total paid $3.00 · from items");
  await expect(alice.getByText("Enter an amount.", { exact: true })).toHaveCount(0);
  await expect(alice.getByRole("button", { name: "Share bill", exact: true })).toBeEnabled();
  await splitSection.getByRole("button", { name: "Paid a different amount?", exact: true }).click();
  await expect(alice.getByLabel("Total paid (CAD)", { exact: true })).toBeFocused();
  await alice.getByLabel("Total paid (CAD)", { exact: true }).fill("3.10");
  await expect(splitSection).toContainText("($0.10 under the total paid)");
  await splitSection.getByRole("button", { name: "Use item total", exact: true }).click();
  await expect(alice.getByLabel("Total paid (CAD)", { exact: true })).toHaveCount(0);
  await expect(splitSection).toContainText("Total paid $3.00 · from items");
  await alice.getByRole("button", { name: "Back", exact: true }).click();
  await alice.getByRole("button", { name: "Edit Apples", exact: true }).click();
  await alice.getByLabel("Printed price", { exact: true }).fill("3.50");
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await alice.getByRole("button", { name: "Continue to sharing" }).click();
  await expect(splitSection).toContainText("Total paid $3.50 · from items");
  await alice.getByRole("button", { name: "Back", exact: true }).click();
  await alice.getByRole("button", { name: "Edit Apples", exact: true }).click();
  await alice.getByLabel("Printed price", { exact: true }).fill("3.00");
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await alice.getByRole("button", { name: "Continue to sharing" }).click();
  await alice.getByRole("button", { name: "Save draft & close" }).click();
  await alice.locator(".draft-list-row").filter({ hasText: "Shared apples" }).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    alice.getByRole("heading", { name: "Who’s sharing this bill?" }),
  ).toBeVisible();
  await alice.getByRole("button", { name: "Back", exact: true }).click();
  await expect(alice.getByRole("button", { name: "Edit Apples", exact: true })).toContainText("3.00");
  await alice.getByRole("button", { name: "Continue to sharing" }).click();
  await expect(splitSection).toContainText("Total paid $3.00 · from items");
  await alice
    .getByRole("button", { name: "Share bill", exact: true })
    .click();
  await expect(
    alice.getByRole("heading", { name: "Items & claims" }),
  ).toBeVisible();
  const billId = alice.url().split("/").at(-1);
  assert.equal((await api(`/bills/${billId}`)).bill.totalCents, 300);
  await alice.getByRole("button", { name: "View Apples · $3.00", exact: true }).click();
  await expect(claimSheet(alice)).toBeVisible();
  // The sheet scrolls on its own; a pinned receipt photo there lets later content scroll over its caption.
  // This bill has no photo; probe the rule with a stand-in element in the open sheet.
  assert.equal(await claimSheet(alice).locator(".receipt-sheet-content").evaluate(content => {
    const probe = content.appendChild(document.createElement("div"));
    probe.className = "receipt-photo";
    const { position } = getComputedStyle(probe);
    probe.remove();
    return position;
  }), "static");
  await expect(claimSheet(alice)).toContainText("Printed price");
  await expect(claimSheet(alice)).toContainText("Receipt discount share");
  await expect(claimSheet(alice)).toContainText("Tax share");
  await expect(claimSheet(alice)).toContainText("Other adjustments share");
  // A single item has nowhere to step to.
  await expect(claimSheet(alice).getByRole("button", { name: "Next item", exact: true })).toHaveCount(0);
  await expect(claimSheet(alice)).toContainText(/^CLAIM AN ITEM(?! ·)/);
  // Picking a portion on the last item returns to the list and its Confirm button.
  const reopenApples = async () => {
    await expect(claimSheet(alice)).toBeHidden();
    await alice.getByRole("button", { name: "View Apples · $3.00", exact: true }).click();
    await expect(claimSheet(alice)).toBeVisible();
  };
  await expect(itemOption(alice, "Even · 1/3 · $1.00")).toBeVisible();
  await expect(claimSheet(alice).getByRole("group", { name: "Your portion" }).getByRole("button").first())
    .toHaveAttribute("aria-label", "Even · 1/3 · $1.00");
  await expect(itemOption(alice, "1/3 · $1.00")).toHaveCount(0);
  await itemOption(alice, "Even · 1/3 · $1.00").click();
  await expect(itemOption(alice, "Even · 1/3 · $1.00")).toHaveAttribute("aria-pressed", "true");
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $1.00");
  await reopenApples();
  await expect(itemOption(alice, "Even · 1/3 · $1.00")).toHaveAttribute("aria-pressed", "true");
  await itemOption(alice, "All of it · $3.00").click();
  await reopenApples();
  await itemOption(alice, "1/2 · $1.50").click();
  await reopenApples();
  await itemOption(alice, "Custom").click();
  await alice.getByLabel("Custom fraction", { exact: true }).fill("1/3");
  await itemOption(alice, "Use custom fraction").click();
  await reopenApples();
  await expect(itemOption(alice, "Even · 1/3 · $1.00")).toHaveAttribute("aria-pressed", "true");
  await expect(itemOption(alice, "Custom · 1/3 · $1.00")).toHaveAttribute("aria-pressed", "false");
  await itemOption(alice, "Custom · 1/3 · $1.00").click();
  await alice.getByLabel("Custom fraction", { exact: true }).fill("4/5");
  await itemOption(alice, "Use custom fraction").click();
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $2.40");
  await reopenApples();
  await expect(itemOption(alice, "Custom · 4/5 · $2.40")).toHaveAttribute("aria-pressed", "true");
  await itemOption(alice, "Even · 1/3 · $1.00").click();
  await reopenApples();
  await expect(itemOption(alice, "Even · 1/3 · $1.00")).toHaveAttribute("aria-pressed", "true");
  await expect(itemOption(alice, "Custom · 4/5 · $2.40")).toHaveAttribute("aria-pressed", "false");
  await expect(claimSheet(alice).locator(".claim-portion")).toContainText("$1.001/3 of $3.00");
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $1.00");
  await expect.poll(async () => (await api(`/bills/${billId}`)).bill.items[0].claims.length).toBe(0);
  // Removing a claim stays on the item. Alice's page keeps a fake clock from here on, so each
  // pause that must not advance is run through without real sleeps.
  await alice.clock.install();
  await alice.clock.pauseAt(await alice.evaluate(() => Date.now() + 1000));
  await claimSheet(alice).getByRole("button", { name: "Remove my claim", exact: true }).click();
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $0.00");
  await alice.clock.runFor(700);
  await expect(claimSheet(alice)).toBeVisible();
  await alice.clock.resume();
  await itemOption(alice, "Even · 1/3 · $1.00").click();
  await expect(claimSheet(alice)).toBeHidden();
  await alice.getByRole("button", { name: "Receipt summary", exact: true }).click();
  await expect(alice.getByRole("dialog", { name: "Receipt summary", exact: true })).toBeVisible();
  await alice.getByRole("button", { name: "Done", exact: true }).click();
  const initialItem = (await api(`/bills/${billId}`)).bill.items[0];
  const firstClaimRequest = alice.waitForRequest(request => request.method() === "POST" &&
    new URL(request.url()).pathname === `/api/bills/${billId}/claims`);
  await alice.getByRole("button", { name: "Confirm my item claims" }).click();
  assert.deepEqual((await firstClaimRequest).postDataJSON(), {
    reviewedItems: [{ itemId: initialItem.id, version: initialItem.version }],
    claims: [{ itemId: initialItem.id, numerator: 1, denominator: 3 }],
  });
  await expect(alice.locator(".claim-list .receipt-row-badges").first()).toContainText("Your claim");
  const bob = await pageFor("bob-token", { width: 390, height: 844 });
  await bob.goto(base);
  const itemAction = bob.getByRole("region", { name: "Needs your attention" })
    .getByRole("link", { name: /Claim your items.*Shared apples/ });
  await expect(itemAction).toBeVisible();
  await itemAction.click();
  await expect(bob).toHaveURL(`${base}#/bills/${billId}`);
  await bob.getByRole("button", { name: "View Apples · $3.00", exact: true }).click();
  await itemOption(bob, "Even · 1/3 · $1.00").click();
  await expect(claimSheet(bob)).toBeHidden();
  await bob.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect(bob.locator(".claim-list .receipt-row-badges").first()).toContainText("Your claim");
  await expect(alice.getByRole("button", { name: "Confirm my item claims" })).toBeEnabled();
  // Bob's claim is not a change Alice has to review.
  await expect(alice.locator(".claim-attention-chips")).toHaveCount(0);
  await alice.getByRole("button", { name: "Edit items & prices" }).click();
  const correctionRow = alice.getByRole("button", { name: "Edit Apples", exact: true });
  await expect(correctionRow).toContainText("3.00");
  await correctionRow.click();
  const correctionSheet = alice.getByRole("dialog", { name: "Correct item price" });
  await expect(correctionSheet).toBeVisible();
  await expect(correctionSheet).toContainText("Manually added item");
  await alice.getByLabel("Printed price", { exact: true }).fill("2.70");
  await expect(correctionRow).toContainText("2.70");
  await expect(correctionSheet.getByLabel("Final cost", { exact: true })).toHaveText("$2.70");
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  const correctionVersion = (await api(`/bills/${billId}`)).bill.items[0].version;
  const correctionRequest = alice.waitForRequest(request => request.method() === "PATCH" &&
    new URL(request.url()).pathname === `/api/bills/${billId}/items/${initialItem.id}`);
  await alice.getByRole("button", { name: "Save item changes", exact: true }).click();
  const correctionPayload = (await correctionRequest).postDataJSON();
  assert.equal(correctionPayload.version, correctionVersion);
  assert.equal("revision" in correctionPayload, false);
  await expect.poll(async () => (await api(`/bills/${billId}`)).bill.items[0].amountCents).toBe(270);
  const corrected = (await api(`/bills/${billId}`)).bill.items[0];
  assert.equal(corrected.amountCents, 270);
  assert.equal(corrected.finalCents, 270);
  assert.equal(corrected.manualFinal, false);
  await expect(bob.locator(".claim-list .receipt-row-badges").first()).toContainText("Your reservation · reconfirm");
  await expect(alice.locator(".claim-list .receipt-row-badges").first()).toContainText("Your reservation · reconfirm");
  // Bob's pick is on the corrected item, so the row names the new price and Confirm waits for him.
  await expect(bob.locator(".claim-list .receipt-row-badges").first()).toContainText("Price $3.00 → $2.70");
  await expect(bob.getByRole("button", { name: "Confirm my item claims" })).toBeDisabled();
  await bob.getByRole("button", { name: "1 item changed — review", exact: true }).click();
  const bobNotice = claimSheet(bob).locator(".claim-notice.is-review");
  await expect(bobNotice).toContainText("Alice changed this item since you picked it");
  await expect(bobNotice).toContainText("Your 1/3 is now $0.90 (was $1.00)");
  await bobNotice.getByRole("button", { name: "I've seen the new price", exact: true }).click();
  // With nothing after it, the acknowledged item returns to the list and its Confirm button.
  await expect(claimSheet(bob)).toBeHidden();
  await bob.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect(bob.locator(".claim-list .receipt-row-badges").first()).toContainText("Your claim");
  // Alice made the correction herself, so she has nothing to review.
  await expect(alice.locator(".claim-attention-chips")).toHaveCount(0);
  await expect(alice.locator(".claim-list .receipt-row-badges").first()).not.toContainText("Price");
  await alice.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect(alice.locator(".claim-list .receipt-row-badges").first()).toContainText("Your claim");
  const carol = await pageFor("carol-token", { width: 390, height: 844 });
  await carol.goto(`${base}#/bills/${billId}`);
  await carol.getByRole("button", { name: "View Apples · $2.70", exact: true }).click();
  await itemOption(carol, "Even · 1/3 · $0.90").click();
  await expect(claimSheet(carol)).toBeHidden();
  await carol.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect(
    carol.getByText("Complete and final.", { exact: false }),
  ).toBeVisible();
  assert.equal((await api(`/bills/${billId}`)).bill.adjustmentCents, 30);
  assert.equal(
    await carol.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await mkdir("/tmp/share-tally-receipt-smoke", { recursive: true });
  await carol.screenshot({
    path: "/tmp/share-tally-receipt-smoke/mobile.png",
    fullPage: true,
  });
  await alice.screenshot({
    path: "/tmp/share-tally-receipt-smoke/desktop.png",
    fullPage: true,
  });
}

// Portion choices for different group sizes, filters, overclaims and item navigation.
async function claimControls(env) {
  const { api, base } = env;
  const { group, members, memberIds, alice } = await receiptGroup(env);
  // Exercise portion controls and disabled overclaims.
  const assertItemChoiceCount = async (count, title, expectedEven, absent, present) => {
    const draftId = randomUUID();
    const participants = members.slice(0, count).map((member) => member.id);
    const itemId = randomUUID();
    const draft = (await api(`/groups/${group.id}/receipt-drafts/${draftId}`, "alice-token", "PUT", {
      revision: 0,
      data: {
        mode: "items", title, purchaseDate: "2026-09-24", timeZone: "America/Toronto",
        notes: "", totalCents: 100, participantIds: participants,
        receipt: { subtotalCents: 100, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
        items: [{ id: itemId, name: title, originalText: "", quantity: "1", amountCents: 100,
          discountCents: 0, taxable: false, finalCents: 100, manualFinal: true }],
      },
    })).draft;
    const bill = (await api(`/receipt-drafts/${draftId}/initialize`, "alice-token", "POST", { revision: draft.revision })).bill;
    await alice.goto(`${base}#/bills/${bill.id}`);
    await alice.getByRole("button", { name: `View ${title} · $1.00`, exact: true }).click();
    const sheet = claimSheet(alice, title);
    const choices = sheet.getByRole("group", { name: "Your portion" }).getByRole("button");
    await expect(choices.first()).toHaveAttribute("aria-label", expectedEven);
    await expect(itemOption(alice, absent, title)).toHaveCount(0);
    for (const label of present) await expect(itemOption(alice, label, title)).toBeVisible();
    await itemOption(alice, expectedEven, title).click();
    await expect(sheet).toBeHidden();
    await alice.getByRole("button", { name: `View ${title} · $1.00`, exact: true }).click();
    await expect(itemOption(alice, expectedEven, title)).toHaveAttribute("aria-pressed", "true");
    await alice.getByRole("button", { name: "Close claim", exact: true }).click();
  };
  await assertItemChoiceCount(1, "Solo choice", "Even · All · $1.00", "All of it · $1.00", []);
  await assertItemChoiceCount(2, "Pair choice", "Even · 1/2 · $0.50", "1/2 · $0.50", ["All of it · $1.00"]);
  const controlDraftId = randomUUID();
  const controlItems = [
    { id: randomUUID(), name: "Apples", originalText: "APPLES RECEIPT LINE", quantity: "1", amountCents: 300, discountCents: 0, taxable: false, finalCents: 300, manualFinal: false },
    { id: randomUUID(), name: "Milk", originalText: "MILK RECEIPT LINE", quantity: "1", amountCents: 200, discountCents: 0, taxable: false, finalCents: 200, manualFinal: false },
  ];
  const controlDraft = (await api(`/groups/${group.id}/receipt-drafts/${controlDraftId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Claim controls", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 500,
      participantIds: [memberIds.Alice, memberIds.Bob, memberIds.Carol],
      receipt: { subtotalCents: 500, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
      items: controlItems,
    },
  })).draft;
  const controlBill = (await api(`/receipt-drafts/${controlDraftId}/initialize`, "alice-token", "POST", { revision: controlDraft.revision })).bill;
  const apples = controlItems[0];
  await api(`/bills/${controlBill.id}/claims`, "bob-token", "POST", {
    reviewedItems: controlBill.items.map(({ id, version }) => ({ itemId: id, version })),
    claims: [{ itemId: apples.id, numerator: 2, denominator: 3 }],
  });
  await alice.goto(`${base}#/bills/${controlBill.id}`);
  const filters = alice.locator(".claim-filters");
  await filters.getByRole("button", { name: "Unclaimed (2)" }).click();
  await expect(alice.locator(".claim-list .receipt-row-open")).toHaveCount(2);
  await filters.getByRole("button", { name: "Mine (0)" }).click();
  await expect(alice.getByText("No items in this filter.")).toBeVisible();
  await filters.getByRole("button", { name: "All (2)" }).click();
  await expect(alice.locator(".claim-list .receipt-row-open")).toHaveCount(2);
  await alice.getByRole("button", { name: "View Apples · $3.00", exact: true }).click();
  const controlSheet = claimSheet(alice);
  await expect(controlSheet).toContainText("1/3 available to you");
  await expect(itemOption(alice, "All of it · $3.00")).toBeDisabled();
  await expect(itemOption(alice, "1/2 · $1.50")).toBeDisabled();
  // Bob's 2/3 appears as held by others; nothing is chosen yet.
  await expect(controlSheet.locator(".claim-portion")).toContainText("Pick a portion of $3.00");
  await expect(controlSheet.locator(".claim-legend")).toContainText("Bob · 2/3");
  await expect(controlSheet.locator(".claim-legend")).toContainText("Free · 1/3");
  for (const option of ["Even · 1/3 · $1.00", "1/4 · $0.75", "1/5 · $0.60", "1/6 · $0.50"])
    await expect(itemOption(alice, option)).toBeEnabled();
  await expect(itemOption(alice, "1/3 · $1.00")).toHaveCount(0);
  await expect(controlSheet).toContainText("CLAIM AN ITEM · 1 OF 2");
  const navButton = (name, item) => claimSheet(alice, item).getByRole("button", { name, exact: true });
  await expect(navButton("Previous item", "Apples")).toHaveAttribute("aria-disabled", "true");
  const quarterOption = itemOption(alice, "1/4 · $0.75");
  await quarterOption.click();
  // Picking a portion moves on to the next item in the list.
  await expect(claimSheet(alice, "Milk")).toContainText("CLAIM AN ITEM · 2 OF 2");
  await expect(navButton("Next item", "Milk")).toHaveAttribute("aria-disabled", "true");
  await navButton("Previous item", "Milk").click();
  await expect(controlSheet).toBeVisible();
  // Focus stays on the now-unavailable Previous button, so arrow keys keep working.
  assert.equal(await alice.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Previous item");
  await expect(quarterOption).toHaveAttribute("aria-pressed", "true");
  await quarterOption.hover();
  assert.ok(await quarterOption.evaluate((option) => option.matches(":hover")), "selected portion is still hovered");
  const actionColor = await controlSheet.evaluate((sheet) => {
    const probe = document.createElement("span");
    probe.style.background = "var(--action)";
    sheet.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  const selectedColor = await quarterOption.evaluate((option) => getComputedStyle(option).backgroundColor);
  assert.equal(selectedColor, actionColor, "selected portion keeps its action fill while hovered");
  await itemOption(alice, "Custom").click();
  await alice.getByLabel("Custom fraction", { exact: true }).fill("1/4");
  await itemOption(alice, "Use custom fraction").click();
  await expect(claimSheet(alice, "Milk")).toBeVisible();
  // Auto-advance focuses the new item's heading; the arrow keys step between items.
  await expect(claimSheet(alice, "Milk").getByRole("heading", { name: "Milk", exact: true })).toBeFocused();
  await alice.keyboard.press("ArrowLeft");
  await expect(controlSheet).toBeVisible();
  const customChoice = () => itemOption(alice, "Custom · 1/4 · $0.75");
  await expect(customChoice()).toHaveAttribute("aria-pressed", "true");
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $0.75");
  await itemOption(alice, "Even · 1/3 · $1.00").click();
  await expect(claimSheet(alice, "Milk")).toBeVisible();
  await navButton("Previous item", "Milk").click();
  await expect(itemOption(alice, "Even · 1/3 · $1.00")).toHaveAttribute("aria-pressed", "true");
  await expect(customChoice()).toHaveAttribute("aria-pressed", "false");
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $1.00");
  await navButton("Next item", "Apples").click();
  await itemOption(alice, "All of it · $2.00", "Milk").click();
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $3.00");
  await expect(claimSheet(alice, "Milk")).toBeHidden();
  await alice.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect.poll(async () => (await api(`/bills/${controlBill.id}`)).bill.items[1].claims.length).toBe(1);
  const confirmedControls = (await api(`/bills/${controlBill.id}`)).bill;
  assert.deepEqual(confirmedControls.items.map((item) => item.claims
    .map((claim) => [claim.userId, claim.numerator, claim.denominator])
    .sort(([left], [right]) => left.localeCompare(right))), [
    [[memberIds.Alice, 1, 3], [memberIds.Bob, 2, 3]].sort(([left], [right]) => left.localeCompare(right)),
    [[memberIds.Alice, 1, 1]],
  ]);

}

// Auto-advance after a pick, and everything that cancels it.
async function claimAutoAdvance(env) {
  const { api, base } = env;
  const { group, memberIds, alice } = await receiptGroup(env);
  const navButton = (name, item) => claimSheet(alice, item).getByRole("button", { name, exact: true });
  await alice.clock.install();
  // Auto-advance passes over items others hold in full; Previous, Next and the arrow keys still visit them.
  const skipDraftId = randomUUID();
  const skipItems = ["Bananas", "Taken rice", "Yogurt"].map((name) => ({ id: randomUUID(), name, originalText: name.toUpperCase(), quantity: "1", amountCents: 100, discountCents: 0, taxable: false, finalCents: 100, manualFinal: false }));
  const skipDraft = (await api(`/groups/${group.id}/receipt-drafts/${skipDraftId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Skip taken items", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 300, participantIds: [memberIds.Alice, memberIds.Bob],
      receipt: { subtotalCents: 300, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
      items: skipItems,
    },
  })).draft;
  const skipBill = (await api(`/receipt-drafts/${skipDraftId}/initialize`, "alice-token", "POST", { revision: skipDraft.revision })).bill;
  await api(`/bills/${skipBill.id}/claims`, "bob-token", "POST", {
    reviewedItems: skipBill.items.map(({ id, version }) => ({ itemId: id, version })),
    claims: [{ itemId: skipItems[1].id, numerator: 1, denominator: 1 }],
  });
  await alice.goto(`${base}#/bills/${skipBill.id}`);
  await alice.getByRole("button", { name: "View Bananas · $1.00", exact: true }).click();
  // Stop time so the pause before advancing can be measured.
  await alice.clock.pauseAt(await alice.evaluate(() => Date.now() + 1000));
  await itemOption(alice, "All of it · $1.00", "Bananas").click();
  await alice.clock.runFor(500);
  await expect(claimSheet(alice, "Bananas")).toBeVisible();
  await alice.clock.runFor(200);
  await expect(claimSheet(alice, "Yogurt")).toContainText("CLAIM AN ITEM · 3 OF 3");
  // At the end of the list, Next and → go nowhere but still cancel a pending advance.
  await itemOption(alice, "Even · 1/2 · $0.50", "Yogurt").click();
  // Playwright will not click an aria-disabled element; a person still can.
  await navButton("Next item", "Yogurt").click({ force: true });
  await alice.clock.runFor(700);
  await expect(claimSheet(alice, "Yogurt")).toBeVisible();
  await itemOption(alice, "Even · 1/2 · $0.50", "Yogurt").click();
  await navButton("Next item", "Yogurt").focus();
  await alice.keyboard.press("ArrowRight");
  await alice.clock.runFor(700);
  await expect(claimSheet(alice, "Yogurt")).toBeVisible();
  // So does a tap on the header outside the content, such as the item title.
  await itemOption(alice, "Even · 1/2 · $0.50", "Yogurt").click();
  await claimSheet(alice, "Yogurt").getByRole("heading", { name: "Yogurt", exact: true }).click();
  await alice.clock.runFor(700);
  await expect(claimSheet(alice, "Yogurt")).toBeVisible();
  // Closing cancels it too: reopening the item within the pause does not carry the old advance over.
  await itemOption(alice, "Even · 1/2 · $0.50", "Yogurt").click();
  await claimSheet(alice, "Yogurt").getByRole("button", { name: "Close claim", exact: true }).click();
  await alice.getByRole("button", { name: "View Yogurt · $1.00", exact: true }).click();
  await alice.clock.runFor(700);
  await expect(claimSheet(alice, "Yogurt")).toBeVisible();
  // So does an activation that sends only a click, as some assistive technology does.
  await itemOption(alice, "Even · 1/2 · $0.50", "Yogurt").click();
  await claimSheet(alice, "Yogurt").evaluate((dialog) => dialog.querySelector(".claim-portion-custom").click());
  await alice.clock.runFor(700);
  await expect(claimSheet(alice, "Yogurt").getByLabel("Custom fraction", { exact: true })).toBeVisible();
  // Arrow keys type in the custom fraction instead of changing items.
  await claimSheet(alice, "Yogurt").getByLabel("Custom fraction", { exact: true }).click();
  await alice.keyboard.press("ArrowLeft");
  await expect(claimSheet(alice, "Yogurt").getByLabel("Custom fraction", { exact: true })).toBeFocused();
  // Moving to another item by hand cancels the advance picked on the one before.
  await itemOption(alice, "Even · 1/2 · $0.50", "Yogurt").click();
  await navButton("Previous item", "Yogurt").click();
  await alice.clock.runFor(700);
  await expect(claimSheet(alice, "Taken rice")).toContainText("0/1 available to you");
  await alice.clock.resume();
  await expect(claimSheet(alice, "Taken rice").locator("[aria-live]")).toHaveText("Taken rice, item 2 of 3");
  // Arrow keys keep working after the focused portion button is replaced by the next item.
  await navButton("Previous item", "Taken rice").click();
  await itemOption(alice, "Even · 1/2 · $0.50", "Bananas").focus();
  await alice.keyboard.press("ArrowRight");
  await expect(claimSheet(alice, "Taken rice")).toBeVisible();
  await alice.keyboard.press("ArrowRight");
  await expect(claimSheet(alice, "Yogurt")).toBeVisible();
  await itemOption(alice, "All of it · $1.00", "Yogurt").click();
  await expect(claimSheet(alice, "Yogurt")).toBeHidden();
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $2.00");
  // Picking the same portion again still moves on.
  await alice.getByRole("button", { name: "View Yogurt · $1.00", exact: true }).click();
  await itemOption(alice, "All of it · $1.00", "Yogurt").click();
  await expect(claimSheet(alice, "Yogurt")).toBeHidden();
  // The sheet keeps the list it was opened from, even when a change drops the item from that filter.
  await alice.locator(".claim-filters").getByRole("button", { name: "Mine (2)" }).click();
  await alice.getByRole("button", { name: "View Bananas · $1.00", exact: true }).click();
  await expect(claimSheet(alice, "Bananas")).toContainText("CLAIM AN ITEM · 1 OF 2");
  await navButton("Next item", "Bananas").click();
  await claimSheet(alice, "Yogurt").getByRole("button", { name: "Remove my claim", exact: true }).click();
  await expect(alice.locator(".claim-filters")).toContainText("Mine (1)");
  await expect(claimSheet(alice, "Yogurt")).toContainText("CLAIM AN ITEM · 2 OF 2");
  await navButton("Previous item", "Yogurt").click();
  await expect(claimSheet(alice, "Bananas")).toContainText("CLAIM AN ITEM · 1 OF 2");
  await claimSheet(alice, "Bananas").getByRole("button", { name: "Close claim", exact: true }).click();

}

// Two members claiming the last portion at once.
async function claimingConflicts(env) {
  const { api, base } = env;
  const { group, memberIds, alice } = await receiptGroup(env);
  const bob = await env.pageFor("bob-token", { width: 390, height: 844 });
  const conflictDraftId = randomUUID();
  const conflictItem = { id: randomUUID(), name: "Conflict item", originalText: "CONFLICT ITEM", quantity: "1", amountCents: 100, discountCents: 0, taxable: false, finalCents: 100, manualFinal: false };
  const conflictDraft = (await api(`/groups/${group.id}/receipt-drafts/${conflictDraftId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Concurrent claims", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 100, participantIds: [memberIds.Alice, memberIds.Bob],
      receipt: { subtotalCents: 100, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
      items: [conflictItem],
    },
  })).draft;
  const conflictBill = (await api(`/receipt-drafts/${conflictDraftId}/initialize`, "alice-token", "POST", { revision: conflictDraft.revision })).bill;
  await alice.goto(`${base}#/bills/${conflictBill.id}`);
  await bob.goto(`${base}#/bills/${conflictBill.id}`);
  for (const page of [alice, bob]) {
    await page.getByRole("button", { name: "View Conflict item · $1.00", exact: true }).click();
    await itemOption(page, "All of it · $1.00", "Conflict item").click();
    await expect(claimSheet(page, "Conflict item")).toBeHidden();
  }
  await Promise.all([
    alice.getByRole("button", { name: "Confirm my item claims" }).click(),
    bob.getByRole("button", { name: "Confirm my item claims" }).click(),
  ]);
  await expect.poll(async () => (await api(`/bills/${conflictBill.id}`)).bill.items[0].claims.length).toBe(1);
  const conflictResult = (await api(`/bills/${conflictBill.id}`)).bill;
  assert.equal(conflictResult.items[0].claims.length, 1);
  const conflictLoser = conflictResult.items[0].claims[0].userId === memberIds.Alice ? bob : alice;
  // The loser keeps their pick; the refreshed row turns red and names the item that ran out.
  const conflictAlert = conflictLoser.getByRole("alert").filter({ hasText: "Someone just updated Conflict item" });
  await expect(conflictAlert).toContainText("nothing is left. Your picks are kept.");
  const conflictRow = conflictLoser.locator(".claim-list .receipt-compact-row").first();
  await expect(conflictRow).toHaveClass(/is-over/);
  await expect(conflictRow).toContainText("Over by 1");
  await expect(conflictRow).toContainText("Someone just updated this");
  await expect(conflictLoser.getByRole("button", { name: "Confirm my item claims" })).toBeDisabled();
}

// Per-person bars, over-allocation and per-item review while others claim and edit.
async function claimReview(env) {
  const { api, pageFor, base, pool } = env;
  const { group, memberIds, alice } = await receiptGroup(env);

  // #154: per-person bars, over-allocation and per-item review, seen by Carol while Bob claims
  // and Alice edits the bill elsewhere.
  const reviewItems = [["Oat milk", 898], ["Bread", 600], ["Eggs", 600], ["Cheese", 600]].map(([name, cents]) => ({ id: randomUUID(), name, originalText: name.toUpperCase(), quantity: "1", amountCents: cents, discountCents: 0, taxable: false, finalCents: cents, manualFinal: false }));
  const [oatMilk, bread, eggs, cheese] = reviewItems;
  const reviewDraftId = randomUUID();
  const reviewDraft = (await api(`/groups/${group.id}/receipt-drafts/${reviewDraftId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Claim review", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 2698, participantIds: [memberIds.Alice, memberIds.Bob, memberIds.Carol],
      receipt: { subtotalCents: 2698, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
      items: reviewItems,
    },
  })).draft;
  const reviewBill = (await api(`/receipt-drafts/${reviewDraftId}/initialize`, "alice-token", "POST", { revision: reviewDraft.revision })).bill;
  // Without a receipt summary the initiator edits the whole list, so items can be added and removed.
  await pool.query("UPDATE bills SET receipt = NULL, frozen_tax_base_cents = NULL, frozen_discount_base_cents = NULL, frozen_extra_base_cents = NULL WHERE id = $1", [reviewBill.id]);
  await pool.query("UPDATE bill_items SET taxable = NULL, manual_final = NULL, allocated_discount_cents = NULL, frozen_tax_rounding_cents = NULL, frozen_discount_rounding_cents = NULL, frozen_extra_rounding_cents = NULL WHERE bill_id = $1", [reviewBill.id]);
  const reviewed = async () => (await api(`/bills/${reviewBill.id}`)).bill.items.map(({ id, version }) => ({ itemId: id, version }));
  // Each claim request replaces all of that person's claims on the bill.
  const claimAs = async (token, claims) => api(`/bills/${reviewBill.id}/claims`, token, "POST", {
    reviewedItems: await reviewed(),
    claims: claims.map(([item, numerator, denominator]) => ({ itemId: item.id, numerator, denominator })),
  });
  // Alice, in another tab, edits the whole item list.
  const editReviewItems = async (change) => {
    const current = (await api(`/bills/${reviewBill.id}`)).bill.items;
    const items = change(current.map(({ id, name, originalText, quantity, amountCents, taxCents, discountCents, extraCents, finalCents }) =>
      ({ id, name, originalText, quantity, amountCents, taxCents: taxCents ?? 0, discountCents, extraCents: extraCents ?? 0, finalCents })));
    await api(`/bills/${reviewBill.id}/items`, "alice-token", "PUT", { reviewedItems: current.map(({ id, version }) => ({ itemId: id, version })), items });
  };
  const reprice = (item, cents) => (items) => items.map((entry) => entry.id === item.id ? { ...entry, amountCents: cents, finalCents: cents } : entry);
  await claimAs("carol-token", [[oatMilk, 1, 4], [cheese, 1, 2]]);
  await claimAs("bob-token", [[bread, 1, 3]]);
  const reviewer = await pageFor("carol-token", { width: 1280, height: 1000 });
  await mkdir("/tmp/share-tally-receipt-smoke", { recursive: true });
  // Key states for design review, on desktop and then on a 390×844 phone.
  // List states scroll the row in question into view first. Each capture waits until the sheet's
  // entry animation and the bars' springs have stopped: nothing on them is animating, and their
  // positions and opacity hold still across two frames.
  const settle = () => expect.poll(() => reviewer.evaluate(async () => {
    const moving = ".claim-bar, .claim-meter, .receipt-sheet-content";
    const snapshot = () => JSON.stringify([...document.querySelectorAll(`.claim-bar [data-segment], ${moving}`)]
      .map((element) => { const box = element.getBoundingClientRect(); return [box.x, box.width, getComputedStyle(element).opacity]; }));
    const before = snapshot();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const animating = document.getAnimations().some((animation) => animation.playState === "running" &&
      animation.effect?.target instanceof Element && animation.effect.target.closest(moving));
    return !animating && snapshot() === before;
  })).toBe(true);
  const reviewShot = async (name, subject) => {
    await subject?.scrollIntoViewIfNeeded();
    await settle();
    await reviewer.screenshot({ path: `/tmp/share-tally-receipt-smoke/claim-review-${name}-desktop.png` });
    await reviewer.setViewportSize({ width: 390, height: 844 });
    assert.equal(await reviewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} fits a phone`);
    await subject?.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await settle();
    await reviewer.screenshot({ path: `/tmp/share-tally-receipt-smoke/claim-review-${name}-mobile.png` });
    await reviewer.setViewportSize({ width: 1280, height: 1000 });
  };
  await reviewer.goto(`${base}#/bills/${reviewBill.id}`);
  const reviewSheet = (name) => claimSheet(reviewer, name);
  const reviewRow = (name) => reviewer.locator(".claim-list .receipt-compact-row").filter({ has: reviewer.getByRole("button", { name: new RegExp(`^View ${name} ·`) }) });
  const reviewConfirm = reviewer.getByRole("button", { name: "Confirm my item claims", exact: true });
  const sheetBar = (name) => reviewSheet(name).locator(".claim-portion .claim-bar");
  // A segment's share of the bar, and where its right edge sits relative to the bar's.
  const segmentGeometry = (name, segment) => sheetBar(name).evaluate((bar, key) => {
    const track = bar.querySelector(".claim-bar-track").getBoundingClientRect();
    const box = bar.querySelector(`[data-segment="${key}"]`)?.getBoundingClientRect();
    return box ? { share: box.width / track.width, rightGap: track.right - box.right } : null;
  }, segment);
  await reviewer.getByRole("button", { name: "View Bread · $6.00", exact: true }).click();
  await expect(reviewSheet("Bread").locator(".claim-legend")).toContainText("Bob · 1/3");
  await itemOption(reviewer, "1/4 · $1.50", "Bread").click();
  await expect(reviewSheet("Eggs")).toBeVisible();
  await reviewSheet("Eggs").getByRole("button", { name: "Previous item", exact: true }).click();
  await expect.poll(async () => (await segmentGeometry("Bread", memberIds.Bob))?.share).toBeCloseTo(1 / 3, 2);

  // Bob's saved claim grows his own segment and highlights it, with the change in the legend.
  // Carol's unsaved 1/4 stays as it was.
  await claimAs("bob-token", [[bread, 1, 2]]);
  const bobChip = reviewSheet("Bread").locator(`.claim-legend-chip[data-person="${memberIds.Bob}"]`);
  await expect(bobChip).toContainText("Bob · 1/2+1/6");
  await expect(bobChip).toHaveClass(/is-lit/);
  await expect(sheetBar("Bread").locator(`[data-flash="${memberIds.Bob}"]`)).toHaveCount(1);
  await expect(reviewRow("Bread").locator(`[data-flash="${memberIds.Bob}"]`)).toHaveCount(1);
  // Captured once Bob's segment reaches its new width, normally well within the highlight's 1.2 s.
  await expect.poll(async () => (await segmentGeometry("Bread", memberIds.Bob))?.share).toBeCloseTo(1 / 2, 2);
  await reviewer.screenshot({ path: "/tmp/share-tally-receipt-smoke/claim-review-live-change-desktop.png" });
  await expect(reviewSheet("Bread").locator(".claim-legend")).toContainText("You · 1/4");
  await expect(itemOption(reviewer, "1/4 · $1.50", "Bread")).toHaveAttribute("aria-pressed", "true");
  // The highlight lasts about a second, then the legend settles.
  await expect(sheetBar("Bread").locator(".claim-bar-flash")).toHaveCount(0, { timeout: 3000 });
  await expect(bobChip).not.toHaveClass(/is-lit/);
  await expect(bobChip).not.toContainText("+1/6");

  // Fully held: the bar fills to its end, with no separator after the last segment.
  await claimAs("bob-token", [[bread, 3, 4]]);
  await expect(bobChip).toContainText("Bob · 3/4");
  await expect.poll(async () => (await segmentGeometry("Bread", "you"))?.rightGap).toBeCloseTo(0, 0);
  await expect.poll(async () => (await segmentGeometry("Bread", memberIds.Bob))?.share).toBeCloseTo(3 / 4, 2);
  const separators = await sheetBar("Bread").evaluate((bar) => [...bar.querySelectorAll(".claim-bar-segment")]
    .map((segment) => getComputedStyle(segment).boxShadow.includes("-2px")));
  assert.deepEqual(separators, [true, false], "only the segment before Carol's has a separator");
  // The compact meter on the row fills to its end as well, once its springs settle.
  const rowMeter = () => reviewRow("Bread").locator(".claim-bar").evaluate((bar) => {
    const track = bar.querySelector(".claim-bar-track").getBoundingClientRect();
    const segments = [...bar.querySelectorAll(".claim-bar-segment")];
    const [first, last] = [segments[0].getBoundingClientRect(), segments.at(-1).getBoundingClientRect()];
    return {
      settled: Math.abs(first.width / track.width - 3 / 4) < 0.002,
      rightGap: track.right - last.right,
      separators: segments.map((segment) => getComputedStyle(segment).boxShadow.includes("-2px")),
    };
  });
  await expect.poll(async () => { const meter = await rowMeter(); return meter.settled && Math.abs(meter.rightGap) <= 0.5; }).toBe(true);
  assert.deepEqual((await rowMeter()).separators, [true, false], "the row meter has no separator after its last segment");
  await expect(reviewSheet("Bread").locator(".claim-legend")).not.toContainText("Free");
  await reviewShot("full");

  // Over-allocated before saving: the overflow runs red past where the item ends.
  await claimAs("bob-token", [[bread, 5, 6]]);
  const overText = reviewSheet("Bread").locator(".claim-over-text");
  await expect(overText).toHaveText("Only 1/6 left. Your 1/4 is over by 1/12. Pick 1/6 or less to confirm.");
  // The overflow is Carol's 1/12 too many, on a bar scaled to 5/6 + 1/4 = 13/12.
  await expect.poll(async () => (await segmentGeometry("Bread", "over"))?.share).toBeCloseTo(1 / 13, 2);
  // The item ends 12/13 of the way along a bar scaled to 5/6 + 1/4.
  await expect.poll(() => sheetBar("Bread").evaluate((bar) => {
    const track = bar.querySelector(".claim-bar-track").getBoundingClientRect();
    const edge = bar.querySelector(".claim-bar-edge").getBoundingClientRect();
    return (edge.left + edge.width / 2 - track.left) / track.width;
  })).toBeCloseTo(12 / 13, 2);
  await expect(reviewSheet("Bread").locator(".claim-sheet-footer")).toContainText("Resolve this item to unlock Confirm");
  await reviewShot("over-sheet");
  await reviewSheet("Bread").getByRole("button", { name: "Close claim", exact: true }).click();
  await expect(reviewRow("Bread")).toHaveClass(/is-over/);
  await expect(reviewRow("Bread")).toContainText("Over by 1/12");
  await expect(reviewer.getByRole("button", { name: "View Bread · $6.00", exact: true })).toHaveAccessibleDescription(/Over by 1\/12/);
  await expect(reviewConfirm).toBeDisabled();
  const overChip = reviewer.getByRole("button", { name: "1 item exceeds what's left", exact: true });
  await overChip.click();
  await expect(reviewSheet("Bread")).toBeVisible();
  await reviewSheet("Bread").getByRole("button", { name: "Take the 1/6 left · $1.00", exact: true }).click();
  await expect(overText).toHaveCount(0);
  await expect(reviewSheet("Eggs")).toBeVisible();
  await itemOption(reviewer, "1/2 · $3.00", "Eggs").click();
  await expect(reviewSheet("Cheese")).toBeVisible();
  await reviewSheet("Cheese").getByRole("button", { name: "Close claim", exact: true }).click();
  await expect(overChip).toHaveCount(0);

  // Over-allocated at save time: Bob takes most of the eggs while Carol's Confirm is in flight.
  let reviewRaceError;
  await reviewer.route(`**/api/bills/${reviewBill.id}/claims`, async (route) => {
    try { await claimAs("bob-token", [[bread, 5, 6], [eggs, 2, 3]]); } catch (error) { reviewRaceError = error; }
    await route.continue();
  }, { times: 1 });
  const rejected = reviewer.waitForResponse((response) => response.request().method() === "POST" &&
    new URL(response.url()).pathname === `/api/bills/${reviewBill.id}/claims`);
  await reviewConfirm.click();
  assert.equal((await rejected).status(), 409);
  assert.equal(reviewRaceError, undefined);
  await expect(reviewer.locator(".claim-footer-error")).toHaveText("Not saved. Someone just updated Eggs — only 1/3 left. Your picks are kept.");
  await expect(reviewRow("Eggs")).toHaveClass(/is-over/);
  await expect(reviewRow("Eggs")).toContainText("Over by 1/6");
  await expect(reviewRow("Eggs")).toContainText("Someone just updated this");
  await expect(reviewRow("Eggs")).toContainText("Your portion 1/2 · not submitted");
  await expect(reviewConfirm).toBeDisabled();
  await reviewShot("save-conflict", reviewRow("Eggs"));
  await overChip.click();
  const conflictNotice = reviewSheet("Eggs").locator(".claim-notice.is-over");
  await expect(conflictNotice).toContainText("Someone just updated this item — only 1/3 left");
  await itemOption(reviewer, "Even · 1/3 · $2.00", "Eggs").click();
  await expect(conflictNotice).toHaveCount(0);
  await expect(reviewSheet("Cheese")).toBeVisible();
  await reviewSheet("Cheese").getByRole("button", { name: "Close claim", exact: true }).click();
  await expect(reviewer.locator(".claim-footer-error")).toHaveCount(0);
  await expect(reviewConfirm).toBeEnabled();

  // Alice changes the oat milk price, adds syrup and removes the cheese Carol picked.
  const syrup = { id: randomUUID(), name: "Syrup", originalText: "SYRUP", quantity: "1", amountCents: 500, taxCents: 0, discountCents: 0, extraCents: 0, finalCents: 500 };
  await editReviewItems((items) => [...reprice(oatMilk, 1123)(items).filter((item) => item.id !== cheese.id), syrup]);
  await expect(reviewRow("Oat milk")).toContainText("Price $8.98 → $11.23");
  await expect(reviewRow("Oat milk")).toHaveClass(/is-review/);
  await expect(reviewRow("Syrup")).toContainText("New");
  const removedRow = reviewer.locator(`[data-removed="${cheese.id}"]`);
  await expect(removedRow).toContainText("Removed — your 1/2 ($3.00) was dropped");
  const reviewChip = (count) => reviewer.getByRole("button", { name: `${count} item${count === 1 ? "" : "s"} changed — review`, exact: true });
  await expect(reviewChip(3)).toBeVisible();
  await expect(reviewConfirm).toBeDisabled();
  // The short row names stay; each status reaches screen readers as the row's description.
  await expect(reviewer.getByRole("button", { name: "View Oat milk · $11.23", exact: true })).toHaveAccessibleDescription(/Price \$8\.98 → \$11\.23/);
  await expect(reviewer.getByRole("button", { name: "View Syrup · $5.00", exact: true })).toHaveAccessibleDescription(/\bNew\b/);
  await expect(removedRow.getByRole("button", { name: "Got it", exact: true })).toHaveAccessibleDescription(/Removed — your 1\/2 \(\$3\.00\) was dropped/);
  await reviewShot("attention", reviewRow("Oat milk"));
  // The chip opens the first item needing review, in list order.
  await reviewChip(3).click();
  const priceNotice = reviewSheet("Oat milk").locator(".claim-notice.is-review");
  await expect(priceNotice).toContainText("Alice changed this item since you picked it");
  await expect(priceNotice).toContainText("Your 1/4 is now $2.81 (was $2.25)");
  const reviewFooter = (name) => reviewSheet(name).locator(".claim-sheet-footer");
  await expect(reviewFooter("Oat milk")).toContainText("Confirm is locked: 2 other items need you");
  await reviewShot("changed-sheet");
  // Next to review goes to the removed cheese, which has no sheet: its row takes focus.
  await reviewFooter("Oat milk").getByRole("button", { name: "Next to review", exact: true }).click();
  await expect(reviewSheet("Oat milk")).toBeHidden();
  await expect(removedRow.getByRole("button", { name: "Got it", exact: true })).toBeFocused();
  await removedRow.getByRole("button", { name: "Got it", exact: true }).click();
  await expect(removedRow).toHaveCount(0);
  await expect(reviewChip(2)).toBeVisible();
  // Opening a new item acknowledges it.
  await reviewer.getByRole("button", { name: "View Syrup · $5.00", exact: true }).click();
  await expect(reviewSheet("Syrup").locator(".claim-notice.is-new")).toContainText("Alice added this after you started");
  await expect(reviewRow("Syrup")).not.toContainText("New");
  await expect(reviewFooter("Syrup")).toContainText("Confirm is locked: 1 other item needs you");
  await reviewFooter("Syrup").getByRole("button", { name: "Next to review", exact: true }).click();
  await expect(priceNotice).toBeVisible();
  await expect(reviewFooter("Oat milk")).toContainText("Resolve this item to unlock Confirm");

  // "I've seen the new price" moves on after the same pause as a pick, to the next item with room.
  await reviewer.clock.install();
  await reviewer.clock.pauseAt(await reviewer.evaluate(() => Date.now() + 1000));
  await priceNotice.getByRole("button", { name: "I've seen the new price", exact: true }).click();
  await reviewer.clock.runFor(500);
  await expect(reviewSheet("Oat milk").locator(".claim-resolved")).toContainText("Reviewed");
  await expect(reviewFooter("Oat milk")).toContainText("Nothing else needs review");
  await reviewer.clock.runFor(200);
  await expect(reviewSheet("Bread")).toBeVisible();
  await expect(reviewRow("Oat milk")).not.toContainText("Price");
  // The advance is cancelled if the item changes during the pause.
  await editReviewItems(reprice(bread, 660));
  const breadNotice = reviewSheet("Bread").locator(".claim-notice.is-review");
  await expect(breadNotice).toContainText("Price $6.00 → $6.60");
  await breadNotice.getByRole("button", { name: "I've seen the new price", exact: true }).click();
  await editReviewItems(reprice(bread, 700));
  await expect(breadNotice).toContainText("Price $6.60 → $7.00");
  await reviewer.clock.runFor(700);
  await expect(reviewSheet("Bread")).toBeVisible();
  // ...and if it runs out during the pause.
  await breadNotice.getByRole("button", { name: "I've seen the new price", exact: true }).click();
  await reviewSheet("Bread").getByRole("button", { name: "Next item", exact: true }).click();
  await reviewSheet("Eggs").getByRole("button", { name: "Next item", exact: true }).click();
  await itemOption(reviewer, "1/2 · $2.50", "Syrup").click();
  await claimAs("bob-token", [[bread, 5, 6], [eggs, 2, 3], [syrup, 2, 3]]);
  await expect(reviewSheet("Syrup").locator(".claim-over-text")).toContainText("Only 1/3 left");
  await reviewer.clock.runFor(700);
  await expect(reviewSheet("Syrup")).toBeVisible();
  await reviewer.clock.resume();
  await itemOption(reviewer, "Even · 1/3 · $1.67", "Syrup").click();
  await expect(reviewSheet("Syrup")).toBeHidden();
  await expect(reviewer.locator(".claim-attention-chips")).toHaveCount(0);
  const reviewSaved = reviewer.waitForResponse((response) => response.request().method() === "POST" &&
    new URL(response.url()).pathname === `/api/bills/${reviewBill.id}/claims`);
  await reviewConfirm.click();
  const reviewSavedResponse = await reviewSaved;
  assert.equal(reviewSavedResponse.status(), 200);
  const afterReview = (await api(`/bills/${reviewBill.id}`)).bill;
  // The removed cheese is not sent back as reviewed; every current item is, at the version Carol saw.
  assert.deepEqual(reviewSavedResponse.request().postDataJSON().reviewedItems,
    afterReview.items.map(({ id, version }) => ({ itemId: id, version })));
  assert.deepEqual(afterReview.items.map((item) => item.claims
    .filter((claim) => claim.userId === memberIds.Carol).map((claim) => `${claim.numerator}/${claim.denominator}`)),
  [["1/4"], ["1/6"], ["1/3"], ["1/3"]]);
  // A change that ends where it started still needs review, and the row says so.
  await editReviewItems(reprice(eggs, 650));
  await expect(reviewRow("Eggs")).toContainText("Price $6.00 → $6.50");
  await editReviewItems(reprice(eggs, 600));
  await expect(reviewRow("Eggs")).toContainText("Item changed — review");
  await expect(reviewRow("Eggs")).not.toContainText("Price");
  await expect(reviewConfirm).toBeDisabled();
  await reviewer.getByRole("button", { name: "1 item changed — review", exact: true }).click();
  const sameNotice = reviewSheet("Eggs").locator(".claim-notice.is-review");
  await expect(sameNotice).toContainText("its name and price of $6.00 are what you saw before");
  await sameNotice.getByRole("button", { name: "I've seen the new price", exact: true }).click();
  await expect(reviewSheet("Syrup")).toBeVisible();
  await reviewSheet("Syrup").getByRole("button", { name: "Close claim", exact: true }).click();
  await expect(reviewRow("Eggs")).not.toContainText("Item changed");
  await expect(reviewConfirm).toBeEnabled();

  // Two other claimants get their own segments, tints and initials. A remainder that is not a
  // claimable fraction (both parts at most 10,000) is never offered as a one-tap fix.
  const twoItems = [["Jam", 600], ["Tiny slices", 600]].map(([name, cents]) => ({ id: randomUUID(), name, originalText: name.toUpperCase(), quantity: "1", amountCents: cents, discountCents: 0, taxable: false, finalCents: cents, manualFinal: false }));
  const [jam, tiny] = twoItems;
  const twoDraftId = randomUUID();
  const twoDraft = (await api(`/groups/${group.id}/receipt-drafts/${twoDraftId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Two claimants", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 1200, participantIds: [memberIds.Alice, memberIds.Bob, memberIds.Carol],
      receipt: { subtotalCents: 1200, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
      items: twoItems,
    },
  })).draft;
  const twoBill = (await api(`/receipt-drafts/${twoDraftId}/initialize`, "alice-token", "POST", { revision: twoDraft.revision })).bill;
  const claimTwo = async (token, claims) => api(`/bills/${twoBill.id}/claims`, token, "POST", {
    reviewedItems: (await api(`/bills/${twoBill.id}`)).bill.items.map(({ id, version }) => ({ itemId: id, version })),
    claims: claims.map(([item, numerator, denominator]) => ({ itemId: item.id, numerator, denominator })),
  });
  await claimTwo("bob-token", [[jam, 1, 3]]);
  await claimTwo("alice-token", [[jam, 1, 3]]);
  await reviewer.goto(`${base}#/bills/${twoBill.id}`);
  await reviewer.getByRole("button", { name: "View Jam · $6.00", exact: true }).click();
  const jamSegments = () => reviewSheet("Jam").locator(".claim-portion .claim-bar-segment").evaluateAll((segments) =>
    segments.map((segment) => ({ key: segment.dataset.segment, tint: getComputedStyle(segment).backgroundColor, label: segment.textContent })));
  await expect.poll(async () => (await jamSegments()).map(({ key }) => key).sort())
    .toEqual([memberIds.Alice, memberIds.Bob].sort());
  const [firstSegment, secondSegment] = await jamSegments();
  assert.notEqual(firstSegment.tint, secondSegment.tint, "each claimant has their own tint");
  assert.deepEqual(Object.fromEntries((await jamSegments()).map(({ key, label }) => [key, label])),
    { [memberIds.Alice]: "A", [memberIds.Bob]: "B" });
  await expect(reviewSheet("Jam").locator(".claim-legend")).toContainText("Alice · 1/3");
  await expect(reviewSheet("Jam").locator(".claim-legend")).toContainText("Bob · 1/3");
  await reviewSheet("Jam").getByRole("button", { name: "Next item", exact: true }).click();
  await itemOption(reviewer, "All of it · $6.00", "Tiny slices").click();
  await expect(reviewSheet("Tiny slices")).toBeHidden();
  await claimTwo("bob-token", [[jam, 1, 3], [tiny, 1, 101]]);
  await claimTwo("alice-token", [[jam, 1, 3], [tiny, 1, 103]]);
  // 1 − 1/101 − 1/103 = 10199/10403, whose denominator is past the claim limit.
  const tinyRow = reviewer.locator(".claim-list .receipt-compact-row").filter({ has: reviewer.getByRole("button", { name: /^View Tiny slices ·/ }) });
  await expect(tinyRow).toContainText("Over by 204/10403");
  await expect(reviewer.getByRole("button", { name: "View Tiny slices · $6.00", exact: true })).toHaveAccessibleDescription(/Over by 204\/10403/);
  await reviewer.getByRole("button", { name: "View Tiny slices · $6.00", exact: true }).click();
  await expect(reviewSheet("Tiny slices").locator(".claim-over-text"))
    .toHaveText("Only 10199/10403 left. Your 1/1 is over by 204/10403. Pick a smaller portion to confirm.");
  await expect(reviewSheet("Tiny slices").getByRole("button", { name: /^Take the/ })).toHaveCount(0);
  await expect(reviewSheet("Tiny slices").locator(".claim-sheet-footer")).toContainText("Resolve this item to unlock Confirm");
  await itemOption(reviewer, "1/2 · $3.00", "Tiny slices").click();
  await expect(reviewSheet("Tiny slices")).toBeHidden();
  await expect(reviewConfirm).toBeEnabled();
  // The review rules themselves, as the page loads them: a draft that is not a claimable fraction
  // blocks Confirm, and the reviewed list keeps acknowledged versions of current items only.
  const rules = await reviewer.evaluate(async () => {
    const { claimReview, reviewedFor } = await import("/src/features/bills/claims/claim-review.ts");
    const item = (id, version) => ({ id, version, name: id, finalCents: 100, claims: [] });
    const seen = [{ itemId: "kept", version: 1, name: "kept", finalCents: 100 }, { itemId: "gone", version: 1, name: "gone", finalCents: 100 }];
    const review = claimReview({ items: [item("kept", 1)], ownId: "me", selection: { kept: "10199/10403" }, seen, known: {}, conflicts: [] });
    return {
      invalid: review.attention.kept.invalid,
      blockers: review.blockers,
      reviewed: reviewedFor(seen, [item("kept", 2)]),
    };
  });
  assert.deepEqual(rules, {
    invalid: true,
    blockers: [{ kind: "item", itemId: "kept", review: false, over: false, invalid: true }],
    reviewed: [{ itemId: "kept", version: 1 }],
  });
}

// An initiated bill's claim sheet shows the item's receipt line and the zoomable photo.
async function claimReceiptPhoto(env) {
  const { api, base } = env;
  const { group, memberIds, alice } = await receiptGroup(env);
  const sharp = serverRequire("sharp");
  await alice.clock.install();
  // An initialized bill's claim sheet highlights the item's receipt line, as the draft editor does.
  {
    const draftId = randomUUID();
    const longImage = await sharp({
      create: { width: 300, height: 5000, channels: 3, background: "#f8f8f2" },
    }).png().toBuffer();
    const item = (name) => ({
      id: randomUUID(), name, originalText: `${name.toUpperCase()} RECEIPT LINE`,
      quantity: "1", amountCents: 1000, discountCents: 0, taxable: false,
      finalCents: 1000, manualFinal: false,
    });
    const data = {
      mode: "items", title: "Located claim lines", purchaseDate: "2026-09-24",
      timeZone: "America/Toronto", notes: "", totalCents: 3000,
      participantIds: [memberIds.Alice],
      receipt: { subtotalCents: 3000, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
      items: [item("Apples"), item("Milk"), item("Bread")],
    };
    const { draft: photoDraft } = await api(`/groups/${group.id}/receipt-drafts/${draftId}`, "alice-token", "PUT", {
      revision: 0, data, photoBase64: longImage.toString("base64"),
    });
    const { draft } = await api(`/groups/${group.id}/receipt-drafts/${draftId}`, "alice-token", "PUT", {
      revision: photoDraft.revision,
      data: { ...data,
        receipt: { ...data.receipt, evidence: { pages: [{ pageNumber: 1, width: 300, height: 5000, unit: "pixel" }], taxDetails: [{ rate: 0.13 }] } },
        items: [{ ...data.items[0], evidence: { regions: [{ pageNumber: 1, polygon: [30, 100, 180, 100, 180, 140, 30, 140] }], productCode: "1234567" } }, data.items[1],
          // A region outside the photo cannot be drawn.
          { ...data.items[2], evidence: { regions: [{ pageNumber: 1, polygon: [400, 100, 500, 100, 500, 140, 400, 140] }] } }],
      },
    });
    const located = (await api(`/receipt-drafts/${draftId}/initialize`, "alice-token", "POST", { revision: draft.revision })).bill;
    // Only the line position is published; the rest of the scan evidence stays with the draft.
    assert.deepEqual(located.items.map(i => i.receiptRegion), [{ pageNumber: 1, polygon: [30, 100, 180, 100, 180, 140, 30, 140] }, null, { pageNumber: 1, polygon: [400, 100, 500, 100, 500, 140, 400, 140] }]);
    assert.deepEqual(located.photo.pages, [{ pageNumber: 1, width: 300, height: 5000, unit: "pixel" }]);
    assert.equal(JSON.stringify(located).includes("1234567"), false);
    await alice.setViewportSize({ width: 390, height: 844 });
    const beforeBillUrl = alice.url();
    assert.notEqual(beforeBillUrl, `${base}#/bills/${located.id}`);
    await alice.goto(`${base}#/bills/${located.id}`);
    await alice.getByRole("button", { name: "View Apples · $10.00", exact: true }).click();
    const sheet = claimSheet(alice);
    await expect(sheet.getByRole("img", { name: "Highlighted receipt line", exact: true })).toHaveAttribute("points", "30,100 180,100 180,140 30,140");
    // The mobile sheet shows the counter and Previous and Next too. Next keeps its 32px circle,
    // and a tap just outside the circle still reaches it.
    await expect(sheet).toContainText("CLAIM AN ITEM · 1 OF 3");
    const mobileNext = sheet.getByRole("button", { name: "Next item", exact: true });
    await expect(mobileNext).toBeVisible();
    const nextBox = await mobileNext.boundingBox();
    assert.equal(Math.round(nextBox.width), 32);
    assert.equal(await alice.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"),
      { x: nextBox.x - 4, y: nextBox.y + nextBox.height / 2 }), "Next item");
    await expect(sheet.getByRole("button", { name: "View receipt photo", exact: true })).toHaveCount(0);
    const lineButton = sheet.getByRole("button", { name: /View whole receipt/ });
    await expect(lineButton).toBeVisible();
    // The zoom hint is an unlabeled icon in the crop's bottom-right corner.
    const [hint, crop] = await Promise.all([lineButton.locator(".receipt-zoom-hint").boundingBox(), lineButton.boundingBox()]);
    assert.ok(crop.x + crop.width - (hint.x + hint.width) < 16 && crop.y + crop.height - (hint.y + hint.height) < 16, "Zoom hint sits in the bottom-right corner");
    assert.equal((await lineButton.textContent()).trim(), "");
    const selectedFraction = itemOption(alice, "1/2 · $5.00");
    await selectedFraction.click();
    // Auto-advance also works on the mobile sheet, where the arrow keys still step back.
    await expect(claimSheet(alice, "Milk")).toBeVisible();
    await alice.keyboard.press("ArrowLeft");
    await expect(selectedFraction).toHaveAttribute("aria-pressed", "true");
    const selectedShare = alice.locator(".claim-sticky-footer");
    await expect(selectedShare).toContainText("Your share $5.00");
    // Touching the photo right after picking cancels the pending advance. Both happen in one task,
    // so the advance cannot fire between them however slow the machine is.
    await alice.clock.pauseAt(await alice.evaluate(() => Date.now() + 1000));
    await sheet.evaluate((dialog) => {
      dialog.querySelector('[aria-label="1/2 · $5.00"]').click();
      dialog.querySelector('[aria-label="View whole receipt"]')
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    await alice.clock.runFor(700);
    await expect(sheet).toContainText("CLAIM AN ITEM · 1 OF 3");
    await alice.clock.resume();
    await lineButton.click();
    const viewer = alice.getByRole("dialog", { name: /Receipt photo.*Apples/ });
    await expect(viewer).toBeVisible();
    const highlight = viewer.getByRole("img", { name: "Highlighted receipt line", exact: true });
    await expect(highlight).toBeVisible();
    await expect(highlight).toHaveAttribute("points", "30,100 180,100 180,140 30,140");
    const viewerPhoto = viewer.getByRole("img", { name: "Full-size original receipt" });
    const viewerViewport = viewer.locator(".receipt-photo-viewport");
    const fittedPhotoBox = await viewerPhoto.boundingBox();
    assert.ok(fittedPhotoBox, "Fitted receipt has a rendered size");
    const naturalResolutionZoom = (300 / fittedPhotoBox.width) * 100;
    const expectPhotoFitted = async () => {
      const photoBox = await viewerPhoto.boundingBox();
      const viewportBox = await viewerViewport.boundingBox();
      assert.ok(photoBox && viewportBox, "Viewer photo and viewport have rendered bounds");
      assert.ok(photoBox.x >= viewportBox.x - 2 && photoBox.y >= viewportBox.y - 2,
        "Fitted receipt starts within the viewer viewport");
      assert.ok(photoBox.x + photoBox.width <= viewportBox.x + viewportBox.width + 2,
        "Fitted receipt width stays within the viewer viewport");
      assert.ok(photoBox.y + photoBox.height <= viewportBox.y + viewportBox.height + 2,
        "Fitted receipt height stays within the viewer viewport");
      assert.ok(Math.abs(photoBox.x + photoBox.width / 2 - viewportBox.x - viewportBox.width / 2) <= 2
        && Math.abs(photoBox.y + photoBox.height / 2 - viewportBox.y - viewportBox.height / 2) <= 2,
        "Fitted receipt is centered in the viewer viewport");
      assert.ok(Math.abs(photoBox.width - viewportBox.width) <= 2 || Math.abs(photoBox.height - viewportBox.height) <= 2,
        "Fitted receipt fills one viewport dimension");
    };
    await expectPhotoFitted();
    const zoomReadout = viewer.getByLabel("Photo zoom", { exact: true });
    const zoomLevel = async () => parseFloat(await zoomReadout.textContent());
    await expect(zoomReadout).toHaveText("100%");
    await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(zoomReadout).toHaveText("150%");
    await viewer.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect.poll(zoomLevel).toBe(100);
    await viewer.getByRole("button", { name: /Fit/ }).click();
    await expect(zoomReadout).toHaveText("100%");
    await expectPhotoFitted();
    const fittedViewport = await viewerViewport.boundingBox();
    const fittedImage = await viewerPhoto.boundingBox();
    assert.ok(fittedImage.x - fittedViewport.x > 8, "Tall receipt leaves an empty margin beside the photo");
    await alice.mouse.click((fittedViewport.x + fittedImage.x) / 2, fittedViewport.y + fittedViewport.height / 2);
    await expect(viewer).toBeVisible();
    const beforeDoubleClick = await zoomLevel();
    await viewerPhoto.dblclick();
    await expect.poll(zoomLevel).toBeGreaterThan(beforeDoubleClick + 95);
    const afterFirstDoubleClick = await zoomLevel();
    await viewerPhoto.dblclick();
    await expect.poll(zoomLevel).toBeGreaterThan(afterFirstDoubleClick + 95);
    await viewer.getByRole("button", { name: /Fit/ }).click();
    await expect(zoomReadout).toHaveText("100%");
    await viewerViewport.hover();
    await alice.mouse.wheel(0, -300);
    await expect.poll(zoomLevel).toBeGreaterThan(100);
    await viewer.getByRole("button", { name: /Fit/ }).click();
    await expect(zoomReadout).toHaveText("100%");
    const zoomIn = viewer.getByRole("button", { name: "Zoom in", exact: true });
    const maxZoom = Math.max(400, 2 * naturalResolutionZoom);
    let buttonClicks = 0;
    for (; buttonClicks < 50; buttonClicks++) {
      if (await zoomIn.isDisabled()) break;
      await zoomIn.click();
      await expect(zoomReadout).toHaveText(`${Math.round(Math.min(100 + (buttonClicks + 1) * 50, maxZoom))}%`);
    }
    assert.ok(buttonClicks > 1, "Zoom limit exercises multiple button clicks");
    assert.ok(await zoomIn.isDisabled(), "Zoom in stops at the maximum");
    assert.ok(await zoomLevel() > 400, "Long receipt can zoom beyond the former 400% cap");
    assert.ok(await zoomLevel() >= naturalResolutionZoom - 1,
      "Long receipt can reach at least its natural pixel resolution");
    assert.ok((await viewerPhoto.boundingBox()).width >= 300 - 1,
      "Long receipt renders at least 300 pixels wide at natural resolution");
    const stroke = await highlight.evaluate((polygon) => parseFloat(getComputedStyle(polygon).strokeWidth));
    assert.ok(Math.abs(stroke * await zoomLevel() / 100 - 2) < 0.2,
      "Highlighted line keeps a thin outline at high zoom");
    await viewer.getByRole("button", { name: /Fit/ }).click();
    await expect(zoomReadout).toHaveText("100%");
    const panArea = viewer.getByRole("group", { name: "Receipt photo. Arrow keys pan; plus and minus zoom." });
    await panArea.focus();
    await expect(panArea).toBeFocused();
    await alice.keyboard.press("+");
    await expect(zoomReadout).toHaveText("125%");
    const beforePanY = (await viewerPhoto.boundingBox()).y;
    await alice.keyboard.press("ArrowDown");
    await expect.poll(async () => (await viewerPhoto.boundingBox()).y).toBeLessThan(beforePanY - 1);
    await alice.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(sheet).toBeVisible();
    await expect(selectedFraction).toHaveAttribute("aria-pressed", "true");
    await expect(selectedShare).toContainText("Your share $5.00");
    await expect(lineButton).toBeFocused();
    await lineButton.click();
    await expect(viewer).toBeVisible();
    // Reopen before the closed viewer's history entry is retired; the new viewer must reuse it.
    await viewer.getByRole("button", { name: "Close photo", exact: true }).click();
    await lineButton.click();
    await expect(viewer).toBeVisible();
    await alice.goBack();
    await expect(viewer).toHaveCount(0);
    await expect(alice).toHaveURL(`${base}#/bills/${located.id}`);
    await expect(sheet).toBeVisible();
    await expect(selectedFraction).toHaveAttribute("aria-pressed", "true");
    await alice.getByRole("button", { name: "Close claim", exact: true }).click();
    // The viewer left no history entries behind: the next back leaves the bill as before.
    await alice.goBack();
    await expect(alice).toHaveURL(beforeBillUrl);
    await alice.goto(`${base}#/bills/${located.id}`);
    // Without a located line, the sheet keeps the whole photo.
    await alice.getByRole("button", { name: "View Milk · $10.00", exact: true }).click();
    const milkSheet = claimSheet(alice, "Milk");
    const fallbackPhoto = milkSheet.getByRole("button", { name: "View receipt photo", exact: true });
    await expect(fallbackPhoto).toBeVisible();
    await expect(claimSheet(alice, "Milk").getByRole("img", { name: "Highlighted receipt line", exact: true })).toHaveCount(0);
    await fallbackPhoto.click();
    const fallbackViewer = alice.getByRole("dialog", { name: "Receipt photo · Milk", exact: true });
    await expect(fallbackViewer).toBeVisible();
    await expect(fallbackViewer.getByRole("img", { name: "Highlighted receipt line", exact: true })).toHaveCount(0);
    await alice.getByRole("button", { name: "Close photo", exact: true }).click();
    await expect(fallbackViewer).toHaveCount(0);
    await alice.getByRole("button", { name: "Close claim", exact: true }).click();
    // Nor when its line cannot be drawn on the photo.
    await alice.getByRole("button", { name: "View Bread · $10.00", exact: true }).click();
    await expect(claimSheet(alice, "Bread").getByRole("button", { name: "View receipt photo", exact: true })).toBeVisible();
    await expect(claimSheet(alice, "Bread").getByRole("img", { name: "Highlighted receipt line", exact: true })).toHaveCount(0);
    await claimSheet(alice, "Bread").getByRole("button", { name: "View receipt photo", exact: true }).click();
    const undrawableViewer = alice.getByRole("dialog", { name: "Receipt photo · Bread", exact: true });
    await expect(undrawableViewer).toBeVisible();
    await expect(undrawableViewer.getByRole("img", { name: "Highlighted receipt line", exact: true })).toHaveCount(0);
    await alice.getByRole("button", { name: "Close photo", exact: true }).click();
    await expect(undrawableViewer).toHaveCount(0);
    await alice.getByRole("button", { name: "Close claim", exact: true }).click();
  }
}
