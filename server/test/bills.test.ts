import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let child: ChildProcess | undefined;
let baseUrl: string;

async function startServer() {
  assert.ok(container);
  // Never read .env or use the developer's DATABASE_URL in this suite.
  const processUnderTest = fork(
    new URL("./server-process.ts", import.meta.url),
    {
      execArgv: ["--import=tsx"],
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: container.getConnectionUri(),
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    },
  );
  child = processUnderTest;
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Test server startup timed out")),
      10_000,
    );
    processUnderTest.once("message", (message) => {
      clearTimeout(timer);
      if (typeof message !== "number") reject(new Error("Invalid server port"));
      else resolve(message);
    });
    processUnderTest.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Test server exited before startup: ${code}`));
    });
    processUnderTest.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopServer() {
  const running = child;
  child = undefined;
  if (!running || running.exitCode !== null || running.signalCode !== null)
    return;
  const exited = once(running, "exit");
  const timer = setTimeout(() => running.kill("SIGKILL"), 5_000);
  running.kill("SIGTERM");
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

before(
  async () => {
    container = await new PostgreSqlContainer("postgres:17.6-alpine").start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    // Apply the committed migration history, rather than creating a test-only schema.
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    await startServer();
  },
  { timeout: 120_000 },
);

after(async () => {
  try {
    await stopServer();
  } finally {
    try {
      await pool?.end();
    } finally {
      await container?.stop();
    }
  }
});

beforeEach(async () => {
  // Clear only this suite's isolated database, including dependent bill tables.
  await pool.query(
    "TRUNCATE TABLE bill_shares, bills, group_members, groups, users",
  );
});

async function api(
  path: string,
  token = "alice-token",
  method = "GET",
  body?: unknown,
) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
}

async function json(response: Response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}

async function create(
  token = "alice-token",
  icon = { type: "unicode", value: "👨‍👩‍👧‍👦" },
) {
  return (
    await json(
      await api("/groups", token, "POST", { name: " Costco ", icon }),
      201,
    )
  ).group;
}

async function setup(all = true) {
  const group = await create();
  const invite = await json(await api(`/groups/${group.id}/invitation`));
  const token = invite.path.split("/").at(-1);
  await json(await api("/groups/join", "bob-token", "POST", { token }));
  if (all)
    await json(await api("/groups/join", "carol-token", "POST", { token }));
  const detail = (await json(await api(`/groups/${group.id}`))).group;
  const ids = Object.fromEntries(
    detail.members.map((m: { displayName: string; id: string }) => [
      m.displayName,
      m.id,
    ]),
  );
  const draft = {
    requestId: crypto.randomUUID(),
    title: " Costco run ",
    purchaseDate: "2026-01-01",
    timeZone: "America/Toronto",
    notes: "Snacks",
    totalCents: 10000,
    ownShareCents: 4000,
    participantIds: Object.values(ids),
  };
  return { group, ids, draft, path: `/groups/${group.id}/bills` };
}
async function billCreate(path: string, draft: unknown, status = 201) {
  return (await json(await api(path, "alice-token", "POST", draft), status))
    .bill;
}
async function submit(
  id: string,
  amountCents: unknown,
  token = "bob-token",
  status = 200,
) {
  return (
    await json(
      await api(`/bills/${id}/share`, token, "POST", { amountCents }),
      status,
    )
  ).bill;
}
test("atomic creation, missing versus zero, immutable confirmations, and persistence", async () => {
  const { path, draft } = await setup();
  const bill = await billCreate(path, { ...draft, ownShareCents: 10000 });
  assert.equal(bill.title, "Costco run");
  assert.equal(bill.differenceCents, 0);
  assert.equal(bill.completedAt, null);
  assert.equal(bill.confirmedCount, 1);
  const first = bill.participants.find(
    (p: { isCurrentUser: boolean }) => p.isCurrentUser,
  );
  const next = await submit(bill.id, 0);
  assert.equal(next.completedAt, null);
  assert.equal(next.confirmedCount, 2);
  const done = await submit(bill.id, 0, "carol-token");
  assert.ok(done.completedAt);
  assert.equal(done.adjustmentCents, 0);
  assert.equal(
    done.participants.find((p: { userId: string }) => p.userId === first.userId)
      .confirmedAt,
    first.confirmedAt,
  );
  await submit(bill.id, 1, "bob-token", 409);
  assert.deepEqual(await submit(bill.id, 0, "carol-token"), done);
  await stopServer();
  await startServer();
  assert.equal(
    (await json(await api(`/bills/${bill.id}`))).bill.completedAt,
    done.completedAt,
  );
});
test("five-cent boundaries retain submitted shares and balance financial summaries", async () => {
  const { path, draft } = await setup(false);
  for (const difference of [-6, -5, -4, 0, 3, 5, 6]) {
    const bill = await billCreate(path, {
      ...draft,
      requestId: crypto.randomUUID(),
    });
    const done = await submit(bill.id, 6000 - difference);
    assert.equal(Boolean(done.completedAt), Math.abs(difference) <= 5);
    assert.equal(done.differenceCents, difference);
    assert.equal(
      done.adjustmentCents,
      Math.abs(difference) <= 5 ? difference : null,
    );
    assert.equal(
      done.participants.find(
        (p: { displayName: string }) => p.displayName === "Alice",
      ).amountCents,
      4000,
    );
  }
  const alice = (await json(await api("/summary"))).summary;
  const bob = (await json(await api("/summary", "bob-token"))).summary;
  assert.equal(alice.receivableCents, 30001);
  assert.equal(bob.payableCents, alice.receivableCents);
  assert.equal(alice.netCents + bob.netCents, 0);
  assert.deepEqual((await json(await api(path))).summary, alice);
});
test("adjustment cannot make initiator cost negative; effective zero is valid", async () => {
  const { path, draft } = await setup();
  for (const [ownShareCents, bob, carol, complete] of [
    [0, 9999, 2, false],
    [1, 9999, 1, true],
    [0, 9999, 1, true],
  ] as const) {
    const bill = await billCreate(path, {
      ...draft,
      requestId: crypto.randomUUID(),
      ownShareCents,
    });
    await submit(bill.id, bob);
    assert.equal(
      Boolean((await submit(bill.id, carol, "carol-token")).completedAt),
      complete,
    );
  }
});
test("simultaneous creation retries and first submissions produce one complete bill", async () => {
  const { path, draft } = await setup();
  const created = await Promise.all(
    Array.from({ length: 6 }, () => billCreate(path, draft)),
  );
  assert.equal(new Set(created.map((b) => b.id)).size, 1);
  const bill = created[0];
  await Promise.all([
    submit(bill.id, 3000),
    submit(bill.id, 3000, "carol-token"),
    submit(bill.id, 3000),
  ]);
  const done = (await json(await api(`/bills/${bill.id}`))).bill;
  assert.ok(done.completedAt);
  assert.equal(done.confirmedCount, 3);
  assert.equal((await json(await api(path))).bills.length, 1);
  await billCreate(path, { ...draft, title: "Different" }, 409);
  assert.equal((await billCreate(path, draft)).id, bill.id);
  const responses = await Promise.all([
    api(`/bills/${bill.id}/share`, "bob-token", "POST", { amountCents: 3000 }),
    api(`/bills/${bill.id}/share`, "bob-token", "POST", { amountCents: 3001 }),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 409],
  );
});
test("group visibility and participant-owned writes use authenticated identity", async () => {
  const { path, draft, ids } = await setup(false);
  const bill = await billCreate(path, {
    ...draft,
    participantIds: [ids.Alice],
  });
  await json(await api(`/bills/${bill.id}`, "bob-token"));
  await submit(bill.id, 0, "bob-token", 403);
  for (const p of [path, `/bills/${bill.id}`])
    await json(await api(p, "carol-token"), 404);
  await submit(bill.id, 0, "carol-token", 404);
  await json(await api(path, "carol-token", "POST", draft), 404);
  await json(
    await api(`/bills/${bill.id}/share`, "alice-token", "POST", {
      amountCents: 0,
      userId: ids.Bob,
    }),
    400,
  );
  for (const [p, method, body] of [
    [path, "GET", undefined],
    [path, "POST", draft],
    [`/bills/${bill.id}`, "GET", undefined],
    [`/bills/${bill.id}/share`, "POST", { amountCents: 0 }],
    ["/summary", "GET", undefined],
  ] as const)
    await json(await api(p, "unknown-token", method, body), 401);
  await json(await api("/bills/not-a-uuid"), 404);
  await json(await api(`/bills/${crypto.randomUUID()}`), 404);
  const outsider = (await json(await api("/me", "carol-token"))).id;
  await billCreate(
    path,
    {
      ...draft,
      requestId: crypto.randomUUID(),
      participantIds: [ids.Alice, outsider],
    },
    400,
  );
  await billCreate(
    path,
    { ...draft, requestId: crypto.randomUUID(), participantIds: [ids.Bob] },
    400,
  );
});
test("amount, text, date, and participant validation rejects invalid requests without records", async () => {
  const { path, draft } = await setup(false);
  for (const totalCents of [
    0,
    -1,
    0.1,
    1000001,
    Number.MAX_SAFE_INTEGER + 1,
    "100",
    null,
  ])
    await billCreate(path, { ...draft, totalCents }, 400);
  for (const ownShareCents of [-1, 10001, 0.5, "1", null])
    await billCreate(path, { ...draft, ownShareCents }, 400);
  for (const change of [
    { title: " " },
    { title: "x".repeat(121) },
    { notes: "x".repeat(2001) },
    { purchaseDate: "2026-02-30" },
    { purchaseDate: "2026-99-99" },
    { purchaseDate: "9999-12-31" },
    { timeZone: "bad" },
    { participantIds: [] },
    { participantIds: [...draft.participantIds, ...draft.participantIds] },
    { currency: "USD" },
  ])
    await billCreate(path, { ...draft, ...change }, 400);
  assert.equal((await json(await api(path))).bills.length, 0);
  const bill = await billCreate(path, {
    ...draft,
    totalCents: 1000000,
    ownShareCents: 0,
    title: "x".repeat(120),
    notes: "x".repeat(2000),
  });
  for (const amount of [-1, 1.5, 1000001, "0", null])
    await submit(bill.id, amount, "bob-token", 400);
  const done = await submit(bill.id, 1000000);
  assert.ok(done.completedAt);
  for (const timeZone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
    const purchaseDate = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    await billCreate(path, {
      ...draft,
      requestId: crypto.randomUUID(),
      timeZone,
      purchaseDate,
    });
  }
});
test("a share insertion failure rolls back the entire creation and permits retry", async () => {
  const { path, draft } = await setup();
  await pool.query(
    `CREATE FUNCTION reject_share() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'deliberate test failure'; END $$; CREATE TRIGGER reject_share BEFORE INSERT ON bill_shares FOR EACH ROW EXECUTE FUNCTION reject_share();`,
  );
  try {
    await billCreate(path, draft, 500);
    assert.equal(
      (await pool.query("SELECT count(*)::int AS count FROM bills")).rows[0]
        .count,
      0,
    );
  } finally {
    await pool.query(
      "DROP TRIGGER reject_share ON bill_shares; DROP FUNCTION reject_share()",
    );
  }
  await billCreate(path, draft);
});
test("summary combines groups without including incomplete or nonparticipant bills", async () => {
  const first = await setup(false);
  const a = await billCreate(first.path, first.draft);
  await submit(a.id, 6000);
  const second = await setup(false);
  const b = (
    await json(
      await api(second.path, "bob-token", "POST", {
        ...second.draft,
        ownShareCents: 7000,
      }),
      201,
    )
  ).bill;
  await submit(b.id, 3000, "alice-token");
  await billCreate(first.path, {
    ...first.draft,
    requestId: crypto.randomUUID(),
  });
  assert.deepEqual((await json(await api("/summary"))).summary, {
    receivableCents: 6000,
    payableCents: 3000,
    netCents: 3000,
  });
  assert.equal((await json(await api(first.path))).summary.netCents, 6000);
  assert.equal((await json(await api(second.path))).summary.netCents, -3000);
});

test("competing first amounts cannot overwrite each other", async () => {
  const { path, draft } = await setup(false);
  const bill = await billCreate(path, draft);
  await submit(bill.id, 10001, "bob-token", 400);
  const responses = await Promise.all(
    [5999, 6000].map((amountCents) =>
      api(`/bills/${bill.id}/share`, "bob-token", "POST", { amountCents }),
    ),
  );
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 409],
  );
  const done = (await json(await api(`/bills/${bill.id}`))).bill;
  assert.ok(done.completedAt);
  assert.equal(done.confirmedCount, 2);
  const bob = done.participants.find(
    (participant: { displayName: string }) => participant.displayName === "Bob",
  );
  assert.ok([5999, 6000].includes(bob.amountCents));
});

test("a creation UUID cannot create bills in two groups concurrently", async () => {
  const first = await setup(false);
  const second = await setup(false);
  const responses = await Promise.all([
    api(first.path, "alice-token", "POST", first.draft),
    api(second.path, "alice-token", "POST", {
      ...second.draft,
      requestId: first.draft.requestId,
    }),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409],
  );
  const lists = await Promise.all(
    [first.path, second.path].map(
      async (path) => (await json(await api(path))).bills,
    ),
  );
  assert.equal(lists.flat().length, 1);
});
