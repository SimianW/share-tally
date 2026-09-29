// Run after installing both client and server dependencies and Chromium:
// cd client && pnpm exec playwright install chromium && pnpm test:receipts
// Real UI + Express + temporary PostgreSQL. Clerk and receipt providers are replaced; this does
// not verify Google OAuth, production credentials, or session lifetime.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { openGroupSwitcher, groupSwitcher } from "./smoke-navigation.mjs";
import { expectSegmentSlide } from "./smoke-segmented.mjs";

const serverRequire = createRequire(
  new URL("../../server/package.json", import.meta.url),
);
const { PostgreSqlContainer } = serverRequire("@testcontainers/postgresql");
const { Pool } = serverRequire("pg");
const { drizzle } = serverRequire("drizzle-orm/node-postgres");
const { migrate } = serverRequire("drizzle-orm/node-postgres/migrator");
const clientRoot = fileURLToPath(new URL("../", import.meta.url));
const serverRoot = fileURLToPath(new URL("../../server/", import.meta.url));
let container, pool, child, vite, browser;
const errors = [];
const networkChangeFailures = new Map();
try {
  container = await new PostgreSqlContainer("postgres:17.6-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(drizzle(pool), { migrationsFolder: `${serverRoot}/drizzle` });
  child = fork(`${serverRoot}/test/server-process.ts`, {
    cwd: serverRoot,
    execArgv: ["--import=tsx"],
    env: { PATH: process.env.PATH, DATABASE_URL: container.getConnectionUri() },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("API startup timed out")),
      30_000,
    );
    child.once("message", (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`API exited: ${code}`));
    });
  });
  vite = await createServer({
    root: clientRoot,
    configFile: false,
    envDir: false,
    // Keep the test-only Clerk bundle separate from production dependency caching.
    cacheDir: `${clientRoot}/node_modules/.vite-smoke`,
    define: {
      "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(
        "test-only-clerk-boundary",
      ),
    },
    plugins: [
      {
        name: "smoke-clerk",
        enforce: "pre",
        resolveId(id) {
          if (id === "@clerk/react") return `${clientRoot}/test/clerk.tsx`;
        },
      },
      react(),
    ],
    optimizeDeps: { exclude: ["@clerk/react"] },
    server: {
      host: "127.0.0.1",
      allowedHosts: ["receipt.test"],
      port: 0,
      proxy: { "/api": `http://127.0.0.1:${port}` },
    },
  });
  await vite.listen();
  // Non-loopback HTTP reproduces the remote development browser's security context.
  const origin = new URL(vite.resolvedUrls.local[0]);
  origin.hostname = "receipt.test";
  const base = origin.href;
  browser = await chromium.launch({
    args: [
      "--host-resolver-rules=MAP receipt.test 127.0.0.1",
      "--no-proxy-server",
    ],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  async function pageFor(identity, viewport) {
    const context = await browser.newContext({
      viewport,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    if (identity)
      await context.addInitScript((token) => {
        if (!sessionStorage.getItem("smoke-initialized")) {
          localStorage.setItem("smoke-token", token);
          sessionStorage.setItem("smoke-initialized", "yes");
        }
      }, identity);
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => {
      if (request.failure()?.errorText !== "net::ERR_NETWORK_CHANGED") return;
      // Report resource paths only, never authorization headers or query strings.
      const resource = `${request.resourceType()} ${new URL(request.url()).pathname}`;
      networkChangeFailures.set(
        resource,
        (networkChangeFailures.get(resource) ?? 0) + 1,
      );
    });
    page.on("console", (message) => {
      if (message.text().includes("net::ERR_NETWORK_CHANGED")) return;
      if (message.type() === "error") {
        console.error("Browser console:", message.text());
        if (message.text().includes("Encountered two children"))
          errors.push(message.text());
      }
    });
    return page;
  }
  function waitForServer(expected, command) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.off("message", received);
        reject(new Error(`Timed out waiting for server message ${expected}`));
      }, 15_000);
      const received = (message) => {
        if (message !== expected) return;
        clearTimeout(timer);
        child.off("message", received);
        resolve();
      };
      child.on("message", received);
      if (command) child.send(command);
    });
  }
  async function api(path, token = "alice-token", method = "GET", body) {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  const { group } = await api("/groups", "alice-token", "POST", {
    name: "Receipt friends",
    icon: { type: "unicode", value: "🛒" },
  });
  const invitation = await api(`/groups/${group.id}/invitation`);
  for (const token of ["bob-token", "carol-token"])
    await api("/groups/join", token, "POST", {
      token: invitation.path.split("/").at(-1),
    });
  const alice = await pageFor("alice-token", { width: 1280, height: 1000 });
  await alice.goto(`${base}#/group-bills/${group.id}`);
  assert.equal(await alice.evaluate(() => window.isSecureContext), false);
  assert.equal(
    await alice.evaluate(() => typeof crypto.randomUUID),
    "undefined",
  );
  const groupRoute = `${base}#/group-bills/${group.id}`;
  const newBillRoute = `${base}#/new-bill/${group.id}`;
  const stepButton = (label) => alice.getByRole("navigation", { name: "New bill steps" })
    .getByRole("button", { name: new RegExp(`${label}$`) });
  const expectNewBillRoute = async (draftId) => {
    await expect(alice).toHaveURL(draftId ? `${newBillRoute}/${draftId}` : newBillRoute);
    await expect(alice.getByRole("navigation", { name: "New bill steps" })).toBeVisible();
    for (const label of ["Receipt", "Items", "People"])
      await expect(stepButton(label)).toBeVisible();
    await expect(alice.locator("dialog[open]")).toHaveCount(0);
  };
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
  // The first scan and retry above consume the test provider's intentional failure.
  // These separate bills can now scan successfully without changing that failure/retry check.
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
  // Pre-migration browser recovery must preserve an explicitly reduced item tax.
  const reducedTaxId = randomUUID();
  const reducedTaxDraft = (await api(`/groups/${group.id}/receipt-drafts/${reducedTaxId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Reduced tax recovery", purchaseDate: "2026-09-24",
      timeZone: "America/Toronto", notes: "", totalCents: 1000, ownShareCents: 0,
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
  await alice.getByRole("button", { name: "Split by amount instead" }).click();
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
  await alice.getByRole("button", { name: "Continue to sharing" }).click();
  await alice.getByLabel("Bill title", { exact: true }).fill("Shared apples");
  await alice.getByLabel("Bob", { exact: true }).check();
  await alice.getByLabel("Carol", { exact: true }).check();
  await alice
    .getByLabel("Total paid (CAD)", { exact: true })
    .fill("3.10");
  await alice.getByRole("button", { name: "Save draft & close" }).click();
  await alice.locator(".draft-list-row").filter({ hasText: "Shared apples" }).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    alice.getByRole("heading", { name: "Who’s sharing this bill?" }),
  ).toBeVisible();
  await alice.getByRole("button", { name: "Back", exact: true }).click();
  await expect(alice.getByRole("button", { name: "Edit Apples", exact: true })).toContainText("3.00");
  await alice.getByRole("button", { name: "Continue to sharing" }).click();
  await alice
    .getByRole("button", { name: "Share bill", exact: true })
    .click();
  await expect(
    alice.getByRole("heading", { name: "Items & claims" }),
  ).toBeVisible();
  const billId = alice.url().split("/").at(-1);
  const claimSheet = (page, name = "Apples") => page.getByRole("dialog", { name, exact: true });
  const itemOption = (page, label, name = "Apples") => claimSheet(page, name).getByRole("button", { name: label, exact: true });
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
  await itemOption(alice, "All of it · $3.00").click();
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $3.00");
  await reopenApples();
  await expect(itemOption(alice, "All of it · $3.00")).toHaveAttribute("aria-pressed", "true");
  await itemOption(alice, "1/2 · $1.50").click();
  await reopenApples();
  await itemOption(alice, "Custom").click();
  await alice.getByLabel("Custom fraction", { exact: true }).fill("4/5");
  await itemOption(alice, "Use custom fraction").click();
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $2.40");
  await reopenApples();
  await expect(itemOption(alice, "Custom · 4/5 · $2.40")).toHaveAttribute("aria-pressed", "true");
  await itemOption(alice, "1/3 · $1.00").click();
  await reopenApples();
  await expect(itemOption(alice, "1/3 · $1.00")).toHaveAttribute("aria-pressed", "true");
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
  await itemOption(alice, "1/3 · $1.00").click();
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
  await itemOption(bob, "1/3 · $1.00").click();
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
  await itemOption(carol, "1/3 · $0.90").click();
  await expect(claimSheet(carol)).toBeHidden();
  await carol.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect(
    carol.getByText("Complete and final.", { exact: false }),
  ).toBeVisible();
  assert.equal((await api(`/bills/${billId}`)).bill.adjustmentCents, 40);
  assert.equal(
    await carol.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  // Exercise portion controls, disabled overclaims, and a concurrent last-fraction conflict.
  const members = (await api(`/groups/${group.id}`)).group.members;
  const memberIds = Object.fromEntries(members.map((member) => [member.displayName, member.id]));
  // A saved, titled draft with no items, so a scan starts from the receipt step.
  const titledDraft = async (title) => {
    const draftId = randomUUID();
    await api(`/groups/${group.id}/receipt-drafts/${draftId}`, "alice-token", "PUT", {
      revision: 0,
      data: {
        mode: "items", title, purchaseDate: "2026-09-24", timeZone: "America/Toronto",
        notes: "", totalCents: null, ownShareCents: 0, participantIds: [memberIds.Alice], items: [],
        receipt: { subtotalCents: null, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
      },
    });
    return draftId;
  };
  const controlDraftId = randomUUID();
  const controlItems = [
    { id: randomUUID(), name: "Apples", originalText: "APPLES RECEIPT LINE", quantity: "1", amountCents: 300, discountCents: 0, taxable: false, finalCents: 300, manualFinal: false },
    { id: randomUUID(), name: "Milk", originalText: "MILK RECEIPT LINE", quantity: "1", amountCents: 200, discountCents: 0, taxable: false, finalCents: 200, manualFinal: false },
  ];
  const controlDraft = (await api(`/groups/${group.id}/receipt-drafts/${controlDraftId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Claim controls", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 500, ownShareCents: 0,
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
  for (const option of ["1/3 · $1.00", "1/4 · $0.75", "1/5 · $0.60", "1/6 · $0.50"])
    await expect(itemOption(alice, option)).toBeEnabled();
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
  await itemOption(alice, "1/3 · $1.00").click();
  await expect(claimSheet(alice, "Milk")).toBeVisible();
  await navButton("Previous item", "Milk").click();
  await expect(itemOption(alice, "1/3 · $1.00")).toHaveAttribute("aria-pressed", "true");
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

  // A correction sends only rows edited since the editor opened, and marks only those rows reviewed.
  const raceDraftId = randomUUID();
  const raceItems = ["Apples", "Milk", "Bread"].map((name) => ({ id: randomUUID(), name, originalText: name.toUpperCase(), quantity: "1", amountCents: 300, discountCents: 0, taxable: false, finalCents: 300, manualFinal: false }));
  const raceDraft = (await api(`/groups/${group.id}/receipt-drafts/${raceDraftId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Correction races", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 900, ownShareCents: 0, participantIds: [memberIds.Alice, memberIds.Bob],
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

  // Auto-advance passes over items others hold in full; Previous, Next and the arrow keys still visit them.
  const skipDraftId = randomUUID();
  const skipItems = ["Bananas", "Taken rice", "Yogurt"].map((name) => ({ id: randomUUID(), name, originalText: name.toUpperCase(), quantity: "1", amountCents: 100, discountCents: 0, taxable: false, finalCents: 100, manualFinal: false }));
  const skipDraft = (await api(`/groups/${group.id}/receipt-drafts/${skipDraftId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Skip taken items", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 300, ownShareCents: 0, participantIds: [memberIds.Alice, memberIds.Bob],
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
  await itemOption(alice, "1/2 · $0.50", "Yogurt").click();
  // Playwright will not click an aria-disabled element; a person still can.
  await navButton("Next item", "Yogurt").click({ force: true });
  await alice.clock.runFor(700);
  await expect(claimSheet(alice, "Yogurt")).toBeVisible();
  await itemOption(alice, "1/2 · $0.50", "Yogurt").click();
  await navButton("Next item", "Yogurt").focus();
  await alice.keyboard.press("ArrowRight");
  await alice.clock.runFor(700);
  await expect(claimSheet(alice, "Yogurt")).toBeVisible();
  // So does a tap on the header outside the content, such as the item title.
  await itemOption(alice, "1/2 · $0.50", "Yogurt").click();
  await claimSheet(alice, "Yogurt").getByRole("heading", { name: "Yogurt", exact: true }).click();
  await alice.clock.runFor(700);
  await expect(claimSheet(alice, "Yogurt")).toBeVisible();
  // Closing cancels it too: reopening the item within the pause does not carry the old advance over.
  await itemOption(alice, "1/2 · $0.50", "Yogurt").click();
  await claimSheet(alice, "Yogurt").getByRole("button", { name: "Close claim", exact: true }).click();
  await alice.getByRole("button", { name: "View Yogurt · $1.00", exact: true }).click();
  await alice.clock.runFor(700);
  await expect(claimSheet(alice, "Yogurt")).toBeVisible();
  // So does an activation that sends only a click, as some assistive technology does.
  await itemOption(alice, "1/2 · $0.50", "Yogurt").click();
  await claimSheet(alice, "Yogurt").evaluate((dialog) => dialog.querySelector(".claim-portion-custom").click());
  await alice.clock.runFor(700);
  await expect(claimSheet(alice, "Yogurt").getByLabel("Custom fraction", { exact: true })).toBeVisible();
  // Arrow keys type in the custom fraction instead of changing items.
  await claimSheet(alice, "Yogurt").getByLabel("Custom fraction", { exact: true }).click();
  await alice.keyboard.press("ArrowLeft");
  await expect(claimSheet(alice, "Yogurt").getByLabel("Custom fraction", { exact: true })).toBeFocused();
  // Moving to another item by hand cancels the advance picked on the one before.
  await itemOption(alice, "1/2 · $0.50", "Yogurt").click();
  await navButton("Previous item", "Yogurt").click();
  await alice.clock.runFor(700);
  await expect(claimSheet(alice, "Taken rice")).toContainText("0/1 available to you");
  await alice.clock.resume();
  await expect(claimSheet(alice, "Taken rice").locator("[aria-live]")).toHaveText("Taken rice, item 2 of 3");
  // Arrow keys keep working after the focused portion button is replaced by the next item.
  await navButton("Previous item", "Taken rice").click();
  await itemOption(alice, "1/2 · $0.50", "Bananas").focus();
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

  const conflictDraftId = randomUUID();
  const conflictItem = { id: randomUUID(), name: "Conflict item", originalText: "CONFLICT ITEM", quantity: "1", amountCents: 100, discountCents: 0, taxable: false, finalCents: 100, manualFinal: false };
  const conflictDraft = (await api(`/groups/${group.id}/receipt-drafts/${conflictDraftId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Concurrent claims", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 100, ownShareCents: 0, participantIds: [memberIds.Alice, memberIds.Bob],
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

  // #154: per-person bars, over-allocation and per-item review, seen by Carol while Bob claims
  // and Alice edits the bill elsewhere.
  const reviewItems = [["Oat milk", 898], ["Bread", 600], ["Eggs", 600], ["Cheese", 600]].map(([name, cents]) => ({ id: randomUUID(), name, originalText: name.toUpperCase(), quantity: "1", amountCents: cents, discountCents: 0, taxable: false, finalCents: cents, manualFinal: false }));
  const [oatMilk, bread, eggs, cheese] = reviewItems;
  const reviewDraftId = randomUUID();
  const reviewDraft = (await api(`/groups/${group.id}/receipt-drafts/${reviewDraftId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Claim review", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 2698, ownShareCents: 0, participantIds: [memberIds.Alice, memberIds.Bob, memberIds.Carol],
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
  await itemOption(reviewer, "1/3 · $2.00", "Eggs").click();
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
  await itemOption(reviewer, "1/3 · $1.67", "Syrup").click();
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
      notes: "", totalCents: 1200, ownShareCents: 0, participantIds: [memberIds.Alice, memberIds.Bob, memberIds.Carol],
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
    const { claimReview, reviewedFor } = await import("/src/play/claim-review.ts");
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
  await mkdir("/tmp/share-tally-receipt-smoke", { recursive: true });
  await carol.screenshot({
    path: "/tmp/share-tally-receipt-smoke/mobile.png",
    fullPage: true,
  });
  await alice.screenshot({
    path: "/tmp/share-tally-receipt-smoke/desktop.png",
    fullPage: true,
  });
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
    alice.getByRole("button", { name: "Choose file", exact: true }),
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
  await alice.getByRole("button", { name: "Choose file", exact: true }).click();
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
  await expect(observer.getByRole("heading", { name: "Start with your receipt" })).toBeVisible();
  await observer.getByRole("button", { name: "Back to group" }).click();
  await expect(observer).toHaveURL(groupRoute);
  await expect(processingDraftRow()).toContainText("Checking names & tax…");
  await processingDraftRow().getByRole("button", { name: "Continue", exact: true }).click();
  await expect(observer.getByRole("heading", { name: "Check your items" })).toBeVisible();
  const processingTitle = "Naming items and checking tax…";
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
  const lockedInitiation = await fetch(`http://127.0.0.1:${port}/api/receipt-drafts/${scannedDraft.id}/initialize`, {
    method: "POST", headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" },
    body: JSON.stringify({ revision: scannedDraft.revision }),
  });
  assert.equal(lockedInitiation.status, 409, "A processing draft cannot be initiated");
  // Both already-open review pages must update over the group stream, without a reload.
  child.send("release-model");
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
  child.send("release-model");
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
  await expectWizardActionInViewport("Receipt", "Start with your receipt");
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
      timeZone: "America/Toronto", notes: "", totalCents: 3000, ownShareCents: 0,
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
      timeZone: "America/Toronto", notes: "", totalCents: 3000, ownShareCents: 0,
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
        timeZone: "America/Toronto", notes: "", totalCents: 3300, ownShareCents: 0,
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
      notes: "", totalCents: 400, ownShareCents: 0, participantIds: [memberIds.Alice], items,
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
  // Legacy initiated bills keep editable per-item components and add/delete controls.
  // Only fixture setup uses SQL: these bills predate stored receipt summaries.
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    const draftId = randomUUID();
    const ownerId = (await api(`/bills/${billId}`)).bill.initiatorId;
    const items = [
      { name: "Legacy apples", amountCents: 1000 },
      { name: "Historical cost", amountCents: 200 },
      { name: "Legacy override", amountCents: 100 },
    ].map(item => ({ ...item, id: randomUUID(), originalText: item.name.toUpperCase(), quantity: "1", discountCents: 0, finalCents: item.amountCents, manualFinal: false }));
    const draft = (await api(`/groups/${group.id}/receipt-drafts/${draftId}`, "alice-token", "PUT", {
      revision: 0, data: { mode: "items", title: `Legacy corrections ${viewport.width}`, purchaseDate: "2026-09-24", timeZone: "America/Toronto",
        notes: "", totalCents: 1300, ownShareCents: 0, participantIds: [ownerId], items },
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
  // Post-initiation correction uses the same row and editor sheet on both widths.
  // A stored receipt freezes the tax base: only the edited item is repriced.
  const correctionDraftId = randomUUID();
  const initiatorId = (await api(`/bills/${billId}`)).bill.initiatorId;
  const correctionItems = [
    { id: randomUUID(), name: "Taxable pears", originalText: "PEARS RECEIPT LINE", quantity: "1", amountCents: 1000, discountCents: 0, taxable: true, finalCents: 1000, manualFinal: false },
    { id: randomUUID(), name: "Bread", originalText: "BREAD RECEIPT LINE", quantity: "1", amountCents: 2000, discountCents: 0, taxable: false, finalCents: 2000, manualFinal: false },
  ];
  const correctionDraft = (await api(`/groups/${group.id}/receipt-drafts/${correctionDraftId}`, "alice-token", "PUT", {
    revision: 0,
    data: {
      mode: "items", title: "Frozen rate correction", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
      notes: "", totalCents: 2910, ownShareCents: 0, participantIds: [initiatorId],
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
      notes: "", totalCents: 2730, ownShareCents: 0, participantIds: [initiatorId],
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
      notes: "", totalCents: 305, ownShareCents: 0, participantIds: [initiatorId],
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
    child.send("release-model");
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
  await alice.getByLabel("Your share (CAD)", { exact: true }).fill("1.00");
  await alice
    .getByRole("button", { name: "Share bill", exact: true })
    .click();
  await expect(
    alice.getByText("Complete and final.", { exact: false }),
  ).toBeVisible();
  assert.equal(
    (await api(`/bills/${alice.url().split("/").at(-1)}`)).bill.mode,
    "manual",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Receipt browser smoke passed: private draft recovery, saved automatic scans, processing locks, processing draft status and read-only editors, live ready banners and dismissals, desktop/mobile fallback tax filters and confirmations, second-tab completion, confidence badges, filter counts, confirmation and reload on desktop/mobile, compact rows, editor navigation, live reconciliation and summary edits, signed-cent allocation, photo zoom on desktop/mobile, exact thirds, claim-all/preset/custom buttons, item filters, disabled overclaims, concurrent availability conflicts, legacy price/tax/adjustment edits and add/delete controls, historical and manual provenance, frozen-rate corrections and manual overrides, taxability and tax-inclusive previews, reservations, completion and adjustment.",
  );
} catch (error) {
  if (networkChangeFailures.size) {
    console.error(
      "Browser resource loading was interrupted by ERR_NETWORK_CHANGED. Host network changes, including concurrent Docker container startup/shutdown, can leave the app blank before UI assertions run. Run browser smoke separately from container-changing jobs; the assertion still fails.",
    );
    console.error(
      "Affected resource samples:",
      [...networkChangeFailures.entries()].slice(0, 8),
    );
  }
  if (browser) {
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        console.error(
          "Failed browser page:",
          page.url(),
          (await page.locator("body").innerText()).slice(0, 3000),
        );
      }
  }
  console.error("Browser errors:", errors);
  throw error;
} finally {
  await browser?.close();
  await vite?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.kill("SIGTERM");
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }
  await pool?.end();
  await container?.stop();
}
