// Run after installing both client and server dependencies and Chromium:
// cd client && pnpm exec playwright install chromium && pnpm test:receipts
// Real UI + Express + temporary PostgreSQL. Clerk and receipt providers are replaced; this does
// not verify Google OAuth, production credentials, or session lifetime.
import assert from "node:assert/strict";
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
      10_000,
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
  await expect(alice.getByLabel("Item name", { exact: true })).toHaveValue("Apples");
  assert.equal((await api(`/groups/${group.id}/receipt-drafts`)).drafts.length, 0);
  await alice.getByRole("button", { name: "Back to group" }).click();
  await expect(alice.getByRole("heading", { name: "Discard unsaved changes?" })).toBeVisible();
  await alice.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(alice).toHaveURL(groupRoute);
  assert.equal((await api(`/groups/${group.id}/receipt-drafts`)).drafts.length, 0);
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
    .getByRole("button", { name: "+ Add an item", exact: true })
    .click();
  const quantityBox = await alice.getByLabel("Quantity", { exact: true }).boundingBox();
  const finalBox = await alice.getByLabel("Final cost · CAD", { exact: true }).boundingBox();
  assert.ok(Math.abs(quantityBox.y - finalBox.y) < 2, "Quantity and empty Final cost inputs must align despite validation text");
  const taxBox = await alice.getByRole("checkbox", { name: "Taxable", exact: true }).boundingBox();
  assert.ok(taxBox.width <= 24, "Tax checkbox must not inherit full-width input styling");
  await alice.getByLabel("Item name", { exact: true }).fill("Apples");
  await alice.getByText("Original text & price details").click();
  await alice.getByLabel("Printed amount", { exact: true }).fill("3.00");
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
  await expect(alice.getByLabel("Item name", { exact: true })).toHaveValue(
    "Apples",
  );
  await expect(
    alice.getByLabel("Final cost · CAD", { exact: true }),
  ).toHaveValue("3.00");
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
  await alice.getByLabel("Final cost · CAD", { exact: true }).fill("2.70");
  await alice
    .getByRole("button", { name: "Save item changes", exact: true })
    .click();
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
  await chooser.setFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: image,
  });
  await alice
    .getByRole("button", { name: "Use this photo", exact: true })
    .click();
  // Extraction succeeds automatically after the crop; the failed-scan retry was covered above.
  await expect(alice.getByRole("heading", { name: "Check your items" })).toBeVisible();
  await expect(alice.getByLabel("Item name", { exact: true })).toHaveValue(
    "Apples",
  );
  await alice
    .getByText("Tax, discounts & receipt adjustments", { exact: true })
    .click();
  await expect(alice.getByRole("checkbox", { name: "Taxable", exact: true })).toBeChecked();
  await alice.getByLabel("Receipt tax", { exact: true }).fill("0.30");
  await alice
    .getByRole("button", {
      name: "Apply adjustments to final costs",
      exact: true,
    })
    .click();
  await expect(
    alice.getByLabel("Final cost · CAD", { exact: true }),
  ).toHaveValue("3.30");
  await alice.getByLabel("Receipt tax", { exact: true }).fill("");
  await alice
    .getByRole("button", {
      name: "Apply adjustments to final costs",
      exact: true,
    })
    .click();
  await expect(
    alice.getByLabel("Final cost · CAD", { exact: true }),
  ).toHaveValue("3.00");
  await alice.getByLabel("Receipt tax", { exact: true }).fill("0.30");
  await alice.getByLabel("Printed prices include tax", { exact: true }).check();
  await alice
    .getByRole("button", {
      name: "Apply adjustments to final costs",
      exact: true,
    })
    .click();
  await expect(
    alice.getByLabel("Final cost · CAD", { exact: true }),
  ).toHaveValue("3.00");
  await alice.getByLabel("Receipt discount", { exact: true }).fill("0.30");
  await alice
    .getByRole("button", {
      name: "Apply adjustments to final costs",
      exact: true,
    })
    .click();
  await expect(
    alice.getByLabel("Final cost · CAD", { exact: true }),
  ).toHaveValue("2.70");
  await alice.getByRole("checkbox", { name: "Taxable", exact: true }).uncheck();
  await alice.getByLabel("Final cost · CAD", { exact: true }).fill("2.80");
  await alice.getByRole("button", { name: "Save draft & close" }).click();
  await expect(alice.locator(".draft-list-row").filter({ hasText: "Scanned receipt" })).toBeVisible();
  const savedScan = (await api(`/groups/${group.id}/receipt-drafts`)).drafts.find(d => d.data.title === "Scanned receipt");
  const savedPhoto = (await pool.query('SELECT base64 FROM receipt_photos WHERE draft_id = $1', [savedScan.id])).rows[0].base64;
  await alice.locator(".draft-list-row").filter({ hasText: "Scanned receipt" }).getByRole("button", { name: "Continue", exact: true }).click();
  await alice.getByRole("button", { name: "Replace receipt photo", exact: true }).click();
  await alice.getByLabel("Choose a receipt image").setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: temporaryPhoto });
  await alice.getByRole("button", { name: "Use this photo", exact: true }).click();
  await expect(alice.getByRole("heading", { name: "Check your items" })).toBeVisible();
  await alice.getByRole("button", { name: "Back to group" }).click();
  await alice.getByRole("button", { name: "Discard changes", exact: true }).click();
  assert.equal((await pool.query('SELECT base64 FROM receipt_photos WHERE draft_id = $1', [savedScan.id])).rows[0].base64, savedPhoto);
  assert.deepEqual((await api(`/receipt-drafts/${savedScan.id}`)).draft.data, savedScan.data);
  await alice.locator(".draft-list-row").filter({ hasText: "Scanned receipt" }).getByRole("button", { name: "Continue", exact: true }).click();
  await stepButton("Items").click();
  await alice.reload();
  await expectNewBillRoute(savedScan.id);
  await expect(alice.getByRole("heading", { name: "Check your items" })).toBeVisible();
  await expect(
    alice.getByLabel("Final cost · CAD", { exact: true }),
  ).toHaveValue("2.80");
  await expect(alice.getByRole("checkbox", { name: "Taxable", exact: true })).not.toBeChecked();
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
  await alice
    .getByText("Original text & price details", { exact: true })
    .click();
  await alice.locator(".receipt-original").evaluate((el) => {
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
  assert.ok(await alice.evaluate(() => window.scrollY > 0));
  assert.ok(
    await alice
      .getByLabel("Final cost · CAD", { exact: true })
      .evaluate((input) => parseFloat(getComputedStyle(input).fontSize) >= 16),
  );

  await alice.setViewportSize({ width: 390, height: 844 });
  await expectNewBillRoute(savedScan.id);
  assert.equal(
    await alice.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await alice.screenshot({
    path: "/tmp/share-tally-receipt-smoke/mobile-editor.png",
    fullPage: true,
  });
  await alice.setViewportSize({ width: 1280, height: 1000 });
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
  // The guided entry still supports switching an unfinished receipt to manual shares.
  await alice.goto(`${base}#/group-bills/${group.id}`);
  await alice.getByRole("button", { name: "New bill", exact: true }).click();
  await alice
    .getByRole("button", { name: "Enter items myself", exact: true })
    .click();
  await alice
    .getByRole("button", { name: "+ Add an item", exact: true })
    .click();
  await alice.getByLabel("Item name", { exact: true }).fill("Free sample");
  await alice
    .getByText("Original text & price details", { exact: true })
    .click();
  await alice.getByLabel("Printed amount", { exact: true }).fill("0.00");
  await alice.getByLabel("Item name", { exact: true }).press("Enter");
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
    "Receipt browser smoke passed: private draft recovery, item entry, exact thirds, mobile claims, price correction, reservations, reconfirmation, automatic completion and adjustment.",
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
