// Receipt scenarios: processing. Each starts from its own group and records.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { receiptEnvironment, receiptGroup, receiptPhoto, processingTitle } from './fixtures.mjs';
import { serverRequire } from '../environment.mjs';

export const scenarios = [
  { name: 'processing-recovery', environment: receiptEnvironment, run: processingRecovery },
  { name: 'scan-fallback', environment: receiptEnvironment, run: scanFallback },
  { name: 'low-confidence-hints', environment: receiptEnvironment, run: lowConfidenceHints },
];

// A scan is saved at once; its drafts stay locked while names and tax are checked, then recover live.
async function processingRecovery(env) {
  const { api, pageFor, pool, waitForServer } = env;
  const { group, groupRoute, newBillRoute, alice, stepButton, titledDraft } = await receiptGroup(env);
  const temporaryPhoto = await receiptPhoto(20, 30, "red");
  await alice.goto(`${newBillRoute}/${await titledDraft("Scanned receipt")}`);
  const sharp = serverRequire("sharp");
  const image = await sharp({
    create: { width: 300, height: 500, channels: 3, background: "#f8f8f2" },
  })
    .png()
    .toBuffer();
  await expect(
    alice.getByRole("button", { name: "Take a picture", exact: true }),
  ).toBeHidden();
  await expect(
    alice.getByRole("button", { name: "Choose a photo", exact: true }),
  ).toBeVisible();
  await alice.setViewportSize({ width: 390, height: 844 });
  await expect(
    alice.getByRole("button", { name: "Take a picture", exact: true }),
  ).toBeVisible();
  const cameraChooser = alice.waitForEvent("filechooser");
  await alice
    .getByRole("button", { name: "Take a picture", exact: true })
    .click();
  const camera = await cameraChooser;
  assert.equal(await camera.element().getAttribute("capture"), "environment");
  await camera.setFiles({
    name: "camera.png",
    mimeType: "image/png",
    buffer: image,
  });
  await alice
    .getByRole("button", { name: "Choose another", exact: true })
    .click();
  await alice.setViewportSize({ width: 1280, height: 1000 });
  const fileChooser = alice.waitForEvent("filechooser");
  await alice.getByRole("button", { name: "Choose a photo", exact: true }).click();
  const chooser = await fileChooser;
  assert.equal(await chooser.element().getAttribute("capture"), null);
  await waitForServer("holding-model", "hold-model");
  const firstModelHeld = waitForServer("model-held");
  await chooser.setFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: image,
  });
  await alice
    .getByRole("button", { name: "Use this photo", exact: true })
    .click();
  // Cropping starts a saved scan; hold only the background name/tax check.
  await firstModelHeld;
  await expect(alice.getByRole("heading", { name: "Check your items" })).toBeVisible();
  const scannedDraft = (await api(`/groups/${group.id}/receipt-drafts`)).drafts.find(d => d.data.title === "Scanned receipt");
  assert.ok(scannedDraft, "The scan must be saved before the background model finishes");
  assert.equal(scannedDraft.processingStatus, "processing");
  assert.equal(scannedDraft.data.items.length, 1);
  const observer = await pageFor("alice-token", { width: 1280, height: 1000 });
  await observer.goto(groupRoute);
  const processingDraftRow = () => observer.locator(".draft-list-row").filter({ hasText: "Scanned receipt" });
  await expect(processingDraftRow()).toContainText("Checking names & tax…");
  await observer.setViewportSize({ width: 390, height: 844 });
  await expect(processingDraftRow()).toContainText("Checking names & tax…");
  assert.equal(await observer.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  // Leaving the processing draft on the list does not prevent starting another bill.
  await observer.getByRole("button", { name: "New bill", exact: true }).click();
  await expect(observer.getByRole("heading", { name: "How do you want to split it?" })).toBeVisible();
  await observer.getByRole("button", { name: "Back to group" }).click();
  await expect(observer).toHaveURL(groupRoute);
  await expect(processingDraftRow()).toContainText("Checking names & tax…");
  await processingDraftRow().getByRole("button", { name: "Continue", exact: true }).click();
  await expect(observer.getByRole("heading", { name: "Check your items" })).toBeVisible();
  const readyTitle = "Names and tax filled in";
  for (const page of [alice, observer]) {
    await expect(page.getByText(processingTitle, { exact: true })).toBeVisible();
    const lockedRow = page.getByRole("button", { name: "Edit APPLE", exact: true });
    await expect(lockedRow).toContainText("Checking tax");
    await expect(lockedRow).toContainText("3.00");
    await lockedRow.click();
    const lockedEditor = page.getByRole("dialog", { name: "Edit receipt item", exact: true });
    await expect(lockedEditor).toContainText("Checking the name and tax for this item. Editing unlocks when it finishes.");
    await expect(lockedEditor.getByLabel("Item name", { exact: true })).toBeDisabled();
    await expect(lockedEditor.getByLabel("Printed price", { exact: true })).toBeDisabled();
    await expect(lockedEditor.getByRole("checkbox", { name: "Taxable", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await expect(page.getByRole("button", { name: /Receipt summary|Off by|Matches receipt|Printed items/ }).filter({ hasText: /Items|items/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to sharing" })).toBeDisabled();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await expect(alice.getByRole("button", { name: "Add an item", exact: true })).toBeDisabled();
  await expect(alice.getByRole("button", { name: "Save draft & close" })).toBeDisabled();
  await alice.getByRole("button", { name: /Receipt summary|Off by|Matches receipt|Printed items/ }).filter({ hasText: /Items|items/ }).click();
  await expect(alice.getByLabel("Receipt tax", { exact: true })).toBeDisabled();
  await alice.getByRole("button", { name: "Close summary", exact: true }).click();
  await expect(alice.getByRole("button", { name: "Replace receipt photo" })).toBeDisabled();
  await expect(stepButton("People")).toBeDisabled();
  const lockedInitiation = await fetch(`${env.apiUrl}/api/receipt-drafts/${scannedDraft.id}/initialize`, {
    method: "POST", headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" },
    body: JSON.stringify({ revision: scannedDraft.revision }),
  });
  assert.equal(lockedInitiation.status, 409, "A processing draft cannot be initiated");
  // Both already-open review pages must update over the group stream, without a reload.
  env.sendToServer("release-model");
  for (const page of [alice, observer]) {
    await expect(page.getByText(readyTitle, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit Friendly item 1", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Continue to sharing" })).toBeEnabled();
    await page.getByRole("button", { name: "Edit Friendly item 1", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Edit receipt item", exact: true }).getByLabel("Item name", { exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await page.getByRole("status").filter({ hasText: readyTitle })
      .getByRole("button", { name: "Dismiss notification", exact: true }).click();
    await expect(page.getByText(readyTitle, { exact: true })).toHaveCount(0);
  }
  await expect.poll(async () => (await api(`/receipt-drafts/${scannedDraft.id}`)).draft.processingStatus).toBe("ready");
  await observer.getByRole("button", { name: "Back to group" }).click();
  await expect(processingDraftRow()).not.toContainText("Checking names & tax…");
  await observer.close();
  const applesRow = () => alice.getByRole("button", { name: "Edit Apples", exact: true });
  const reconciliation = () => alice.getByRole("button", { name: /Matches receipt|Off by|Receipt summary/ }).filter({ hasText: /Items/ });
  await alice.getByRole("button", { name: "Edit Friendly item 1", exact: true }).click();
  await alice.getByLabel("Item name", { exact: true }).fill("Apples");
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(applesRow()).toContainText("3.00");
  await reconciliation().click();
  await alice.getByLabel("Receipt tax", { exact: true }).fill("0.30");
  await alice.getByRole("button", { name: "Close summary", exact: true }).click();
  await expect(alice.getByText(/Receipt tax \$0\.30 isn't assigned to any item/)).toBeVisible();
  await expect(alice.getByRole("button", { name: "Continue to sharing" })).toBeDisabled();
  await expect(stepButton("People")).toBeDisabled();
  await expect(alice.getByText("Assign the receipt tax to an item to continue.", { exact: true })).toBeVisible();
  await applesRow().click();
  await alice.getByRole("checkbox", { name: "Taxable", exact: true }).check();
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(alice.getByText(/Receipt tax \$0\.30 isn't assigned to any item/)).toHaveCount(0);
  await expect(applesRow()).toContainText("3.30");
  await expect(reconciliation()).toContainText("Off by $0.30");
  await reconciliation().click();
  await alice.getByLabel("Receipt tax", { exact: true }).fill("");
  await alice.getByRole("button", { name: "Close summary", exact: true }).click();
  await expect(applesRow()).toContainText("3.00");
  await reconciliation().click();
  await alice.getByLabel("Receipt tax", { exact: true }).fill("0.30");
  await alice.getByLabel("Printed prices include tax", { exact: true }).check();
  await alice.getByRole("button", { name: "Close summary", exact: true }).click();
  await expect(applesRow()).toContainText("3.00");
  await reconciliation().click();
  await alice.getByLabel("Receipt discount", { exact: true }).fill("0.30");
  await alice.getByRole("button", { name: "Close summary", exact: true }).click();
  await expect(applesRow()).toContainText("2.70");
  await applesRow().click();
  await expect(alice.getByRole("checkbox", { name: "Taxable", exact: true })).toBeChecked();
  await alice.getByRole("checkbox", { name: "Taxable", exact: true }).uncheck();
  await alice.getByRole("button", { name: "Set final manually", exact: true }).click();
  await alice.getByLabel("Final cost · CAD", { exact: true }).fill("2.80");
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await alice.getByRole("button", { name: "Save draft & close" }).click();
  await expect(alice.locator("dialog[open]")).toHaveCount(0);
  await expect(alice.locator(".draft-list-row").filter({ hasText: "Scanned receipt" })).toBeVisible();
  const savedScan = (await api(`/groups/${group.id}/receipt-drafts`)).drafts.find(d => d.data.title === "Scanned receipt");
  const savedPhoto = (await pool.query('SELECT base64 FROM receipt_photos WHERE draft_id = $1', [savedScan.id])).rows[0].base64;
  await alice.locator(".draft-list-row").filter({ hasText: "Scanned receipt" }).getByRole("button", { name: "Continue", exact: true }).click();
  // The already-open tab must receive both processing and completion events.
  const replacementObserver = await pageFor("alice-token", { width: 1280, height: 1000 });
  await replacementObserver.goto(`${newBillRoute}/${savedScan.id}`);
  await expect(replacementObserver.getByRole("button", { name: "Edit Apples", exact: true })).toBeEnabled();
  await waitForServer("holding-model", "hold-model");
  const replacementHeld = waitForServer("model-held");
  await alice.getByRole("button", { name: "Replace receipt photo", exact: true }).click();
  await alice.getByLabel("Choose a receipt image").setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: temporaryPhoto });
  await alice.getByRole("button", { name: "Use this photo", exact: true }).click();
  await replacementHeld;
  await expect(replacementObserver.locator(".receipt-row-open").first()).toBeEnabled();
  await expect(replacementObserver.getByText(processingTitle, { exact: true })).toBeVisible();
  await expect(replacementObserver.getByRole("button", { name: "Continue to sharing" })).toBeDisabled();
  await expect(alice.locator(".receipt-row-open").first()).toBeEnabled();
  env.sendToServer("release-model");
  await expect(alice.getByRole("heading", { name: "Check your items" })).toBeVisible();
  await expect(alice.getByRole("button", { name: "Edit Friendly item 1", exact: true })).toBeEnabled();
  await expect(replacementObserver.getByRole("button", { name: "Edit Friendly item 1", exact: true })).toBeEnabled();
  await replacementObserver.close();
  // A replacement scan is saved immediately; leaving cannot roll its photo back.
  await alice.getByRole("button", { name: "Back to group" }).click();
  await expect(alice).toHaveURL(groupRoute);
  const replacementPhoto = (await pool.query('SELECT base64 FROM receipt_photos WHERE draft_id = $1', [savedScan.id])).rows[0].base64;
  assert.notEqual(replacementPhoto, savedPhoto);
  const replacementDraft = (await api(`/receipt-drafts/${savedScan.id}`)).draft;
  assert.equal(replacementDraft.processingStatus, "ready");
  assert.equal(replacementDraft.data.items[0].name, "Friendly item 1");
}

// A failed name and tax check falls back to the scanned names and flags the rows to check.
async function scanFallback(env) {
  const { api, waitForServer } = env;
  const { group, groupRoute, newBillRoute, alice, titledDraft } = await receiptGroup(env);
  const image = await receiptPhoto(300, 500);
  // A failed check retains Azure names and flags every affected row. Exercise the
  // processing-to-fallback stream update, filter and two ways to clear a marker at both widths.
  await waitForServer("allocation-receipt-ready", "allocation-receipt");
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    await alice.setViewportSize(viewport);
    await alice.goto(`${newBillRoute}/${await titledDraft(`Fallback review ${viewport.width}`)}`);
    await waitForServer("holding-model", "hold-model");
    await waitForServer("model-mode-error-ready", "model-mode-error");
    const fallbackModelHeld = waitForServer("model-held");
    await alice.getByLabel("Choose a receipt image").setInputFiles({ name: "fallback.png", mimeType: "image/png", buffer: image });
    await alice.getByRole("button", { name: "Use this photo", exact: true }).click();
    await fallbackModelHeld;
    await expect(alice.getByText(processingTitle, { exact: true })).toBeVisible();
    await expect(alice.getByRole("button", { name: "Edit APPLE", exact: true })).toContainText("Checking tax");
    const fallbackId = (await api(`/groups/${group.id}/receipt-drafts`)).drafts
      .find(d => d.data.title === `Fallback review ${viewport.width}`)?.id;
    assert.ok(fallbackId, "The processing fallback scan must be saved");
    env.sendToServer("release-model");
    const warningTitle = "AI tax check timed out, so please confirm which items are taxable";
    await expect(alice.getByText(warningTitle, { exact: true })).toBeVisible();
    await expect(alice.getByRole("button", { name: "Tax not checked (3)", exact: true })).toBeVisible();
    await expect(alice.getByText("Taxable · not checked", { exact: true })).toHaveCount(3);
    await expect(alice.getByRole("button", { name: "Continue to sharing" })).toBeEnabled();
    const fallbackAzure = (await api(`/receipt-drafts/${fallbackId}`)).draft;
    assert.equal(fallbackAzure.processingStatus, "fallback");
    assert.deepEqual(fallbackAzure.data.items.map(item => item.name), ["APPLE", "SOAP", "CANDLE"], "Fallback retains Azure descriptions");
    await alice.getByRole("button", { name: "Tax not checked (3)", exact: true }).click();
    await expect(alice.locator(".receipt-row-open")).toHaveCount(3);
    await alice.getByRole("button", { name: "Edit APPLE", exact: true }).click();
    await expect(alice.getByRole("checkbox", { name: "Taxable", exact: true })).toBeChecked();
    await alice.getByRole("button", { name: "Tax setting is right", exact: true }).click();
    await expect(alice.getByRole("button", { name: "Tax setting is right", exact: true })).toHaveCount(0);
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await expect(alice.getByRole("button", { name: "Tax not checked (2)", exact: true })).toBeVisible();
    await expect(alice.getByRole("button", { name: "Edit APPLE", exact: true })).toHaveCount(0);
    await alice.getByRole("button", { name: "Edit SOAP", exact: true }).click();
    await alice.getByLabel("Item name", { exact: true }).fill("Renamed fallback item");
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await expect(alice.getByRole("button", { name: "Tax not checked (2)", exact: true })).toBeVisible();
    await alice.getByRole("button", { name: "Edit Renamed fallback item", exact: true }).click();
    await alice.getByRole("checkbox", { name: "Taxable", exact: true }).uncheck();
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await expect(alice.getByRole("button", { name: "Tax not checked (1)", exact: true })).toBeVisible();
    await expect(alice.locator(".receipt-row-open")).toHaveCount(1);
    await expect(alice.getByRole("button", { name: "Edit CANDLE", exact: true })).toBeVisible();
    assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await alice.getByRole("button", { name: "Save draft & close" }).click();
    await expect(alice).toHaveURL(groupRoute);
    const fallbackDraft = (await api(`/receipt-drafts/${fallbackId}`)).draft;
    assert.equal(fallbackDraft.data.items[0].taxNotChecked, false);
    assert.equal(fallbackDraft.data.items[1].name, "Renamed fallback item");
    assert.equal(fallbackDraft.data.items[1].taxable, false);
    assert.equal(fallbackDraft.data.items[1].taxNotChecked, false);
    assert.equal(fallbackDraft.data.items[2].taxNotChecked, true);
    await alice.locator(".draft-list-row").filter({ hasText: `Fallback review ${viewport.width}` })
      .getByRole("button", { name: "Continue", exact: true }).click();
    await expect(alice.getByRole("button", { name: "Tax not checked (1)", exact: true })).toBeVisible();
    await alice.getByRole("button", { name: "Tax not checked (1)", exact: true }).click();
    await expect(alice.locator(".receipt-row-open")).toHaveCount(1);
    await alice.getByRole("button", { name: "Back to group" }).click();
    await alice.getByRole("button", { name: `Delete Fallback review ${viewport.width}`, exact: true }).click();
    await alice.getByRole("button", { name: "Delete draft", exact: true }).click();
    await waitForServer("model-mode-ok-ready", "model-mode-ok");
  }
  await waitForServer("normal-allocation-ready", "normal-allocation");
}

// Low-confidence OCR hints never gate progression.
async function lowConfidenceHints(env) {
  const { api, waitForServer } = env;
  const { group, groupRoute, newBillRoute, alice, stepButton } = await receiptGroup(env);
  const image = await receiptPhoto(300, 500);
  // Low-confidence OCR hints are independent of tax hints and never gate progression.
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    await alice.setViewportSize(viewport);
    await alice.goto(groupRoute);
    await alice.getByRole("button", { name: "New bill", exact: true }).click();
    await waitForServer("low-confidence-receipt-ready", "low-confidence-receipt");
    await alice.getByLabel("Choose a receipt image").setInputFiles({ name: "uncertain.png", mimeType: "image/png", buffer: image });
    await alice.getByRole("button", { name: "Use this photo", exact: true }).click();
    await expect(alice.getByRole("heading", { name: "Check your items" })).toBeVisible();
    await expect(alice.getByRole("button", { name: "Needs check (1)" })).toBeVisible();
    await expect(alice.getByText("⚠ Needs check", { exact: true })).toBeVisible();
    await expect(alice.getByRole("button", { name: "Confirm item", exact: true })).toHaveCount(0);
    await expect(alice.getByRole("button", { name: "Continue to sharing" })).toBeEnabled();
    await alice.getByRole("button", { name: "Continue to sharing" }).click();
    await expect(alice.getByRole("button", { name: "Share bill", exact: true })).toBeEnabled();
    await stepButton("Items").click();
    await expect(alice.locator(".receipt-row-open").first()).toBeEnabled();
    const lowConfidenceId = (await api(`/groups/${group.id}/receipt-drafts`)).drafts.find(d => d.data.items.some(i => i.evidence?.descriptionConfidence === 0.7))?.id;
    assert.ok(lowConfidenceId, "Low-confidence Azure draft was saved");
    await expect.poll(async () => (await api(`/receipt-drafts/${lowConfidenceId}`)).draft.processingStatus).toBe("ready");
    await alice.getByRole("button", { name: "Needs check (1)" }).click();
    await expect(alice.locator(".receipt-row-open")).toHaveCount(1);
    await alice.locator(".receipt-row-open").first().click();
    await alice.getByRole("button", { name: "Confirm item", exact: true }).click();
    await expect(alice.getByRole("button", { name: "Needs check (0)" })).toBeVisible();
    await expect(alice.getByText("All checked — no items need checking.", { exact: true })).toBeVisible();
    assert.equal((await api(`/receipt-drafts/${lowConfidenceId}`)).draft.data.items[0].needsCheck, false);
    await alice.reload();
    await expect(alice.getByRole("button", { name: "Needs check (0)" })).toBeVisible();
    await alice.getByRole("button", { name: "Needs check (0)" }).click();
    await expect(alice.getByText("All checked — no items need checking.", { exact: true })).toBeVisible();
    await alice.getByRole("button", { name: "All", exact: true }).click();
    await alice.getByRole("button", { name: "Add an item", exact: true }).click();
    // A new blank item has nothing to read, so its name is ready to type.
    await expect(alice.getByLabel("Item name", { exact: true })).toBeFocused();
    await expect(alice.getByText("Missing price", { exact: true })).toBeVisible();
    await expect(alice.getByRole("button", { name: "Needs check (1)" })).toBeVisible();
    await alice.getByLabel("Item name", { exact: true }).fill("Manual orange");
    await alice.getByLabel("Printed price", { exact: true }).fill("1.00");
    await alice.getByRole("button", { name: "Done", exact: true }).click();
    await expect(alice.getByRole("button", { name: "Needs check (0)" })).toBeVisible();
    // Reopening the added item is opening an existing one, so it starts on the heading.
    await alice.getByRole("button", { name: "Edit Manual orange", exact: true }).click();
    await expect(alice.getByRole("heading", { name: "Edit receipt item", exact: true })).toBeFocused();
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await alice.getByRole("button", { name: "Save draft & close" }).click();
    await expect(alice).toHaveURL(groupRoute);
    const saved = (await api(`/receipt-drafts/${lowConfidenceId}`)).draft;
    assert.equal(saved.data.items[0].needsCheck, false);
    assert.equal(saved.data.items[1].needsCheck, false, "Manual item edits clear their missing-price hint");
    await alice.goto(`${newBillRoute}/${lowConfidenceId}`);
    await stepButton("Items").click();
    await expect(alice.getByRole("button", { name: "Needs check (0)" })).toBeVisible();
    await alice.reload();
    await expect(alice.getByRole("button", { name: "Needs check (0)" })).toBeVisible();
    await alice.getByRole("button", { name: "Back to group" }).click();
    await waitForServer("normal-confidence-receipt-ready", "normal-confidence-receipt");
    await alice.getByRole("button", { name: `Delete ${saved.data.title || "untitled bill"}`, exact: true }).click();
    await alice.getByRole("button", { name: "Delete draft", exact: true }).click();
  }
}
