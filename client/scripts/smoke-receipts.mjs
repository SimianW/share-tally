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
  const claimSheet = (page, name = "Apples") => page.getByRole("dialog", { name, exact: true });
  const itemOption = (page, label, name = "Apples") => claimSheet(page, name).getByRole("button", { name: label, exact: true });
  await alice.getByRole("button", { name: "View Apples · $3.00", exact: true }).click();
  await expect(claimSheet(alice)).toBeVisible();
  await expect(claimSheet(alice)).toContainText("Printed price");
  await expect(claimSheet(alice)).toContainText("Receipt discount share");
  await expect(claimSheet(alice)).toContainText("Tax share");
  await expect(claimSheet(alice)).toContainText("Other adjustments share");
  await itemOption(alice, "All of it · $3.00").click();
  await expect(itemOption(alice, "All of it · $3.00")).toHaveAttribute("aria-pressed", "true");
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $3.00");
  await itemOption(alice, "1/2 · $1.50").click();
  await itemOption(alice, "Custom").click();
  await alice.getByLabel("Custom fraction", { exact: true }).fill("4/5");
  await itemOption(alice, "Use custom fraction").click();
  await expect(itemOption(alice, "Custom · 4/5 · $2.40")).toHaveAttribute("aria-pressed", "true");
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $2.40");
  await itemOption(alice, "1/3 · $1.00").click();
  await expect(itemOption(alice, "1/3 · $1.00")).toHaveAttribute("aria-pressed", "true");
  await expect(itemOption(alice, "Custom · 4/5 · $2.40")).toHaveAttribute("aria-pressed", "false");
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $1.00");
  await expect.poll(async () => (await api(`/bills/${billId}`)).bill.items[0].claims.length).toBe(0);
  await claimSheet(alice).getByRole("button", { name: "Close claim", exact: true }).click();
  await alice.getByRole("button", { name: "Receipt summary", exact: true }).click();
  await expect(alice.getByRole("dialog", { name: "Receipt summary", exact: true })).toBeVisible();
  await alice.getByRole("button", { name: "Done", exact: true }).click();
  await alice.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect(alice.locator(".claim-list .receipt-row-badges").first()).toContainText("Your claim");
  const bob = await pageFor("bob-token", { width: 390, height: 844 });
  await bob.goto(`${base}#/bills/${billId}`);
  await bob.getByRole("button", { name: "View Apples · $3.00", exact: true }).click();
  await itemOption(bob, "1/3 · $1.00").click();
  await claimSheet(bob).getByRole("button", { name: "Close claim", exact: true }).click();
  await bob.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect(bob.locator(".claim-list .receipt-row-badges").first()).toContainText("Your claim");
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
  await expect(bob.locator(".claim-list .receipt-row-badges").first()).toContainText("Your reservation · reconfirm");
  await expect(alice.locator(".claim-list .receipt-row-badges").first()).toContainText("Your reservation · reconfirm");
  await bob
    .getByRole("button", { name: "I have reviewed the latest bill" })
    .click();
  await bob.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect(bob.locator(".claim-list .receipt-row-badges").first()).toContainText("Your claim");
  await alice
    .getByRole("button", { name: "I have reviewed the latest bill" })
    .click();
  await alice.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect(alice.locator(".claim-list .receipt-row-badges").first()).toContainText("Your claim");
  const carol = await pageFor("carol-token", { width: 390, height: 844 });
  await carol.goto(`${base}#/bills/${billId}`);
  await carol.getByRole("button", { name: "View Apples · $2.70", exact: true }).click();
  await itemOption(carol, "1/3 · $0.90").click();
  await claimSheet(carol).getByRole("button", { name: "Close claim", exact: true }).click();
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
  // Exercise portion controls, disabled overclaims, and a concurrent last-fraction conflict.
  const members = (await api(`/groups/${group.id}`)).group.members;
  const memberIds = Object.fromEntries(members.map((member) => [member.displayName, member.id]));
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
    revision: controlBill.revision,
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
  for (const option of ["1/3 · $1.00", "1/4 · $0.75", "1/5 · $0.60", "1/6 · $0.50"])
    await expect(itemOption(alice, option)).toBeEnabled();
  await itemOption(alice, "Custom").click();
  await alice.getByLabel("Custom fraction", { exact: true }).fill("1/4");
  await itemOption(alice, "Use custom fraction").click();
  const customChoice = () => itemOption(alice, "Custom · 1/4 · $0.75");
  await expect(customChoice()).toHaveAttribute("aria-pressed", "true");
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $0.75");
  await itemOption(alice, "1/3 · $1.00").click();
  await expect(itemOption(alice, "1/3 · $1.00")).toHaveAttribute("aria-pressed", "true");
  await expect(customChoice()).toHaveAttribute("aria-pressed", "false");
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $1.00");
  await claimSheet(alice).getByRole("button", { name: "Close claim", exact: true }).click();
  await alice.getByRole("button", { name: "View Milk · $2.00", exact: true }).click();
  await itemOption(alice, "All of it · $2.00", "Milk").click();
  await expect(alice.locator(".claim-sticky-footer")).toContainText("Your share $3.00");
  await claimSheet(alice, "Milk").getByRole("button", { name: "Close claim", exact: true }).click();
  await alice.getByRole("button", { name: "Confirm my item claims" }).click();
  await expect.poll(async () => (await api(`/bills/${controlBill.id}`)).bill.items[1].claims.length).toBe(1);
  const confirmedControls = (await api(`/bills/${controlBill.id}`)).bill;
  assert.deepEqual(confirmedControls.items.map((item) => item.claims
    .map((claim) => [claim.userId, claim.numerator, claim.denominator])
    .sort(([left], [right]) => left.localeCompare(right))), [
    [[memberIds.Alice, 1, 3], [memberIds.Bob, 2, 3]].sort(([left], [right]) => left.localeCompare(right)),
    [[memberIds.Alice, 1, 1]],
  ]);

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
    await claimSheet(page, "Conflict item").getByRole("button", { name: "Close claim", exact: true }).click();
  }
  await Promise.all([
    alice.getByRole("button", { name: "Confirm my item claims" }).click(),
    bob.getByRole("button", { name: "Confirm my item claims" }).click(),
  ]);
  await expect.poll(async () => (await api(`/bills/${conflictBill.id}`)).bill.items[0].claims.length).toBe(1);
  const conflictResult = (await api(`/bills/${conflictBill.id}`)).bill;
  assert.equal(conflictResult.items[0].claims.length, 1);
  const conflictLoser = conflictResult.items[0].claims[0].userId === memberIds.Alice ? bob : alice;
  const conflictAlert = conflictLoser.getByRole("alert").filter({ hasText: "Not enough of Conflict item is available" });
  await expect(conflictAlert).toContainText("Only 0/1 is currently available to you");
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
  await expect(alice.getByRole("button", { name: "Continue to sharing" })).toBeEnabled();
  await alice.getByRole("button", { name: "Continue to sharing" }).click();
  await expect(alice.getByRole("button", { name: "Initiate bill", exact: true })).toBeDisabled();
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
    await alice.setViewportSize(viewport);
    await alice.goto(`${newBillRoute}/${draftId}`);
    await stepButton("Items").click();
    const row = name => alice.getByRole("button", { name: `Edit ${name}`, exact: true, includeHidden: true });
    await expect(row("Apples")).toContainText("10.00");
    await expect(reconciliation()).toContainText("Matches receipt");
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
  // Unassigned receipt tax blocks initiation at desktop and mobile widths.
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
    await stepButton("People").click();
    await alice.getByRole("button", { name: "Select everyone", exact: true }).click();
    await expect(alice.getByText(/Receipt tax \$3\.00 isn't assigned to any item/)).toBeVisible();
    await expect(alice.getByRole("button", { name: "Initiate bill", exact: true })).toBeDisabled();
    await stepButton("Items").click();
    await row("Apples").click();
    await alice.getByRole("checkbox", { name: "Taxable", exact: true }).check();
    await alice.getByRole("button", { name: "Close editor", exact: true }).click();
    await stepButton("People").click();
    await expect(alice.getByText(/Receipt tax \$3\.00 isn't assigned to any item/)).toHaveCount(0);
    await expect(alice.getByRole("button", { name: "Initiate bill", exact: true })).toBeEnabled();
    await alice.getByRole("button", { name: "Initiate bill", exact: true }).click();
    await expect(alice.getByRole("heading", { name: "Items & claims" })).toBeVisible();
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
  await alice.goto(`${base}#/bills/${correctionBill.id}`);
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
  // A failed check retains Azure names and flags every affected row. Exercise the
  // processing-to-fallback stream update, filter and two ways to clear a marker at both widths.
  await waitForServer("allocation-receipt-ready", "allocation-receipt");
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    await alice.setViewportSize(viewport);
    await alice.goto(groupRoute);
    await alice.getByRole("button", { name: "New bill", exact: true }).click();
    await stepButton("People").click();
    await alice.getByLabel("Bill title", { exact: true }).fill(`Fallback review ${viewport.width}`);
    await stepButton("Receipt").click();
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
    await expect(alice.getByRole("button", { name: "Initiate bill", exact: true })).toBeEnabled();
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
    await expect(alice.getByText("Missing price", { exact: true })).toBeVisible();
    await expect(alice.getByRole("button", { name: "Needs check (1)" })).toBeVisible();
    await alice.getByLabel("Item name", { exact: true }).fill("Manual orange");
    await alice.getByLabel("Printed price", { exact: true }).fill("1.00");
    await alice.getByRole("button", { name: "Done", exact: true }).click();
    await expect(alice.getByRole("button", { name: "Needs check (0)" })).toBeVisible();
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
