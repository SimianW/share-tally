// Receipt scenarios: drafts. Each starts from its own group and records.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { receiptEnvironment, receiptGroup, receiptPhoto, reconciliationButton } from './fixtures.mjs';
import { splitByAmount } from '../ui.mjs';

export const scenarios = [
  { name: 'draft-save-and-recovery', environment: receiptEnvironment, run: draftSaveAndRecovery },
  { name: 'scanned-draft-editing', environment: receiptEnvironment, run: scannedDraftEditing },
  { name: 'compact-review', environment: receiptEnvironment, run: compactReview },
];

// Explicit saving, local recovery, discarding, overwriting and deleting drafts.
async function draftSaveAndRecovery(env) {
  const { api } = env;
  const { group, memberIds, groupRoute, newBillRoute, alice, stepButton, expectNewBillRoute } = await receiptGroup(env);
  // Pre-migration browser recovery must preserve an explicitly reduced item tax.
  const reducedTaxId = randomUUID();
  const reducedTaxDraft = (await api(`/groups/${group.id}/receipt-drafts/${reducedTaxId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Reduced tax recovery", purchaseDate: "2026-09-24",
      timeZone: "America/Toronto", notes: "", totalCents: 1000,
      participantIds: [],
      receipt: { subtotalCents: 1000, discountCents: 0, taxCents: 100, extraCents: 0, pricesIncludeTax: false },
      items: [{ id: randomUUID(), name: "Reduced tax", originalText: "", quantity: "1",
        amountCents: 1000, discountCents: 0, taxable: true, finalCents: 1100, manualFinal: false }],
    },
  })).draft;
  await alice.goto(`${newBillRoute}/${reducedTaxId}`);
  await expect(alice.getByRole("button", { name: "Edit Reduced tax", exact: true })).toBeVisible();
  await alice.evaluate(({ id, draft }) => {
    const key = Object.keys(sessionStorage).find(entry => entry.startsWith("receipt-draft:") && entry.endsWith(`:${id}`));
    if (!key) throw new Error("Missing browser draft recovery entry");
    draft.data.items[0] = { ...draft.data.items[0], taxCents: 0, allocatedTaxCents: 100, extraCents: 0, finalCents: 1000 };
    sessionStorage.setItem(key, JSON.stringify(draft));
  }, { id: reducedTaxId, draft: reducedTaxDraft });
  await alice.reload();
  await expect(alice.getByRole("button", { name: "Edit Reduced tax", exact: true })).toContainText("10.00");
  await expect(alice.getByRole("button", { name: "Edit Reduced tax", exact: true })).toContainText("Manual");
  await alice.getByRole("button", { name: "Save draft & close", exact: true }).click();
  await expect(alice).toHaveURL(groupRoute);
  const recoveredReducedTax = (await api(`/receipt-drafts/${reducedTaxId}`)).draft;
  assert.equal(recoveredReducedTax.data.items[0].finalCents, 1000);
  assert.equal(recoveredReducedTax.data.items[0].manualFinal, true);
  await alice.getByRole("button", { name: "Delete Reduced tax recovery", exact: true }).click();
  await alice.getByRole("button", { name: "Delete draft", exact: true }).click();
  await expect(alice.locator(".draft-list-row")).toHaveCount(0);
  // Explicit save, edit/discard, overwrite and delete on the production list.
  await alice.getByRole("button", { name: "New bill", exact: true }).click();
  await splitByAmount(alice, "10.00");
  await expect(alice.getByRole("heading", { name: "Who’s sharing this bill?" })).toBeVisible();
  // With no items, By item is disabled and the arrow keys cannot reach it.
  const emptySplit = alice.getByRole("radiogroup", { name: "Split" });
  await expect(emptySplit.getByRole("radio", { name: "By item" })).toBeDisabled();
  await emptySplit.getByRole("radio", { name: "By amount" }).focus();
  await alice.keyboard.press("ArrowLeft");
  await expect(emptySplit.getByRole("radio", { name: "By amount" })).toBeChecked();
  await alice.reload();
  await expectNewBillRoute();
  await expect(alice.getByRole("heading", { name: "Who’s sharing this bill?" })).toBeVisible();
  await alice.getByLabel("Bill title", { exact: true }).fill("Draft lifecycle");
  await alice.getByRole("button", { name: "Save draft & close" }).click();
  const lifecycleRow = () => alice.locator(".draft-list-row").filter({ hasText: "Draft lifecycle" });
  await lifecycleRow().getByRole("button", { name: "Continue", exact: true }).click();
  const lifecycleId = (await api(`/groups/${group.id}/receipt-drafts`)).drafts[0].id;
  await expectNewBillRoute(lifecycleId);
  // A navigation while the server draft is loading must preserve local recovery.
  for (const exit of ["browser", "page"]) {
    await alice.getByLabel("Bill title", { exact: true }).fill(`Recover after ${exit} back`);
    const key = await alice.evaluate((draftId) => Object.keys(sessionStorage)
      .find(entry => entry.startsWith("receipt-draft:") && entry.endsWith(`:${draftId}`)), lifecycleId);
    assert.ok(key, "Draft recovery entry should exist");
    await expect.poll(() => alice.evaluate((storedKey) =>
      JSON.parse(sessionStorage.getItem(storedKey) ?? "null")?.data.title, key))
      .toBe(`Recover after ${exit} back`);
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const draftRequest = `**/api/receipt-drafts/${lifecycleId}`;
    await alice.route(draftRequest, async route => {
      await held;
      await route.continue().catch(() => {}); // Leaving can cancel the in-flight read.
    });
    await alice.reload();
    await expect(alice.getByText("Opening draft…", { exact: true })).toBeVisible();
    if (exit === "browser") await alice.goBack();
    else await alice.getByRole("button", { name: "Back to group" }).click();
    await expect(alice).toHaveURL(groupRoute);
    assert.equal(await alice.evaluate((storedKey) =>
      JSON.parse(sessionStorage.getItem(storedKey) ?? "null")?.data.title, key),
    `Recover after ${exit} back`);
    release();
    await alice.unroute(draftRequest);
    await lifecycleRow().getByRole("button", { name: "Continue", exact: true }).click();
    await expect(alice.getByText("Recovered your unsaved changes.", { exact: true })).toBeVisible();
    await expect(alice.getByLabel("Bill title", { exact: true })).toHaveValue(`Recover after ${exit} back`);
  }
  await alice.getByLabel("Bill title", { exact: true }).fill("Discard me");
  await alice.goBack();
  await expect(alice.getByRole("heading", { name: "Discard unsaved changes?" })).toBeVisible();
  await alice.getByRole("button", { name: "Keep editing" }).click();
  await expectNewBillRoute(lifecycleId);
  await expect(alice.getByLabel("Bill title", { exact: true })).toHaveValue("Discard me");
  await alice.getByRole("button", { name: "Back to group" }).click();
  await alice.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(alice).toHaveURL(groupRoute);
  await lifecycleRow().getByRole("button", { name: "Continue", exact: true }).click();
  await expect(alice.getByLabel("Bill title", { exact: true })).toHaveValue("Draft lifecycle");
  await alice.getByLabel("Bill title", { exact: true }).fill("Draft lifecycle updated");
  await alice.getByRole("button", { name: "Save draft & close" }).click();
  assert.equal((await api(`/groups/${group.id}/receipt-drafts`)).drafts.length, 1);
  await alice.setViewportSize({ width: 390, height: 844 });
  assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const compactAction = lifecycleRow().getByRole("button", { name: "Continue", exact: true });
  await expect(compactAction).toHaveCSS("min-height", "32px");
  await expect(compactAction).toHaveCSS("font-size", "13px");
  await expect(compactAction).toHaveCSS("font-weight", "600");
  await mkdir("/tmp/share-tally-receipt-smoke", { recursive: true });
  await alice.screenshot({ path: "/tmp/share-tally-receipt-smoke/draft-list-a-mobile.png", fullPage: true });
  await alice.getByRole("button", { name: "Delete Draft lifecycle updated", exact: true }).click();
  await alice.getByRole("button", { name: "Keep draft", exact: true }).click();
  await expect(lifecycleRow()).toBeVisible();
  await alice.getByRole("button", { name: "Delete Draft lifecycle updated", exact: true }).click();
  await alice.getByRole("button", { name: "Delete draft", exact: true }).click();
  await expect(alice.locator(".draft-list-row")).toHaveCount(0);
  assert.equal((await api(`/groups/${group.id}/receipt-drafts`)).drafts.length, 0);
  // Reloading the saved draft after a conflict re-checks the step: a price removed
  // elsewhere sends the initiator from People back to Items.
  {
    const draftId = randomUUID();
    const pears = {
      id: randomUUID(), name: "Pears", originalText: "PEARS RECEIPT LINE", quantity: "1",
      amountCents: 400, discountCents: 0, taxable: false, finalCents: 400, manualFinal: false,
    };
    const data = (items) => ({
      mode: "items", title: "Reload check", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 400, participantIds: [memberIds.Alice], items,
      receipt: { subtotalCents: 400, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
    });
    const opened = (await api(`/groups/${group.id}/receipt-drafts/${draftId}`, "alice-token", "PUT", { revision: 0, data: data([pears]) })).draft;
    await alice.setViewportSize({ width: 1280, height: 1000 });
    await alice.goto(`${newBillRoute}/${draftId}`);
    await stepButton("People").click();
    await expect(alice.getByRole("heading", { name: "Who’s sharing this bill?" })).toBeVisible();
    const changed = (await api(`/groups/${group.id}/receipt-drafts/${draftId}`, "alice-token", "PUT", {
      revision: opened.revision, data: data([{ ...pears, amountCents: null, finalCents: null }]),
    })).draft;
    await alice.getByLabel("Bill title", { exact: true }).fill("Reload check edited");
    await alice.getByRole("button", { name: "Save draft & close" }).click();
    await alice.getByRole("button", { name: "Reload saved draft, discarding local edits" }).click();
    await expect(alice.getByRole("heading", { name: "Check your items" })).toBeVisible();
    await expect(stepButton("People")).toBeDisabled();
    await expect(alice.getByText("Give every item a name and a price to continue.", { exact: true })).toBeVisible();
    await api(`/receipt-drafts/${draftId}`, "alice-token", "DELETE", { revision: changed.revision });
  }
}

// Editing, recovering and sharing a scanned draft on short and narrow screens.
async function scannedDraftEditing(env) {
  const { api } = env;
  const { group, groupRoute, newBillRoute, alice, stepButton, expectNewBillRoute, titledDraft } = await receiptGroup(env);
  const image = await receiptPhoto(300, 500);
  // A scanned, ready draft, as the processing scenario leaves one.
  const scanned = await titledDraft("Scanned receipt");
  await alice.goto(`${newBillRoute}/${scanned}`);
  await alice.getByLabel("Choose a receipt image").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: image });
  await alice.getByRole("button", { name: "Use this photo", exact: true }).click();
  await expect(alice.getByRole("heading", { name: "Check your items" })).toBeVisible();
  await expect.poll(async () => (await api(`/receipt-drafts/${scanned}`)).draft.processingStatus).toBe("ready");
  await expect(alice.getByRole("button", { name: "Edit Friendly item 1", exact: true })).toBeEnabled();
  await alice.getByRole("button", { name: "Back to group" }).click();
  await expect(alice).toHaveURL(groupRoute);
  const savedScan = { id: scanned };
  const applesRow = () => alice.getByRole("button", { name: "Edit Apples", exact: true });
  await alice.locator(".draft-list-row").filter({ hasText: "Scanned receipt" }).getByRole("button", { name: "Continue", exact: true }).click();
  await stepButton("Items").click();
  await alice.getByRole("button", { name: "Edit Friendly item 1", exact: true }).click();
  await alice.getByLabel("Item name", { exact: true }).fill("Apples");
  await alice.getByRole("checkbox", { name: "Taxable", exact: true }).uncheck();
  await alice.getByRole("button", { name: "Set final manually", exact: true }).click();
  await alice.getByLabel("Final cost · CAD", { exact: true }).fill("2.80");
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await alice.getByRole("button", { name: "Save draft & close" }).click();
  await alice.locator(".draft-list-row").filter({ hasText: "Scanned receipt" }).getByRole("button", { name: "Continue", exact: true }).click();
  await stepButton("Items").click();
  await alice.reload();
  await expectNewBillRoute(savedScan.id);
  await expect(alice.getByRole("heading", { name: "Check your items" })).toBeVisible();
  // On a short phone screen the action must remain reachable without scrolling to the end.
  await alice.setViewportSize({ width: 390, height: 560 });
  const expectWizardActionInViewport = async (step, heading) => {
    await stepButton(step).click();
    await expect(alice.getByRole("heading", { name: heading })).toBeVisible();
    assert.ok(await alice.evaluate(() => document.documentElement.scrollHeight > innerHeight), `${step} step must overflow the viewport`);
    await alice.evaluate(() => window.scrollTo(0, 0));
    await expect(alice.getByRole("button", { name: "Save draft & close" })).toBeInViewport();
  };
  await expectWizardActionInViewport("Items", "Check your items");
  await expectWizardActionInViewport("Receipt", "How do you want to split it?");
  await expectWizardActionInViewport("People", "Who’s sharing this bill?");
  await stepButton("Items").click();
  await alice.setViewportSize({ width: 1280, height: 1000 });
  await applesRow().click();
  await expect(alice.getByLabel("Final cost · CAD", { exact: true })).toHaveValue("2.80");
  await expect(alice.getByRole("checkbox", { name: "Taxable", exact: true })).not.toBeChecked();
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await alice.getByRole("button", { name: "Continue to sharing" }).click();
  await alice
    .getByLabel("Bill title", { exact: true })
    .fill("Recovered local title");
  await alice.reload();
  await expectNewBillRoute(savedScan.id);
  await expect(alice.getByRole("heading", { name: "Who’s sharing this bill?" })).toBeVisible();
  await expect(
    alice.getByText("Recovered your unsaved changes.", { exact: true }),
  ).toBeVisible();
  await expect(alice.getByLabel("Bill title", { exact: true })).toHaveValue(
    "Recovered local title",
  );
  await alice.getByLabel("Bill title", { exact: true }).fill("Scanned receipt");
  await alice.getByRole("button", { name: "Back", exact: true }).click();
  await expect(alice.getByAltText("Original cropped receipt")).toBeVisible();
  await alice.screenshot({
    path: "/tmp/share-tally-receipt-smoke/receipt-editor.png",
    fullPage: true,
  });
  await alice.setViewportSize({ width: 320, height: 640 });
  await expectNewBillRoute(savedScan.id);
  await applesRow().click();
  await alice.locator(".receipt-original-text p").evaluate((el) => {
    el.textContent = "LONG_RECEIPT_PRODUCT_CODE_".repeat(20);
  });
  const dimensions = await alice.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  assert.ok(
    dimensions.scroll <= dimensions.client && dimensions.client <= dimensions.viewport,
    JSON.stringify(dimensions),
  );
  await alice.evaluate(() => window.scrollTo({ left: 100, top: 100 }));
  assert.equal(await alice.evaluate(() => window.scrollX), 0);
  const mobileInputFontSize = await alice
    .getByLabel("Final cost · CAD", { exact: true })
    .evaluate((input) => getComputedStyle(input).fontSize);
  assert.ok(parseFloat(mobileInputFontSize) >= 16, mobileInputFontSize);

  await alice.setViewportSize({ width: 390, height: 844 });
  await expect(alice).toHaveURL(`${newBillRoute}/${savedScan.id}`);
  assert.equal(
    await alice.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await alice.screenshot({
    path: "/tmp/share-tally-receipt-smoke/mobile-editor.png",
    fullPage: true,
  });
  await alice.setViewportSize({ width: 1280, height: 1000 });
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await alice.getByRole("button", { name: "Continue to sharing" }).click();
  let lost = false;
  await alice.route("**/receipt-drafts/*/initialize", async (route) => {
    if (lost) return route.continue();
    lost = true;
    // route.fetch runs in Node, outside Chromium's test-host DNS mapping.
    const upstream = new URL(route.request().url());
    upstream.hostname = "127.0.0.1";
    await route.fetch({ url: upstream.href });
    await route.abort("failed");
  });
  await alice
    .getByRole("button", { name: "Share bill", exact: true })
    .click();
  await alice
    .getByRole("button", { name: "Retry sharing", exact: true })
    .click();
  await expect(
    alice.getByRole("heading", { name: "Items & claims" }),
  ).toBeVisible();
  assert.equal(
    (await api(`/groups/${group.id}/bills`)).bills.filter(
      (b) => b.title === "Scanned receipt",
    ).length,
    1,
  );
}

// Reviewing scanned items, the receipt photo and the receipt summary at desktop and mobile widths.
async function compactReview(env) {
  const { api } = env;
  const { group, groupRoute, newBillRoute, alice, stepButton } = await receiptGroup(env);
  const image = await receiptPhoto(300, 500);
  const reconciliation = () => reconciliationButton(alice);
  // Exercise the same compact review contract at desktop and mobile widths.
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    const draftId = randomUUID();
    const item = (name, amountCents, taxable) => ({
      id: randomUUID(), name, originalText: `${name.toUpperCase()} RECEIPT LINE`,
      quantity: "1", amountCents, discountCents: 0, taxable,
      finalCents: amountCents, manualFinal: false,
    });
    const data = {
      mode: "items", title: `Compact review ${viewport.width}`, purchaseDate: "2026-09-24",
      timeZone: "America/Toronto", notes: "", totalCents: 3000,
      participantIds: [],
      receipt: { subtotalCents: 3000, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
      items: [item("Apples", 1000, true), item("Milk", 2000, false)],
    };
    const { draft: photoDraft } = await api(`/groups/${group.id}/receipt-drafts/${draftId}`, "alice-token", "PUT", {
      revision: 0, data, photoBase64: image.toString("base64"),
    });
    // Simulate scan evidence from the stored photo; an unscanned upload has no regions.
    await api(`/groups/${group.id}/receipt-drafts/${draftId}`, "alice-token", "PUT", {
      revision: photoDraft.revision,
      data: { ...data,
        receipt: { ...data.receipt, evidence: { pages: [{ pageNumber: 1, width: 300, height: 500, unit: "pixel" }] } },
        items: [{ ...data.items[0], evidence: { regions: [{ pageNumber: 1, polygon: [30, 100, 180, 100, 180, 140, 30, 140] }] } }, data.items[1]],
      },
    });
    await alice.route(`**/api/receipt-drafts/${draftId}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const upstream = new URL(route.request().url());
      upstream.hostname = "127.0.0.1";
      const response = await route.fetch({ url: upstream.href });
      const body = await response.json();
      body.draft.data.receipt.taxLabel = "HST (13%)";
      await route.fulfill({ response, body: JSON.stringify(body) });
    });
    await alice.setViewportSize(viewport);
    await alice.goto(`${newBillRoute}/${draftId}`);
    await stepButton("Items").click();
    const row = name => alice.getByRole("button", { name: `Edit ${name}`, exact: true, includeHidden: true });
    await expect(row("Apples")).toContainText("10.00");
    await expect(reconciliation()).toContainText("Matches receipt");
    await reconciliation().click();
    await expect(alice.getByText("HST (13%)", { exact: true })).toBeVisible();
    await alice.getByRole("button", { name: "Close summary", exact: true }).click();
    await reconciliation().scrollIntoViewIfNeeded();
    if (viewport.width <= 640) {
      // The top bar replaced the mobile bottom navigation; nothing may cover the sticky actions.
      await expect(alice.locator(".main-nav")).toHaveCount(0);
      const footerBox = await alice.locator(".receipt-review-footer").boundingBox();
      assert.ok(footerBox.y + footerBox.height <= viewport.height + 1, "Sticky review actions stay within the viewport");
    }
    await alice.getByRole("button", { name: "View receipt photo", exact: true }).click();
    const photoDialog = alice.getByRole("dialog", { name: "Receipt photo", exact: true });
    await expect(photoDialog).toBeVisible();
    const photo = photoDialog.getByRole("img");
    const photoViewport = photoDialog.locator(".receipt-photo-viewport");
    const assertPhotoFitted = async () => {
      const photoBox = await photo.boundingBox();
      const viewportBox = await photoViewport.boundingBox();
      assert.ok(photoBox && viewportBox, "Review photo has rendered bounds");
      assert.ok(photoBox.x >= viewportBox.x - 2 && photoBox.y >= viewportBox.y - 2
        && photoBox.x + photoBox.width <= viewportBox.x + viewportBox.width + 2
        && photoBox.y + photoBox.height <= viewportBox.y + viewportBox.height + 2,
      "Review photo fits within the viewer viewport");
      assert.ok(Math.abs(photoBox.x + photoBox.width / 2 - viewportBox.x - viewportBox.width / 2) <= 2
        && Math.abs(photoBox.y + photoBox.height / 2 - viewportBox.y - viewportBox.height / 2) <= 2,
      "Review photo is centered in the viewport");
      assert.ok(Math.abs(photoBox.width - viewportBox.width) <= 2 || Math.abs(photoBox.height - viewportBox.height) <= 2,
        "Review photo fills one viewport dimension");
    };
    await assertPhotoFitted();
    const initialPhotoWidth = (await photo.boundingBox()).width;
    await alice.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect.poll(async () => (await photo.boundingBox()).width).toBeGreaterThan(initialPhotoWidth);
    await alice.getByRole("button", { name: /Fit/ }).click();
    await assertPhotoFitted();
    await alice.getByRole("button", { name: "Close photo", exact: true }).click();
    await expect(photoDialog).toHaveCount(0);
    await row("Apples").click();
    const editor = alice.getByRole("dialog", { name: "Edit receipt item", exact: true });
    await expect(editor).toBeVisible();
    // Opening an item lets the user read it first: focus lands on the heading, not a field.
    const editorHeading = editor.getByRole("heading", { name: "Edit receipt item", exact: true });
    await expect(editorHeading).toBeFocused();
    await expect(editor).toContainText("APPLES RECEIPT LINE");
    await expect(editor.getByRole("img", { name: "Receipt line", exact: true })).toBeVisible();
    await expect(editor.getByRole("img", { name: "Highlighted receipt line", exact: true })).toBeVisible();
    const crop = editor.getByRole("img", { name: "Receipt line", exact: true });
    const [x, y, width, height] = (await crop.getAttribute("viewBox")).split(" ").map(Number);
    assert.equal(x, 0);
    assert.ok(y > 0 && width === 300 && height < 500, "Editor shows a line crop, not the entire photo");
    assert.equal(await editor.getByRole("img", { name: "Highlighted receipt line", exact: true }).getAttribute("points"), "30,100 180,100 180,140 30,140");
    const editorCropButton = editor.getByRole("button", { name: /View whole receipt/ });
    await expect(editorCropButton).toBeVisible();
    const zoomIcon = await editorCropButton.locator(".receipt-zoom-hint svg").boundingBox();
    assert.ok(zoomIcon && zoomIcon.width <= 24 && zoomIcon.height <= 24, "Zoom badge icon keeps its icon size inside the line crop");
    await editorCropButton.click();
    const editorPhotoDialog = alice.getByRole("dialog", { name: /Receipt photo.*Apples/ });
    await expect(editorPhotoDialog).toBeVisible();
    await expect(editorPhotoDialog.getByRole("img", { name: "Highlighted receipt line", exact: true })).toBeVisible();
    await alice.getByRole("button", { name: "Close photo", exact: true }).click();
    await expect(editorPhotoDialog).toHaveCount(0);
    await expect(editor).toBeVisible();
    const editorBox = await editor.boundingBox();
    if (viewport.width < 700) {
      assert.ok(Math.abs(editorBox.x) < 2, "Mobile editor spans the viewport");
      assert.ok(Math.abs(editorBox.y + editorBox.height - viewport.height) < 3, "Mobile editor is a bottom sheet");
    } else {
      assert.ok(editorBox.x > viewport.width / 2, "Desktop editor is a side panel");
    }
    await alice.getByLabel("Item name", { exact: true }).fill("Reviewed apples");
    await alice.getByLabel("Quantity", { exact: true }).fill("2");
    await alice.getByLabel("Printed price", { exact: true }).fill("12.00");
    await alice.getByLabel("Item discount", { exact: true }).fill("2.00");
    await expect(row("Reviewed apples")).toContainText("×2");
    await expect(row("Reviewed apples")).toContainText("10.00");
    // Moving to another item starts it from the top, like opening it.
    const scrolled = await editor.evaluate(dialog => { dialog.scrollTop = dialog.scrollHeight; return dialog.scrollTop; });
    if (viewport.width < 700) assert.ok(scrolled > 0, "Mobile editor overflows before moving to the next item");
    await alice.getByRole("button", { name: "Next item", exact: true }).click();
    await expect(alice.getByLabel("Item name", { exact: true })).toHaveValue("Milk");
    await expect(editorHeading).toBeFocused();
    assert.equal(await editor.evaluate(dialog => dialog.scrollTop), 0, "Next item starts at the top of the sheet");
    await alice.getByRole("button", { name: "Previous item", exact: true }).click();
    await expect(alice.getByLabel("Item name", { exact: true })).toHaveValue("Reviewed apples");
    await expect(editorHeading).toBeFocused();
    // Back closes only the viewer; the draft's navigation guard never sees it.
    const draftUrl = alice.url();
    await editorCropButton.click();
    const editedPhotoDialog = alice.getByRole("dialog", { name: /Receipt photo.*Reviewed apples/ });
    await expect(editedPhotoDialog).toBeVisible();
    await alice.goBack();
    await expect(editedPhotoDialog).toHaveCount(0);
    await expect(alice).toHaveURL(draftUrl);
    await expect(editor).toBeVisible();
    await expect(alice.getByRole("dialog", { name: /Discard/ })).toHaveCount(0);
    await expect(alice.getByLabel("Item name", { exact: true })).toHaveValue("Reviewed apples");
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await row("Milk").click();
    const unregionedEditor = alice.getByRole("dialog", { name: "Edit receipt item", exact: true });
    await expect(unregionedEditor).toBeVisible();
    await expect(unregionedEditor.getByRole("img", { name: "Receipt line", exact: true })).toHaveCount(0);
    await expect(unregionedEditor.getByRole("img", { name: "Highlighted receipt line", exact: true })).toHaveCount(0);
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await reconciliation().click();
    await alice.getByLabel("Receipt subtotal", { exact: true }).fill("30.00");
    await alice.getByLabel("Receipt discount", { exact: true }).fill("3.00");
    await alice.getByLabel("Receipt tax", { exact: true }).fill("3.00");
    await alice.getByLabel("Other adjustments", { exact: true }).fill("1.50");
    await alice.getByLabel("Receipt total", { exact: true }).fill("31.50");
    await alice.getByRole("button", { name: "Close summary", exact: true }).click();
    await expect(reconciliation()).toBeFocused();
    await expect(row("Reviewed apples")).toContainText("12.50");
    await expect(row("Milk")).toContainText("19.00");
    await expect(reconciliation()).toContainText("Matches receipt");
    await reconciliation().click();
    await alice.getByLabel("Receipt tax", { exact: true }).fill("6.00");
    await alice.getByRole("button", { name: "Close summary", exact: true }).click();
    await expect(row("Reviewed apples")).toContainText("15.50");
    await expect(reconciliation()).toContainText("Off by $3.00");
    await alice.getByRole("button", { name: "Continue to sharing" }).click();
    await expect(alice.getByRole("heading", { name: "Who’s sharing this bill?" })).toBeVisible();
    await stepButton("Items").click();
    await row("Reviewed apples").click();
    await alice.getByRole("button", { name: "Set final manually", exact: true }).click();
    await alice.getByLabel("Final cost · CAD", { exact: true }).fill("11.00");
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await expect(row("Reviewed apples")).toContainText("Manual");
    await expect(row("Reviewed apples")).toContainText("11.00");
    await expect(reconciliation()).toContainText("Off by $1.50");
    await row("Reviewed apples").click();
    await alice.getByRole("button", { name: "Use receipt calculation", exact: true }).click();
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await expect(row("Reviewed apples")).toContainText("15.50");
    // Signed penny allocation follows the same deterministic remainder rule.
    await reconciliation().click();
    await alice.getByLabel("Other adjustments", { exact: true }).fill("-0.01");
    await alice.getByRole("button", { name: "Close summary", exact: true }).click();
    await expect(row("Reviewed apples")).toContainText("15.00");
    await expect(row("Milk")).toContainText("17.99");
    await reconciliation().click();
    await alice.getByLabel("Other adjustments", { exact: true }).fill("1.50");
    await alice.getByRole("button", { name: "Close summary", exact: true }).click();
    await expect(row("Reviewed apples")).toContainText("15.50");
    assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await alice.screenshot({ path: `/tmp/share-tally-receipt-smoke/compact-review-${viewport.width}.png`, fullPage: true });
    await alice.getByRole("button", { name: "Save draft & close" }).click();
    await expect(alice).toHaveURL(groupRoute);
    const persisted = (await api(`/receipt-drafts/${draftId}`)).draft.data;
    assert.deepEqual(persisted.items.map(i => i.finalCents), [1550, 1900]);
    assert.equal(persisted.items[0].quantity, "2");
    assert.equal(persisted.items[0].name, "Reviewed apples");
    assert.equal(persisted.receipt.taxCents, 600);
    assert.equal(persisted.totalCents, 3150);
  }
}
