// Receipt scenarios: new bill. Each starts from its own group and records.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { receiptEnvironment, receiptGroup } from './fixtures.mjs';
import { serverRequire } from '../environment.mjs';
import { groupSwitcher, openGroupSwitcher, expectSegmentSlide } from '../ui.mjs';

export const scenarios = [
  { name: 'scan-retry', environment: { ...receiptEnvironment, firstExtractionFails: true }, run: scanRetry },
  { name: 'receipt-crop', environment: receiptEnvironment, run: receiptCrop },
  { name: 'unassigned-tax', environment: receiptEnvironment, run: unassignedTax },
  { name: 'manual-split-fallback', environment: receiptEnvironment, run: manualSplitFallback },
];

// A blank new bill saves nothing; a failed scan can be retried, resumed from Home and deleted.
async function scanRetry(env) {
  const { api, base } = env;
  const { group, groupRoute, newBillRoute, alice, stepButton, expectNewBillRoute } = await receiptGroup(env);
  assert.equal(await alice.evaluate(() => window.isSecureContext), false);
  assert.equal(
    await alice.evaluate(() => typeof crypto.randomUUID),
    "undefined",
  );
  // Opening and leaving a blank full-page bill must not create an untitled server draft.
  await alice.getByRole("button", { name: "New bill", exact: true }).click();
  await expectNewBillRoute();
  await alice.reload();
  await expectNewBillRoute();
  await expect(alice.getByRole("heading", { name: "Start with your receipt" })).toBeVisible();
  await alice.goBack();
  await expect(alice).toHaveURL(groupRoute);
  await expect(alice.getByRole("button", { name: "New bill", exact: true })).toBeVisible();
  assert.equal((await api(`/groups/${group.id}/receipt-drafts`)).drafts.length, 0);
  await alice.getByRole("button", { name: "New bill", exact: true }).click();
  await expectNewBillRoute();
  const temporaryPhoto = await serverRequire("sharp")({ create: { width: 20, height: 30, channels: 3, background: "red" } }).png().toBuffer();
  await alice.getByLabel("Choose a receipt image").setInputFiles({ name: "discard.png", mimeType: "image/png", buffer: temporaryPhoto });
  await alice.getByRole("button", { name: "Use this photo", exact: true }).click();
  await expect(alice.getByRole("img", { name: "Original cropped receipt" })).toBeVisible();
  // The first extraction fails on purpose; cropping must have started it without a Read receipt click.
  await expect(alice.getByText("Test extraction unavailable. Your draft is safe.", { exact: true })).toBeVisible();
  await expect(alice.getByRole("button", { name: "Read receipt", exact: true })).toBeVisible();
  await alice.getByRole("button", { name: "Read receipt", exact: true }).click();
  await expect(alice.getByRole("heading", { name: "Check your items" })).toBeVisible();
  await expect(alice.getByRole("button", { name: "Edit Friendly item 1", exact: true })).toBeVisible();
  // The retry is a saved scan, even though the new-bill page began locally.
  const retryDrafts = (await api(`/groups/${group.id}/receipt-drafts`)).drafts;
  assert.equal(retryDrafts.length, 1);
  await expect.poll(async () => (await api(`/receipt-drafts/${retryDrafts[0].id}`)).draft.processingStatus).toBe("ready");
  // Public seam: a saved, ready receipt draft is resumed from its Home action.
  await alice.getByRole("link", { name: "ShareTally home", exact: true }).click();
  const draftAction = alice.getByRole("region", { name: "Needs your attention" })
    .getByRole("link", { name: /Review draft.*Receipt friends/ });
  await expect(draftAction).toBeVisible();
  await draftAction.click();
  await expect(alice).toHaveURL(`${newBillRoute}/${retryDrafts[0].id}`);
  await expect(alice.getByRole("heading", { name: "Check your items" })).toBeVisible();
  await alice.getByRole("button", { name: "Back to group" }).click();
  await expect(alice).toHaveURL(groupRoute);
  const beforeDraftDelete = await openGroupSwitcher(alice);
  await expect(beforeDraftDelete.getByRole("option", { name: /Receipt friends.*1 pending action/ })).toBeVisible();
  await groupSwitcher(alice).click();
  await alice.getByRole("button", { name: `Delete ${retryDrafts[0].data.title || "untitled bill"}`, exact: true }).click();
  await alice.getByRole("button", { name: "Delete draft", exact: true }).click();
  await expect.poll(async () => (await api(`/groups/${group.id}/receipt-drafts`)).drafts.length).toBe(0);
  const afterDraftDelete = await openGroupSwitcher(alice);
  await expect(afterDraftDelete.getByRole("option", { name: "Receipt friends", exact: true })).toBeVisible();
  await expect(afterDraftDelete.locator(".group-switcher-count")).toHaveCount(0);
  await groupSwitcher(alice).click();
  // Later steps stay locked until the receipt step produces items or a manual split.
  await alice.goto(`${base}#/group-bills/${group.id}`);
  await alice.getByRole("button", { name: "New bill", exact: true }).click();
  await expect(stepButton("Items")).toBeDisabled();
  await expect(stepButton("People")).toBeDisabled();
  await alice.getByRole("button", { name: "Enter items myself", exact: true }).click();
  await expect(alice.getByRole("button", { name: "Continue to sharing" })).toBeDisabled();
  await expect(stepButton("People")).toBeDisabled();
  await stepButton("Receipt").click();
  await expect(stepButton("Items")).toBeDisabled();
  await alice.getByRole("button", { name: "Back to group" }).click();
}

// Cropping a receipt photo before it is scanned.
async function receiptCrop(env) {
  const { api } = env;
  const { group, groupRoute, alice } = await receiptGroup(env);
  const cropPhoto = await serverRequire("sharp")({
    create: { width: 400, height: 800, channels: 3, background: "#f8f8f2" },
  }).png().toBuffer();
  const cropDialog = () => alice.getByRole("dialog", { name: "Just the receipt" });
  const croppedReceipt = () => alice.getByRole("img", { name: "Original cropped receipt" });
  async function openCrop() {
    await alice.getByRole("button", { name: "New bill", exact: true }).click();
    await expect(alice.getByRole("heading", { name: "Start with your receipt" })).toBeVisible();
    await alice.getByLabel("Choose a receipt image").setInputFiles({
      name: "crop-smoke.png", mimeType: "image/png", buffer: cropPhoto,
    });
    await expect(cropDialog()).toBeVisible();
    await expect(cropDialog().getByRole("img", { name: "Receipt to crop" })).toBeVisible();
  }
  async function dragCropRightEdge() {
    const handle = await cropDialog().getByRole("slider", { name: "Crop right edge" }).boundingBox();
    assert.ok(handle, "The crop right edge must be draggable");
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await alice.mouse.move(x, y);
    await alice.mouse.down();
    await alice.mouse.move(x - 90, y, { steps: 8 });
    await alice.mouse.up();
  }
  async function uploadCropAndMeasure() {
    await cropDialog().getByRole("button", { name: "Use this photo", exact: true }).click();
    await expect(cropDialog()).toBeHidden();
    await expect(alice.getByRole("heading", { name: "Check your items" })).toBeVisible();
    await expect(croppedReceipt()).toBeVisible();
    await expect.poll(() => croppedReceipt().evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    return croppedReceipt().evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight }));
  }
  async function deleteCropDraft() {
    const drafts = (await api(`/groups/${group.id}/receipt-drafts`)).drafts;
    assert.equal(drafts.length, 1, "Each crop upload should leave one saved draft");
    await expect.poll(async () => (await api(`/receipt-drafts/${drafts[0].id}`)).draft.processingStatus).toBe("ready");
    await alice.getByRole("button", { name: "Back to group" }).click();
    await expect(alice).toHaveURL(groupRoute);
    await alice.getByRole("button", { name: `Delete ${drafts[0].data.title || "untitled bill"}`, exact: true }).click();
    await alice.getByRole("button", { name: "Delete draft", exact: true }).click();
    await expect.poll(async () => (await api(`/groups/${group.id}/receipt-drafts`)).drafts.length).toBe(0);
  }
  // Both ways of closing the crop return to the receipt step without saving a photo.
  for (const close of ["Escape", "Close crop"]) {
    await openCrop();
    if (close === "Escape") {
      // A very short landscape screen must still show both crop actions.
      await alice.setViewportSize({ width: 600, height: 240 });
      for (const name of ["Choose another", "Use this photo"])
        await expect(cropDialog().getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
      await alice.setViewportSize({ width: 1280, height: 1000 });
      await alice.keyboard.press("Escape");
    } else await cropDialog().getByRole("button", { name: close }).click();
    await expect(cropDialog()).toBeHidden();
    await expect(alice.getByRole("heading", { name: "Start with your receipt" })).toBeVisible();
    await expect(croppedReceipt()).toHaveCount(0);
    assert.equal((await api(`/groups/${group.id}/receipt-drafts`)).drafts.length, 0);
    await alice.getByRole("button", { name: "Back to group" }).click();
    await expect(alice).toHaveURL(groupRoute);
  }
  // An untouched crop uploads the whole photo.
  await openCrop();
  const untouchedCrop = await uploadCropAndMeasure();
  assert.ok(Math.abs(untouchedCrop.width - 400) <= 2 && Math.abs(untouchedCrop.height - 800) <= 2, `Untouched crop should keep the full photo: ${untouchedCrop.width}×${untouchedCrop.height}px`);
  await deleteCropDraft();

  await openCrop();
  await dragCropRightEdge();
  const draggedCrop = await uploadCropAndMeasure();
  assert.ok(draggedCrop.width < 350, `Dragged crop should narrow the upload: ${draggedCrop.width}px`);
  assert.ok(Math.abs(draggedCrop.height - 800) <= 2, `Dragged crop should keep the full height: ${draggedCrop.height}px`);
  await deleteCropDraft();

  await openCrop();
  const topEdge = cropDialog().getByRole("slider", { name: "Crop top edge" });
  await topEdge.focus();
  await topEdge.press("Shift+ArrowDown");
  await topEdge.press("Shift+ArrowDown");
  const keyboardCrop = await uploadCropAndMeasure();
  assert.ok(Math.abs(keyboardCrop.width - 400) <= 2, `Keyboard crop should keep the full width: ${keyboardCrop.width}px`);
  assert.ok(keyboardCrop.height >= 630 && keyboardCrop.height <= 650, `Two coarse key presses should trim about 20%: ${keyboardCrop.height}px`);
  await deleteCropDraft();

  await openCrop();
  await expect(cropDialog().getByRole("button", { name: "Reset", exact: true })).toHaveCount(0);
  await dragCropRightEdge();
  await expect(cropDialog().getByRole("button", { name: "Reset", exact: true })).toBeVisible();
  await cropDialog().getByRole("button", { name: "Reset", exact: true }).click();
  await expect(cropDialog().getByRole("button", { name: "Reset", exact: true })).toHaveCount(0);
  const resetCrop = await uploadCropAndMeasure();
  assert.ok(Math.abs(resetCrop.width - 400) <= 2, `Reset should restore the full width: ${resetCrop.width}px`);
  assert.ok(Math.abs(resetCrop.height - 800) <= 2, `Reset should restore the full height: ${resetCrop.height}px`);
  await deleteCropDraft();

  // Shrinking the view raises the on-screen minimum crop; a narrow crop must widen to stay valid.
  await openCrop();
  const rightEdge = cropDialog().getByRole("slider", { name: "Crop right edge" });
  await rightEdge.focus();
  for (let press = 0; press < 10; press++) await rightEdge.press("Shift+ArrowLeft");
  const narrowRight = Number(await rightEdge.getAttribute("aria-valuenow"));
  assert.ok(narrowRight > 0 && narrowRight < 20, `The right edge should reach its minimum crop: ${narrowRight}%`);
  await alice.setViewportSize({ width: 390, height: 500 });
  await expect.poll(async () => Number(await rightEdge.getAttribute("aria-valuenow"))).toBeGreaterThan(narrowRight);
  for (const edge of ["top", "bottom", "left", "right"]) {
    const slider = cropDialog().getByRole("slider", { name: `Crop ${edge} edge` });
    const [min, now, max] = await Promise.all(["aria-valuemin", "aria-valuenow", "aria-valuemax"].map(async (name) => Number(await slider.getAttribute(name))));
    assert.ok(min <= now && now <= max, `Crop ${edge} edge must stay within its bounds after a resize: ${min} ≤ ${now} ≤ ${max}`);
  }
  const resizedRight = Number(await rightEdge.getAttribute("aria-valuenow"));
  const resizedCrop = await uploadCropAndMeasure();
  assert.ok(Math.abs(resizedCrop.width - resizedRight * 4) <= 8, `The upload should match the widened crop (${resizedRight}%): ${resizedCrop.width}px`);
  assert.ok(Math.abs(resizedCrop.height - 800) <= 2, `The resized crop should keep the full height: ${resizedCrop.height}px`);
  await alice.setViewportSize({ width: 1280, height: 1000 });
  await deleteCropDraft();
}

// Unassigned receipt tax blocks sharing and initiation.
async function unassignedTax(env) {
  const { api } = env;
  const { group, newBillRoute, alice, stepButton } = await receiptGroup(env);
  // Unassigned receipt tax blocks sharing and initiation at desktop and mobile widths.
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    const draftId = randomUUID();
    const item = (name, amountCents) => ({
      id: randomUUID(), name, originalText: `${name.toUpperCase()} RECEIPT LINE`,
      quantity: "1", amountCents, discountCents: 0, taxable: false,
      finalCents: amountCents, manualFinal: false,
    });
    await api(`/groups/${group.id}/receipt-drafts/${draftId}`, "alice-token", "PUT", {
      revision: 0,
      data: {
        mode: "items", title: `Unassigned tax ${viewport.width}`, purchaseDate: "2026-09-24",
        timeZone: "America/Toronto", notes: "", totalCents: 3300,
        participantIds: [],
        receipt: { subtotalCents: 3000, discountCents: 0, taxCents: 300, extraCents: 0, pricesIncludeTax: false },
        items: [item("Apples", 1000), item("Milk", 2000)],
      },
    });
    await alice.setViewportSize(viewport);
    await alice.goto(`${newBillRoute}/${draftId}`);
    const row = name => alice.getByRole("button", { name: `Edit ${name}`, exact: true, includeHidden: true });
    await expect(alice.getByText(/Receipt tax \$3\.00 isn't assigned to any item/)).toBeVisible();
    await expect(stepButton("People")).toBeDisabled();
    await expect(alice.getByRole("button", { name: "Continue to sharing" })).toBeDisabled();
    await row("Apples").click();
    await alice.getByRole("checkbox", { name: "Taxable", exact: true }).check();
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await expect(alice.getByText(/Receipt tax \$3\.00 isn't assigned to any item/)).toHaveCount(0);
    await stepButton("People").click();
    await alice.getByRole("button", { name: "Everyone", exact: true }).click();
    await expect(alice.getByRole("button", { name: "Share bill", exact: true })).toBeEnabled();
    await alice.getByRole("button", { name: "Share bill", exact: true }).click();
    await expect(alice.getByRole("heading", { name: "Items & claims" })).toBeVisible();
  }
}

// Switching an unfinished receipt to manual shares.
async function manualSplitFallback(env) {
  const { api, base } = env;
  const { group, alice } = await receiptGroup(env);
  // The guided entry still supports switching an unfinished receipt to manual shares.
  await alice.goto(`${base}#/group-bills/${group.id}`);
  await alice.getByRole("button", { name: "New bill", exact: true }).click();
  await alice
    .getByRole("button", { name: "Enter items myself", exact: true })
    .click();
  await alice
    .getByRole("button", { name: "Add an item", exact: true })
    .click();
  await alice.getByLabel("Item name", { exact: true }).fill("Free sample");
  await alice.getByLabel("Printed price", { exact: true }).fill("0.00");
  await alice.getByLabel("Item name", { exact: true }).press("Enter");
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(
    alice.getByRole("heading", { name: "Check your items", exact: true }),
  ).toBeVisible();
  await alice.getByRole("button", { name: "Continue to sharing" }).click();
  await expect(
    alice.getByRole("button", { name: "Share bill", exact: true }),
  ).toBeDisabled();
  await alice.getByLabel("Bill title", { exact: true }).fill("Manual fallback");
  // Free items add up to nothing, so the followed total still needs a charge.
  await expect(alice.getByText("Add the total paid.", { exact: true })).toBeVisible();
  await alice.getByRole("button", { name: "Paid a different amount?", exact: true }).click();
  await alice
    .getByLabel("Total paid (CAD)", { exact: true })
    .fill("1.00");
  // Zero-cost items are valid; a difference does not impose a new approval gate.
  await expect(
    alice.getByRole("button", { name: "Share bill", exact: true }),
  ).toBeEnabled();
  const split = alice.getByRole("radiogroup", { name: "Split" });
  await expectSegmentSlide(split, "By amount");
  await alice.keyboard.press("ArrowLeft");
  await expect(split.getByRole("radio", { name: "By item" })).toBeChecked();
  await expect(alice.getByLabel("Your share (CAD)", { exact: true })).toHaveCount(0);
  await alice.keyboard.press("ArrowRight");
  await expect(split.getByRole("radio", { name: "By amount" })).toBeChecked();
  await alice.getByLabel("Total paid (CAD)", { exact: true }).focus();
  await alice.keyboard.press("Shift+Tab");
  await expect(split.getByRole("radio", { name: "By amount" })).toBeFocused();
  await expect(alice.getByLabel("Your share (CAD)", { exact: true })).toHaveCount(0);
  await alice
    .getByRole("button", { name: "Share bill", exact: true })
    .click();
  await expect(alice.getByRole("region", { name: "Bill summary", exact: true }).getByText("In progress", { exact: true })).toBeVisible();
  await alice.getByLabel("Your share (CAD)", { exact: true }).fill("1.00");
  await alice.getByRole("button", { name: "Submit and confirm my share", exact: true }).click();
  await expect(
    alice.getByText("Complete and final.", { exact: false }),
  ).toBeVisible();
  assert.equal(
    (await api(`/bills/${alice.url().split("/").at(-1)}`)).bill.mode,
    "manual",
  );
}
