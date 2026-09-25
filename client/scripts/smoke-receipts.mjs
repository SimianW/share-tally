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
  await alice.getByRole("button", { name: "Back to group" }).click();
  await expect(alice).toHaveURL(groupRoute);
  await alice.getByRole("button", { name: `Delete ${retryDrafts[0].data.title || "untitled bill"}`, exact: true }).click();
  await alice.getByRole("button", { name: "Delete draft", exact: true }).click();
  await expect.poll(async () => (await api(`/groups/${group.id}/receipt-drafts`)).drafts.length).toBe(0);
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
  await alice.getByRole("button", { name: "Split by amounts instead" }).click();
  await expect(alice.getByRole("heading", { name: "Who’s sharing this bill?" })).toBeVisible();
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
    .getByLabel("Actual paid total · CAD", { exact: true })
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
    .getByRole("button", { name: "Initiate bill", exact: true })
    .click();
  await expect(
    alice.getByRole("heading", { name: "Items & claims" }),
  ).toBeVisible();
  const billId = alice.url().split("/").at(-1);
  await alice
    .getByLabel("Your fraction of Apples", { exact: true })
    .fill("1/3");
  await alice.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect(
    alice.getByText("Alice: 1/3 · Confirmed", { exact: true }),
  ).toBeVisible();
  const bob = await pageFor("bob-token", { width: 390, height: 844 });
  await bob.goto(`${base}#/bills/${billId}`);
  await bob.getByLabel("Your fraction of Apples", { exact: true }).fill("1/3");
  await bob.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect(
    bob.getByText("Bob: 1/3 · Confirmed", { exact: true }),
  ).toBeVisible();
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
  await alice.getByRole("button", { name: "Save item changes", exact: true }).click();
  await expect.poll(async () => (await api(`/bills/${billId}`)).bill.items[0].amountCents).toBe(270);
  const corrected = (await api(`/bills/${billId}`)).bill.items[0];
  assert.equal(corrected.amountCents, 270);
  assert.equal(corrected.finalCents, 270);
  assert.equal(corrected.manualFinal, false);
  await expect(
    bob.getByText("Bob: 1/3 · Reserved, needs reconfirmation", { exact: true }),
  ).toBeVisible();
  await bob
    .getByRole("button", { name: "I have reviewed the latest bill" })
    .click();
  await bob.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect(
    bob.getByText("Bob: 1/3 · Confirmed", { exact: true }),
  ).toBeVisible();
  await alice
    .getByRole("button", { name: "I have reviewed the latest bill" })
    .click();
  await alice.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect(
    alice.getByText("Alice: 1/3 · Confirmed", { exact: true }),
  ).toBeVisible();
  const carol = await pageFor("carol-token", { width: 390, height: 844 });
  await carol.goto(`${base}#/bills/${billId}`);
  await carol
    .getByLabel("Your fraction of Apples", { exact: true })
    .fill("1/3");
  await carol.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect(
    carol.getByText("Completed bills are final.", { exact: false }),
  ).toBeVisible();
  assert.equal((await api(`/bills/${billId}`)).bill.adjustmentCents, 40);
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
  await alice.goto(`${base}#/group-bills/${group.id}`);
  await alice.getByRole("button", { name: "New bill", exact: true }).click();
  await stepButton("People").click();
  await alice.getByLabel("Bill title", { exact: true }).fill("Scanned receipt");
  await stepButton("Receipt").click();
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
  await observer.goto(`${base}#/group-bills/${group.id}`);
  await observer.locator(".draft-list-row").filter({ hasText: "Scanned receipt" })
    .getByRole("button", { name: "Continue", exact: true }).click();
  await expect(observer.getByRole("heading", { name: "Check your items" })).toBeVisible();
  await expect(alice.getByText("Checking names and tax", { exact: true }).first()).toBeVisible();
  await expect(observer.getByText("Checking names and tax", { exact: true }).first()).toBeVisible();
  const lockedRow = alice.locator(".receipt-row-open").first();
  await expect(lockedRow).toBeDisabled();
  await expect(observer.locator(".receipt-row-open").first()).toBeDisabled();
  await expect(alice.getByRole("button", { name: "Add an item", exact: true })).toBeDisabled();
  await expect(alice.getByRole("button", { name: "Continue to sharing" })).toBeDisabled();
  await expect(observer.getByRole("button", { name: "Continue to sharing" })).toBeDisabled();
  await expect(alice.getByRole("button", { name: "Save draft & close" })).toBeDisabled();
  await alice.getByRole("button", { name: /Receipt summary|Off by|Matches receipt/ }).filter({ hasText: /Items/ }).click();
  await expect(alice.getByLabel("Receipt tax", { exact: true })).toBeDisabled();
  await alice.getByRole("button", { name: "Close summary", exact: true }).click();
  await expect(alice.getByRole("button", { name: "Replace receipt photo" })).toBeDisabled();
  await expect(stepButton("People")).toBeDisabled();
  const lockedInitiation = await fetch(`http://127.0.0.1:${port}/api/receipt-drafts/${scannedDraft.id}/initialize`, {
    method: "POST", headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" },
    body: JSON.stringify({ revision: scannedDraft.revision }),
  });
  assert.equal(lockedInitiation.status, 409, "A processing draft cannot be initiated");
  await alice.setViewportSize({ width: 390, height: 844 });
  await expect(alice.locator(".receipt-row-open").first()).toBeDisabled();
  assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await alice.setViewportSize({ width: 1280, height: 1000 });
  child.send("release-model");
  await expect(alice.getByRole("button", { name: "Edit Friendly item 1", exact: true })).toBeEnabled();
  await expect(observer.getByRole("button", { name: "Edit Friendly item 1", exact: true })).toBeEnabled();
  await expect.poll(async () => (await api(`/receipt-drafts/${scannedDraft.id}`)).draft.processingStatus).toBe("ready");
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
  await expect(alice.getByRole("button", { name: "Continue to sharing" })).toBeEnabled();
  await alice.getByRole("button", { name: "Continue to sharing" }).click();
  await expect(alice.getByRole("button", { name: "Initiate bill", exact: true })).toBeEnabled();
  await stepButton("Items").click();
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
  await expect(replacementObserver.locator(".receipt-row-open").first()).toBeDisabled();
  await expect(replacementObserver.getByRole("button", { name: "Continue to sharing" })).toBeDisabled();
  await expect(alice.locator(".receipt-row-open").first()).toBeDisabled();
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
  assert.ok(
    await alice
      .getByLabel("Final cost · CAD", { exact: true })
      .evaluate((input) => parseFloat(getComputedStyle(input).fontSize) >= 16),
  );

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
    .getByRole("button", { name: "Initiate bill", exact: true })
    .click();
  await alice
    .getByRole("button", { name: "Retry initiation", exact: true })
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
    await api(`/groups/${group.id}/receipt-drafts/${draftId}`, "alice-token", "PUT", {
      revision: 0,
      data: {
        mode: "items", title: `Compact review ${viewport.width}`, purchaseDate: "2026-09-24",
        timeZone: "America/Toronto", notes: "", totalCents: 3000, ownShareCents: 0,
        participantIds: [],
        receipt: { subtotalCents: 3000, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
        items: [item("Apples", 1000, true), item("Milk", 2000, false)],
      },
      photoBase64: image.toString("base64"),
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
      const footerBox = await alice.locator(".receipt-review-footer").boundingBox();
      const navigationBox = await alice.locator(".main-nav").boundingBox();
      assert.ok(footerBox.y + footerBox.height <= navigationBox.y + 1, "Sticky review actions must clear mobile navigation");
    }
    await alice.getByRole("button", { name: "View receipt photo", exact: true }).click();
    const photoDialog = alice.getByRole("dialog", { name: "Receipt photo", exact: true });
    await expect(photoDialog).toBeVisible();
    const photo = photoDialog.getByRole("img");
    const initialPhotoWidth = (await photo.boundingBox()).width;
    await alice.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect.poll(async () => (await photo.boundingBox()).width).toBeGreaterThan(initialPhotoWidth);
    await alice.getByRole("button", { name: "Close photo", exact: true }).click();
    await expect(photoDialog).toHaveCount(0);
    await row("Apples").click();
    const editor = alice.getByRole("dialog", { name: "Edit receipt item", exact: true });
    await expect(editor).toBeVisible();
    await expect(editor).toContainText("APPLES RECEIPT LINE");
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
    await alice.getByRole("button", { name: "Next item", exact: true }).click();
    await expect(alice.getByLabel("Item name", { exact: true })).toHaveValue("Milk");
    await alice.getByRole("button", { name: "Previous item", exact: true }).click();
    await expect(alice.getByLabel("Item name", { exact: true })).toHaveValue("Reviewed apples");
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
      const response = alice.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname === `/api/bills/${legacy.id}/items`);
      await alice.getByRole("button", { name: "Save item changes", exact: true }).click();
      assert.equal((await response).status(), 200);
      await expect(alice.getByRole("button", { name: "Save item changes", exact: true })).toHaveCount(0);
    };
    await open();
    await expect(row("Historical cost")).toContainText("2.75");
    await row("Historical cost").click();
    const sheet = alice.getByRole("dialog", { name: /^Correct (legacy item|item price)$/ });
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
    await sheet.getByLabel("Item name", { exact: true }).fill("Added legacy item");
    await sheet.getByLabel("Printed price", { exact: true }).fill("4.00");
    await expect(sheet.getByLabel("Final cost", { exact: true })).toHaveText("$4.00");
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
  await expect(alice.getByRole("region", { name: "Receipt summary" })).toContainText("HST (13%)");
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    await alice.setViewportSize(viewport);
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
  // A failed background check retains the Azure item and marks tax unchecked.
  await alice.goto(`${base}#/group-bills/${group.id}`);
  await alice.getByRole("button", { name: "New bill", exact: true }).click();
  await waitForServer("holding-model", "hold-model");
  await waitForServer("model-mode-error-ready", "model-mode-error");
  const fallbackModelHeld = waitForServer("model-held");
  await alice.getByLabel("Choose a receipt image").setInputFiles({ name: "fallback.png", mimeType: "image/png", buffer: image });
  await alice.getByRole("button", { name: "Use this photo", exact: true }).click();
  await fallbackModelHeld;
  await expect(alice.getByText("Checking names and tax", { exact: true }).first()).toBeVisible();
  await expect(alice.locator(".receipt-row-open").first()).toBeDisabled();
  child.send("release-model");
  await expect(alice.getByText("Tax not checked", { exact: true }).first()).toBeVisible();
  await expect(alice.getByText("Taxable · not checked", { exact: true })).toBeVisible();
  await expect(alice.locator(".receipt-row-open").first()).toBeEnabled();
  const fallbackId = (await api(`/groups/${group.id}/receipt-drafts`)).drafts.find(d => d.processingStatus === "fallback")?.id;
  assert.ok(fallbackId, "The saved draft should record model fallback");
  const fallbackAzure = (await api(`/receipt-drafts/${fallbackId}`)).draft;
  assert.equal(fallbackAzure.data.items[0].name, "APPLE", "Fallback preserves the Azure description");
  await alice.locator(".receipt-row-open").first().click();
  await expect(alice.getByRole("checkbox", { name: "Taxable", exact: true })).toBeChecked();
  await alice.getByLabel("Item name", { exact: true }).fill("Renamed fallback item");
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(alice.getByText("Taxable · not checked", { exact: true })).toBeVisible();
  await alice.getByRole("button", { name: "Edit Renamed fallback item", exact: true }).click();
  await alice.getByRole("checkbox", { name: "Taxable", exact: true }).uncheck();
  await alice.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(alice.getByText("Taxable · not checked", { exact: true })).toHaveCount(0);
  await alice.getByRole("button", { name: "Save draft & close" }).click();
  await expect(alice).toHaveURL(groupRoute);
  const fallbackDraft = (await api(`/receipt-drafts/${fallbackId}`)).draft;
  assert.equal(fallbackDraft.data.items[0].name, "Renamed fallback item");
  assert.equal(fallbackDraft.data.items[0].taxable, false);
  assert.equal(fallbackDraft.data.items[0].taxNotChecked, false);
  await alice.getByRole("button", { name: `Delete ${fallbackDraft.data.title || "untitled bill"}`, exact: true }).click();
  await alice.getByRole("button", { name: "Delete draft", exact: true }).click();
  await waitForServer("model-mode-ok-ready", "model-mode-ok");
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
    alice.getByRole("button", { name: "Initiate bill", exact: true }),
  ).toBeDisabled();
  await alice.getByLabel("Bill title", { exact: true }).fill("Manual fallback");
  await alice
    .getByLabel("Actual paid total · CAD", { exact: true })
    .fill("1.00");
  // Zero-cost items are valid; a difference does not impose a new approval gate.
  await expect(
    alice.getByRole("button", { name: "Initiate bill", exact: true }),
  ).toBeEnabled();
  await alice.getByLabel("Allocation mode").selectOption("manual");
  await alice.getByLabel("My share · CAD", { exact: true }).fill("1.00");
  await alice
    .getByRole("button", { name: "Initiate bill", exact: true })
    .click();
  await expect(
    alice.getByText("Completed bills are final.", { exact: false }),
  ).toBeVisible();
  assert.equal(
    (await api(`/bills/${alice.url().split("/").at(-1)}`)).bill.mode,
    "manual",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Receipt browser smoke passed: private draft recovery, saved automatic scans, processing locks, second-tab completion and tax fallback, compact rows, editor navigation, live reconciliation and summary edits, signed-cent allocation, photo zoom on desktop/mobile, exact thirds, claims, legacy price/tax/adjustment edits and add/delete controls, historical and manual provenance, frozen-rate corrections and manual overrides, taxability and tax-inclusive previews, reservations, completion and adjustment.",
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
