// PROTOTYPE — throwaway. Boots the real UI against a temporary PostgreSQL with a seeded bill so
// the claim-option variants (?variant=A..E) can be compared inside the real claim sheet.
// Run: cd client && pnpm prototype:claim-options   (Ctrl+C tears everything down)
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { PostgreSqlContainer } = serverRequire("@testcontainers/postgresql");
const { Pool } = serverRequire("pg");
const { drizzle } = serverRequire("drizzle-orm/node-postgres");
const { migrate } = serverRequire("drizzle-orm/node-postgres/migrator");
const sharp = serverRequire("sharp");
const clientRoot = fileURLToPath(new URL("../", import.meta.url));
const serverRoot = fileURLToPath(new URL("../../server/", import.meta.url));
const host = process.env.PROTOTYPE_HOST ?? "dev-2a1m";

const container = await new PostgreSqlContainer("postgres:17.6-alpine").start();
const pool = new Pool({ connectionString: container.getConnectionUri() });
await migrate(drizzle(pool), { migrationsFolder: `${serverRoot}/drizzle` });
await pool.end();
const child = fork(`${serverRoot}/test/server-process.ts`, {
  cwd: serverRoot,
  execArgv: ["--import=tsx"],
  env: { PATH: process.env.PATH, DATABASE_URL: container.getConnectionUri() },
  stdio: ["ignore", "inherit", "inherit", "ipc"],
});
const port = await new Promise((resolve) => child.once("message", resolve));
async function api(path, token = "alice-token", method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${await response.text()}`);
  return response.json();
}

const { group } = await api("/groups", "alice-token", "POST", { name: "Costco run", icon: { type: "unicode", value: "🛒" } });
const invitation = await api(`/groups/${group.id}/invitation`);
for (const token of ["bob-token", "carol-token"])
  await api("/groups/join", token, "POST", { token: invitation.path.split("/").at(-1) });
const memberIds = Object.fromEntries((await api(`/groups/${group.id}`)).group.members.map((m) => [m.displayName, m.id]));

// A receipt-looking photo whose SWIFFER line is the located region.
const lines = [
  "1424970 CROISSANT      6.99 H", "0003091701 / 1424970   1.50-H", "1988622 TOWELS        23.99 H",
  "0000389132 / 1988622   4.00-H", "3380446 SWIFFER WET   27.94 H", "31576 PUR WATER       15.85",
  "22390 PURE CAFE        8.38", "55504 SPRING WATER     4.19", "55506 B/S THIGHS     30.52",
];
const width = 600, lineHeight = 44, top = 60;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${top * 2 + lines.length * lineHeight}">
  <rect width="100%" height="100%" fill="#f4f1e8"/>
  ${lines.map((line, i) => `<text x="40" y="${top + (i + 1) * lineHeight - 12}" font-family="monospace" font-size="26" fill="#333">${line}</text>`).join("")}
</svg>`;
const photo = await sharp(Buffer.from(svg)).png().toBuffer();
const swifferTop = top + 4 * lineHeight;
const pages = [{ pageNumber: 1, width, height: top * 2 + lines.length * lineHeight, unit: "pixel" }];

const item = (name, originalText, cents) => ({
  id: randomUUID(), name, originalText, quantity: "1", amountCents: cents, discountCents: 0,
  taxable: false, finalCents: cents, manualFinal: false,
});
const items = [
  item("Swiffer Wet", "3380446 SWIFFER WET 24.99 H", 2794),
  item("Kirkland paper towels", "1988622 TOWELS 23.99 H", 2399),
  item("Rotisserie chicken", "87745 ROTIS CHKN 7.99", 799),
  item("Croissants", "1424970 CROISSANT 6.99 H", 699),
];
const total = items.reduce((a, i) => a + i.finalCents, 0);
const draftId = randomUUID();
const data = {
  mode: "items", title: "Costco — Sept 27", purchaseDate: "2026-09-27", timeZone: "America/Toronto",
  notes: "", totalCents: total, ownShareCents: 0,
  participantIds: [memberIds.Alice, memberIds.Bob, memberIds.Carol],
  receipt: { subtotalCents: total, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
  items,
};
const { draft: first } = await api(`/groups/${group.id}/receipt-drafts/${draftId}`, "alice-token", "PUT", {
  revision: 0, data, photoBase64: photo.toString("base64"),
});
const { draft } = await api(`/groups/${group.id}/receipt-drafts/${draftId}`, "alice-token", "PUT", {
  revision: first.revision,
  data: {
    ...data,
    receipt: { ...data.receipt, evidence: { pages } },
    items: [{ ...items[0], evidence: { regions: [{ pageNumber: 1, polygon: [30, swifferTop, 570, swifferTop, 570, swifferTop + lineHeight, 30, swifferTop + lineHeight] }] } }, ...items.slice(1)],
  },
});
let bill = (await api(`/receipt-drafts/${draftId}/initialize`, "alice-token", "POST", { revision: draft.revision })).bill;
// Others already hold part of some items, so the variants show their unavailable states.
bill = (await api(`/bills/${bill.id}/claims`, "bob-token", "POST", { revision: bill.revision, claims: [{ itemId: items[1].id, numerator: 1, denominator: 2 }, { itemId: items[2].id, numerator: 1, denominator: 3 }] })).bill ?? (await api(`/bills/${bill.id}`)).bill;
bill = (await api(`/bills/${bill.id}`)).bill;
await api(`/bills/${bill.id}/claims`, "carol-token", "POST", { revision: bill.revision, claims: [{ itemId: items[2].id, numerator: 1, denominator: 3 }] });

const vite = await createServer({
  root: clientRoot,
  configFile: false,
  envDir: false,
  cacheDir: `${clientRoot}/node_modules/.vite-prototype`,
  define: { "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify("test-only-clerk-boundary") },
  plugins: [
    {
      name: "prototype-clerk",
      enforce: "pre",
      resolveId(id) { if (id === "@clerk/react") return `${clientRoot}/test/clerk.tsx`; },
      // Sign in as Alice automatically.
      transformIndexHtml: (html) => html.replace("<head>", `<head><script>localStorage.getItem("smoke-token") || localStorage.setItem("smoke-token", "alice-token")</script>`),
    },
    react(),
  ],
  optimizeDeps: { exclude: ["@clerk/react"] },
  server: { host: "0.0.0.0", allowedHosts: true, port: 5180, proxy: { "/api": `http://127.0.0.1:${port}` } },
});
await vite.listen();
const vitePort = vite.config.server.port;
const actual = vite.httpServer.address().port ?? vitePort;
console.log(`\nPROTOTYPE ready: http://${host}:${actual}/?variant=A#/bills/${bill.id}\n  Open an item (e.g. Swiffer Wet) and flip variants with the pill or ←/→.\n`);

async function shutdown() {
  await vite.close();
  child.kill();
  await container.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
