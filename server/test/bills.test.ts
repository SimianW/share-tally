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
    "TRUNCATE TABLE repayments, bill_shares, bills, group_members, groups, users",
  );
});

async function api(
  path: string,
  token = "alice-token",
  method = "GET",
  body?: unknown,
) {
  // Legacy scenarios use the current view; explicit revision bodies exercise stale clients.
  if (
    method === "POST" &&
    path.endsWith("/share") &&
    body &&
    typeof body === "object" &&
    !("revision" in body)
  ) {
    const response = await api(path.slice(0, -6), token);
    const current = response.ok ? (await response.json()).bill : null;
    const own = current?.participants.find(
      (p: { isCurrentUser: boolean }) => p.isCurrentUser,
    );
    body = {
      ...body,
      revision: current?.revision ?? 1,
      expectedAmountCents: own?.amountCents ?? null,
    };
  }
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
  const groupView = await json(await api(path));
  assert.deepEqual(groupView.summary, alice);
  assert.equal(groupView.ledger.members.find((m: { displayName: string }) => m.displayName === 'Alice').netCents, 30001);
  assert.equal(groupView.ledger.members.find((m: { displayName: string }) => m.displayName === 'Bob').netCents, -30001);
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

async function readBill(id: string, token = "alice-token") {
  return (await json(await api(`/bills/${id}`, token))).bill;
}
function editBody(bill: Awaited<ReturnType<typeof readBill>>, changes = {}) {
  return {
    revision: bill.revision,
    title: bill.title,
    purchaseDate: bill.purchaseDate,
    timeZone: "America/Toronto",
    notes: bill.notes,
    totalCents: bill.totalCents,
    participantIds: bill.participants.map((p: { userId: string }) => p.userId),
    ...changes,
  };
}
async function action(
  id: string,
  name: "cancel",
  revision: number,
  token = "alice-token",
  status = 200,
) {
  return (
    await json(
      await api(`/bills/${id}/${name}`, token, "POST", { revision }),
      status,
    )
  ).bill;
}
async function shareAt(
  id: string,
  revision: number,
  expectedAmountCents: number | null,
  amountCents: number,
  token = "bob-token",
  status = 200,
) {
  return (
    await json(
      await api(`/bills/${id}/share`, token, "POST", {
        revision,
        expectedAmountCents,
        amountCents,
      }),
      status,
    )
  ).bill;
}

test("incomplete bill corrections retain amounts, clear confirmations, and reconfirmation completes", async () => {
  const { path, draft } = await setup(false);
  const created = await billCreate(path, draft);
  const before = await submit(created.id, 5900);
  assert.equal(before.completedAt, null);
  const open = (
    await json(
      await api(
        `/bills/${created.id}`,
        "alice-token",
        "PATCH",
        editBody(before, { totalCents: 9903 }),
      ),
    )
  ).bill;
  assert.equal(open.completedAt, null);
  assert.equal(open.adjustmentCents, null);
  assert.equal(open.confirmedCount, 0);
  assert.equal(open.submittedCents, before.submittedCents);
  assert.equal((await json(await api("/summary"))).summary.netCents, 0);
  await json(
    await api(`/bills/${open.id}`, "alice-token", "PATCH", editBody(before)),
    409,
  );
  await shareAt(open.id, before.revision, 5900, 5900, "bob-token", 409);
  const one = await shareAt(open.id, open.revision, 5900, 5900);
  const bobTime = one.participants.find(
    (p: { displayName: string }) => p.displayName === "Bob",
  ).confirmedAt;
  const complete = await shareAt(
    open.id,
    open.revision,
    4000,
    4000,
    "alice-token",
  );
  assert.ok(complete.completedAt);
  assert.equal(complete.adjustmentCents, 3);
  assert.equal(
    complete.participants.find(
      (p: { displayName: string }) => p.displayName === "Bob",
    ).confirmedAt,
    bobTime,
  );
  assert.deepEqual(
    await shareAt(open.id, open.revision, 5900, 5900),
    await readBill(open.id, "bob-token"),
  );
  assert.equal((await json(await api("/summary"))).summary.netCents, 5900);
});

test("amount changes clear all confirmations and old requests never reconfirm a newer revision", async () => {
  const { path, draft } = await setup();
  const created = await billCreate(path, draft);
  await submit(created.id, 3000);
  const changed = await shareAt(created.id, created.revision, 3000, 2999);
  assert.equal(changed.confirmedCount, 0);
  assert.equal(changed.revision, created.revision + 1);
  await shareAt(created.id, created.revision, 3000, 2999, "bob-token", 409);
  await shareAt(created.id, created.revision, null, 3001, "carol-token", 409);
  await shareAt(created.id, changed.revision, null, 3001, "carol-token");
  const one = await readBill(created.id);
  assert.equal(one.confirmedCount, 1);
  await shareAt(created.id, changed.revision, 2999, 2999);
  const done = await shareAt(
    created.id,
    changed.revision,
    4000,
    4000,
    "alice-token",
  );
  assert.ok(done.completedAt);
  assert.equal(done.differenceCents, 0);
});

test("descriptive edits, participant replacement, removal permissions and cancellation", async () => {
  const { path, draft, ids, group } = await setup();
  const created = await billCreate(path, draft);
  await submit(created.id, 3000);
  await submit(created.id, 2900, "carol-token");
  const before = await readBill(created.id);
  const changed = (
    await json(
      await api(
        `/bills/${created.id}`,
        "alice-token",
        "PATCH",
        editBody(before, { notes: "Corrected note" }),
      ),
    )
  ).bill;
  assert.equal(changed.notes, "Corrected note");
  assert.equal(changed.confirmedCount, 0);
  assert.equal(changed.completedAt, null);
  assert.equal(changed.submittedCents, 9900);
  const removed = (
    await json(
      await api(
        `/bills/${created.id}`,
        "alice-token",
        "PATCH",
        editBody(changed, { participantIds: [ids.Alice, ids.Bob] }),
      ),
    )
  ).bill;
  await shareAt(created.id, removed.revision, 3000, 3000, "carol-token", 403);
  assert.equal(
    (await json(await api(`/groups/${group.id}`, "carol-token"))).group.members
      .length,
    3,
  );
  const added = (
    await json(
      await api(
        `/bills/${created.id}`,
        "alice-token",
        "PATCH",
        editBody(removed, { participantIds: [ids.Alice, ids.Bob, ids.Carol] }),
      ),
    )
  ).bill;
  assert.equal(
    added.participants.find(
      (p: { displayName: string }) => p.displayName === "Carol",
    ).amountCents,
    null,
  );
  await action(created.id, "cancel", added.revision, "bob-token", 403);
  const canceled = await action(created.id, "cancel", added.revision);
  assert.ok(canceled.canceledAt);
  await action(created.id, "cancel", added.revision, "alice-token", 409);
  await shareAt(created.id, canceled.revision, 3000, 3000, "bob-token", 409);
  await json(
    await api(
      `/bills/${created.id}`,
      "alice-token",
      "PATCH",
      editBody(canceled),
    ),
    409,
  );
  assert.equal((await json(await api(path))).bills.length, 1);
  assert.equal((await json(await api(path))).summary.netCents, 0);
});

test("bill mutation validation and permissions cannot alter other participants shares or remove initiator", async () => {
  const { path, draft, ids } = await setup(false);
  const bill = await billCreate(path, draft);
  for (const name of ["cancel"]) {
    await json(
      await api(`/bills/${bill.id}/${name}`, "carol-token", "POST", {
        revision: 1,
      }),
      404,
    );
    await json(
      await api(`/bills/${bill.id}/${name}`, "bob-token", "POST", {
        revision: 1,
      }),
      403,
    );
  }
  await json(
    await api(`/bills/${bill.id}`, "carol-token", "PATCH", editBody(bill)),
    404,
  );
  await json(
    await api(`/bills/${bill.id}`, "bob-token", "PATCH", editBody(bill)),
    403,
  );
  for (const change of [
    { participantIds: [ids.Bob] },
    { totalCents: 0 },
    { title: " " },
    { ownShareCents: 0 },
    { participantIds: [ids.Alice, crypto.randomUUID()] },
    { purchaseDate: "2026-02-30" },
  ])
    await json(
      await api(
        `/bills/${bill.id}`,
        "alice-token",
        "PATCH",
        editBody(bill, change),
      ),
      400,
    );
  for (const revision of [undefined, 0, -1, 1.2, "1"])
    await json(
      await api(`/bills/${bill.id}/cancel`, "alice-token", "POST", {
        revision,
      }),
      400,
    );
  await json(
    await api(`/bills/${bill.id}/share`, "alice-token", "POST", {
      revision: 1,
      expectedAmountCents: 4000,
      amountCents: 0,
      userId: ids.Bob,
    }),
    400,
  );
  assert.deepEqual(await readBill(bill.id), bill);
  const done = await submit(bill.id, 6000);
  await action(bill.id, "cancel", done.revision, "alice-token", 409);
});

test("concurrent initiator edits and share edits serialize and reject the losing revision", async () => {
  const { path, draft } = await setup();
  const bill = await billCreate(path, draft);
  await submit(bill.id, 3000);
  const responses = await Promise.all([
    api(
      `/bills/${bill.id}`,
      "alice-token",
      "PATCH",
      editBody(bill, { notes: "First edit" }),
    ),
    api(
      `/bills/${bill.id}`,
      "alice-token",
      "PATCH",
      editBody(bill, { notes: "Second edit" }),
    ),
    api(`/bills/${bill.id}/share`, "bob-token", "POST", {
      revision: bill.revision,
      expectedAmountCents: 3000,
      amountCents: 2999,
    }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409, 409]);
  const after = await readBill(bill.id);
  assert.equal(after.revision, bill.revision + 1);
  assert.equal(after.confirmedCount, 0);
});

test("a confirmation racing with an edit cannot survive that edit", async () => {
  const { path, draft } = await setup(false);
  const created = await billCreate(path, draft);
  await submit(created.id, 5900);
  const open = (
    await json(
      await api(
        `/bills/${created.id}`,
        "alice-token",
        "PATCH",
        editBody(created, { totalCents: 9900 }),
      ),
    )
  ).bill;
  const [edit, confirm] = await Promise.all([
    api(
      `/bills/${open.id}`,
      "alice-token",
      "PATCH",
      editBody(open, { notes: "New context" }),
    ),
    api(`/bills/${open.id}/share`, "bob-token", "POST", {
      revision: open.revision,
      expectedAmountCents: 5900,
      amountCents: 5900,
    }),
  ]);
  assert.equal(edit.status, 200);
  assert.ok([200, 409].includes(confirm.status));
  const after = await readBill(open.id);
  assert.equal(after.confirmedCount, 0);
  assert.equal(after.completedAt, null);
  assert.equal(after.notes, "New context");
});

test("competing first amounts on an incomplete bill require the original personal amount", async () => {
  const { path, draft } = await setup();
  const bill = await billCreate(path, draft);
  const responses = await Promise.all(
    [2999, 3000].map((amountCents) =>
      api(`/bills/${bill.id}/share`, "bob-token", "POST", {
        revision: bill.revision,
        expectedAmountCents: null,
        amountCents,
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await readBill(bill.id)).confirmedCount, 2);
});

test("simultaneous unchanged reconfirmations and retries finish once and preserve confirmations", async () => {
  const { path, draft } = await setup(false);
  const bill = await billCreate(path, draft);
  await submit(bill.id, 5900);
  const open = (
    await json(
      await api(
        `/bills/${bill.id}`,
        "alice-token",
        "PATCH",
        editBody(bill, { totalCents: 9900 }),
      ),
    )
  ).bill;
  await Promise.all([
    shareAt(bill.id, open.revision, 5900, 5900),
    shareAt(bill.id, open.revision, 4000, 4000, "alice-token"),
    shareAt(bill.id, open.revision, 5900, 5900),
  ]);
  const after = await readBill(bill.id);
  assert.ok(after.completedAt);
  assert.equal(after.confirmedCount, 2);
  assert.equal(after.revision, open.revision);
  await stopServer();
  await startServer();
  assert.deepEqual(await readBill(bill.id), after);
});

test("completed bills reject direct edits, participant changes, cancellation and share changes", async () => {
  const { path, draft, ids } = await setup(false);
  const bill = await billCreate(path, draft);
  await submit(bill.id, 5997);
  const done = await readBill(bill.id);
  for (const changes of [
    { notes: "Changed" },
    { participantIds: [ids.Alice] },
    { totalCents: 10001 },
  ]) {
    await json(
      await api(
        `/bills/${bill.id}`,
        "alice-token",
        "PATCH",
        editBody(done, changes),
      ),
      409,
    );
  }
  await action(bill.id, "cancel", done.revision, "alice-token", 409);
  await shareAt(bill.id, done.revision, 5997, 6000, "bob-token", 409);
  await shareAt(bill.id, done.revision, 4000, 4001, "alice-token", 409);
  assert.equal(
    (
      await api(`/bills/${bill.id}/reopen`, "alice-token", "POST", {
        revision: done.revision,
      })
    ).status,
    404,
  );
  assert.deepEqual(await readBill(bill.id), done);
  assert.equal((await json(await api(path))).summary.netCents, 5997);
});

test("completion racing with edits or cancellation leaves one valid final state", async () => {
  const { path, draft } = await setup(false);
  for (const mutation of ["edit", "cancel", "share"] as const) {
    const bill = await billCreate(path, {
      ...draft,
      requestId: crypto.randomUUID(),
    });
    const [confirmation, change] = await Promise.all([
      api(`/bills/${bill.id}/share`, "bob-token", "POST", {
        revision: bill.revision,
        expectedAmountCents: null,
        amountCents: 6000,
      }),
      mutation === "edit"
        ? api(
            `/bills/${bill.id}`,
            "alice-token",
            "PATCH",
            editBody(bill, { notes: "Correction" }),
          )
        : mutation === "cancel"
          ? api(`/bills/${bill.id}/cancel`, "alice-token", "POST", {
              revision: bill.revision,
            })
          : api(`/bills/${bill.id}/share`, "alice-token", "POST", {
              revision: bill.revision,
              expectedAmountCents: 4000,
              amountCents: 3999,
            }),
    ]);
    assert.deepEqual([confirmation.status, change.status].sort(), [200, 409]);
    const after = await readBill(bill.id);
    if (confirmation.ok) {
      assert.ok(after.completedAt);
      assert.equal(after.canceledAt, null);
      assert.equal(after.revision, bill.revision);
      assert.equal(after.notes, bill.notes);
      assert.equal(after.submittedCents, 10000);
    } else {
      assert.equal(after.completedAt, null);
      assert.equal(after.revision, bill.revision + 1);
      assert.equal(Boolean(after.canceledAt), mutation === "cancel");
      assert.equal(after.confirmedCount, mutation === "cancel" ? 1 : 0);
    }
  }
});

test('group ledger nets complete bills across dates, includes adjustments and excludes unresolved bills', async () => {
  const { group, path, draft, ids } = await setup();
  const first = await billCreate(path, { ...draft, totalCents: 2000, ownShareCents: 0, participantIds: [ids.Alice, ids.Bob] });
  await submit(first.id, 1997);
  const second = (await json(await api(path, 'carol-token', 'POST', {
    ...draft, requestId: crypto.randomUUID(), purchaseDate: '2026-02-01',
    totalCents: 1997, ownShareCents: 0, participantIds: [ids.Bob, ids.Carol],
  }), 201)).bill;
  await submit(second.id, 1997);
  const incomplete = await billCreate(path, { ...draft, requestId: crypto.randomUUID() });
  const canceled = await billCreate(path, { ...draft, requestId: crypto.randomUUID() });
  await json(await api(`/bills/${canceled.id}/cancel`, 'alice-token', 'POST', { revision: 1 }));
  const result = await json(await api(path));
  const balances = Object.fromEntries(result.ledger.members.map((m: { displayName: string; netCents: number }) => [m.displayName, m.netCents]));
  assert.deepEqual(balances, { Alice: 1997, Bob: -3994, Carol: 1997 });
  assert.equal(result.ledger.suggestions.length, 2);
  assert.deepEqual(new Set(result.ledger.suggestions.map((s: { fromUserId: string; toUserId: string; amountCents: number }) => JSON.stringify(s))), new Set([
    JSON.stringify({ fromUserId: ids.Bob, toUserId: ids.Alice, amountCents: 1997 }),
    JSON.stringify({ fromUserId: ids.Bob, toUserId: ids.Carol, amountCents: 1997 }),
  ]));
  assert.deepEqual(result.ledger.incompleteBillIds, [incomplete.id]);
  assert.equal(result.bills.length, 4);
  assert.deepEqual((await json(await api(path))).ledger, result.ledger);
  const other = await create('bob-token');
  await json(await api(`/groups/${other.id}/bills`), 404);
  assert.equal((await json(await api(`/groups/${other.id}/bills`, 'bob-token'))).ledger.suggestions.length, 0);
  await json(await api(`/groups/${group.id}/bills`, 'invalid-token'), 401);
});

async function ledgerWithBalances(amounts: number[]) {
  const group = await create();
  const invitation = await json(await api(`/groups/${group.id}/invitation`));
  const token = invitation.path.split('/').at(-1);
  const tokens = new Map<string, string>();
  const alice = (await json(await api(`/groups/${group.id}`))).group.members[0];
  tokens.set(alice.id, 'alice-token');
  for (let i = 1; i < amounts.length; i++) {
    const joined = (await json(await api('/groups/join', `member-${i}-token`, 'POST', { token }))).group;
    tokens.set(joined.members.find((m: { isCurrentUser: boolean }) => m.isCurrentUser).id, `member-${i}-token`);
  }
  const ids = [...tokens.keys()].sort();
  const remaining = [...amounts];
  const path = `/groups/${group.id}/bills`;
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
    if (remaining[i] >= 0 || remaining[j] <= 0) continue;
    const amount = Math.min(-remaining[i], remaining[j]);
    const bill = (await json(await api(path, tokens.get(ids[j]), 'POST', {
      requestId: crypto.randomUUID(), title: 'Shared purchase', purchaseDate: '2026-01-01', timeZone: 'UTC',
      totalCents: amount, ownShareCents: 0, participantIds: [ids[i], ids[j]],
    }), 201)).bill;
    await submit(bill.id, amount, tokens.get(ids[i]));
    remaining[i] += amount;
    remaining[j] -= amount;
  }
  return { path, ids };
}

test('suggestions achieve the exact minimum for the greedy counterexample and skip zero balances', async () => {
  const { path, ids } = await ledgerWithBalances([-800, -700, -500, 1200, 800, 0]);
  const { ledger } = await json(await api(path));
  assert.deepEqual(ledger.members.map((m: { netCents: number }) => m.netCents), [-800, -700, -500, 1200, 800, 0]);
  assert.equal(ledger.suggestions.length, 3);
  assert.deepEqual(new Set(ledger.suggestions.map((s: unknown) => JSON.stringify(s))), new Set([
    JSON.stringify({ fromUserId: ids[0], toUserId: ids[4], amountCents: 800 }),
    JSON.stringify({ fromUserId: ids[1], toUserId: ids[3], amountCents: 700 }),
    JSON.stringify({ fromUserId: ids[2], toUserId: ids[3], amountCents: 500 }),
  ]));
  assert.deepEqual((await json(await api(path))).ledger, ledger);
});

test('transitive netting reaches every-member-zero without removing bills or blocking new activity', async () => {
  const { group, ids, path, draft } = await setup();
  async function purchase(initiator: string, debtor: string, token: string, debtorToken: string) {
    const bill = (await json(await api(path, token, 'POST', {
      ...draft, requestId: crypto.randomUUID(), totalCents: 2000, ownShareCents: 0,
      participantIds: [initiator, debtor],
    }), 201)).bill;
    await submit(bill.id, 2000, debtorToken);
  }
  await purchase(ids.Bob, ids.Alice, 'bob-token', 'alice-token');
  await purchase(ids.Carol, ids.Bob, 'carol-token', 'bob-token');
  const netted = await json(await api(path));
  assert.deepEqual(netted.ledger.suggestions, [{ fromUserId: ids.Alice, toUserId: ids.Carol, amountCents: 2000 }]);
  await purchase(ids.Alice, ids.Carol, 'alice-token', 'carol-token');
  const zero = await json(await api(path));
  assert.deepEqual(zero.ledger.members.map((m: { netCents: number }) => m.netCents), [0, 0, 0]);
  assert.deepEqual(zero.ledger.suggestions, []);
  assert.equal(zero.bills.length, 3);
  assert.ok(zero.bills.every((b: { completedAt: string }) => b.completedAt));
  assert.deepEqual(await json(await api(path)), zero);
  const newBill = await billCreate(path, { ...draft, requestId: crypto.randomUUID() });
  await json(await api(`/bills/${newBill.id}`, 'alice-token', 'PATCH', {
    revision: 1, title: 'Still editable', purchaseDate: draft.purchaseDate, timeZone: draft.timeZone,
    notes: '', totalCents: draft.totalCents, participantIds: draft.participantIds,
  }));
  await json(await api(`/bills/${newBill.id}/cancel`, 'alice-token', 'POST', { revision: 2 }));
  const invitation = await json(await api(`/groups/${group.id}/invitation`));
  await json(await api('/groups/join', 'member-1-token', 'POST', { token: invitation.path.split('/').at(-1) }));
});

test('reads during completion see a whole ledger snapshot and retries create no bills', async () => {
  const { path, draft, ids } = await setup(false);
  const bill = await billCreate(path, { ...draft, totalCents: 100, ownShareCents: 40 });
  // Hold the write on the isolated test database to exercise the old committed state.
  const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM bills WHERE id = $1 FOR UPDATE', [bill.id]);
    const completion = submit(bill.id, 60);
    const before = await json(await api(path));
    assert.deepEqual(before.ledger.suggestions, []);
    assert.deepEqual(before.ledger.incompleteBillIds, [bill.id]);
    await blocker.query('COMMIT');
    const reads = await Promise.all(Array.from({ length: 12 }, () => api(path).then(r => json(r))));
    await completion;
    for (const view of reads) {
      const complete = Boolean(view.bills[0].completedAt);
      assert.deepEqual(view.ledger.suggestions, complete ? [{ fromUserId: ids.Bob, toUserId: ids.Alice, amountCents: 60 }] : []);
      assert.deepEqual(view.ledger.incompleteBillIds, complete ? [] : [bill.id]);
      assert.equal(view.summary.netCents, complete ? 60 : 0);
      assert.equal(view.bills.length, 1);
    }
    const after = await json(await api(path));
    assert.equal(after.ledger.suggestions[0].amountCents, 60);
    assert.deepEqual(await json(await api(path)), after);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
});

test('16 nonzero members receive a minimum plan within the measured API runtime', async t => {
  const { path, ids } = await ledgerWithBalances([-1, -2, -4, -8, -16, -32, -64, -128, -256, -512, -1024, -2048, -4096, -8192, -16384, 32767]);
  const start = performance.now();
  const view = await json(await api(path));
  const elapsed = performance.now() - start;
  t.diagnostic(`16-member ledger API, including SQL and exact solver: ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed < 2000, 'maximum-size ledger read should finish within two seconds');
  assert.equal(view.ledger.suggestions.length, 15);
  const remaining = new Map<string, number>(view.ledger.members.map((m: { userId: string; netCents: number }) => [m.userId, m.netCents]));
  for (const suggestion of view.ledger.suggestions) {
    assert.ok(Number.isSafeInteger(suggestion.amountCents) && suggestion.amountCents > 0);
    assert.equal(suggestion.toUserId, ids[15]);
    remaining.set(suggestion.fromUserId, remaining.get(suggestion.fromUserId)! + suggestion.amountCents);
    remaining.set(suggestion.toUserId, remaining.get(suggestion.toUserId)! - suggestion.amountCents);
  }
  assert.ok([...remaining.values()].every(n => n === 0));
});


test("initiator amount correction confirms their share while others must reconfirm", async () => {
  const { path, draft } = await setup(false);
  const created = await billCreate(path, draft);
  await submit(created.id, 5900);
  const changed = await shareAt(created.id, created.revision, 4000, 4100, "alice-token");
  assert.equal(changed.confirmedCount, 1);
  assert.ok(changed.participants.find((p: { isCurrentUser: boolean }) => p.isCurrentUser).confirmedAt);
  assert.equal(changed.participants.find((p: { displayName: string }) => p.displayName === "Bob").confirmedAt, null);
  assert.equal(changed.revision, created.revision + 1);
  assert.equal(changed.completedAt, null);
  await shareAt(created.id, created.revision, 4000, 4100, "alice-token", 409);
  const done = await shareAt(created.id, changed.revision, 5900, 5900);
  assert.ok(done.completedAt);
  assert.equal(done.adjustmentCents, 0);
});

test("initiator-only correction completes immediately when the amount matches", async () => {
  const { path, draft, ids } = await setup(false);
  const created = await billCreate(path, { ...draft, participantIds: [ids.Alice] });
  const changed = await shareAt(created.id, created.revision, 4000, 4100, "alice-token");
  assert.equal(changed.confirmedCount, 1);
  assert.equal(changed.completedAt, null);
  const done = await shareAt(created.id, changed.revision, 4100, 9997, "alice-token");
  assert.equal(done.confirmedCount, 1);
  assert.ok(done.completedAt);
  assert.equal(done.adjustmentCents, 3);
  await shareAt(created.id, done.revision, 9997, 9996, "alice-token", 409);
});

async function stream(groupId: string, token = 'bob-token') {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/groups/${groupId}/events`, {
    headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const frames: string[] = [];
  const reader = response.body!.getReader();
  const reading = (async () => {
    let buffer = '';
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          frames.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
        }
      }
    } catch (error) { if (!controller.signal.aborted) throw error; }
    finally { reader.releaseLock(); }
  })();
  return { frames, reading, async close() { controller.abort(); await reading; } };
}
async function eventually(check: () => boolean, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Expected stream event before deadline');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('SSE requires membership, isolates groups, and announces committed bills only', async () => {
  const { group, path, draft, ids } = await setup(false);
  assert.equal((await api(`/groups/${group.id}/events`, 'unknown')).status, 401);
  assert.equal((await api(`/groups/${group.id}/events`, 'carol-token')).status, 404);
  assert.equal((await api('/groups/not-a-uuid/events')).status, 404);
  const other = await create();
  const watching = await stream(group.id);
  const isolated = await stream(other.id, 'alice-token');
  try {
    await eventually(() => watching.frames.length === 1 && isolated.frames.length === 1);
    assert.match(watching.frames[0]!, /event: ready/);
    // Fail after writes have started, so the transaction must roll back.
    await pool.query(`CREATE FUNCTION reject_stream_bill() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced rollback'; END; $$;
      CREATE TRIGGER reject_stream_bill AFTER INSERT ON bill_shares
      FOR EACH ROW EXECUTE FUNCTION reject_stream_bill();`);
    try { await billCreate(path, draft, 500); }
    finally { await pool.query('DROP TRIGGER reject_stream_bill ON bill_shares; DROP FUNCTION reject_stream_bill()'); }
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM bills')).rows[0].n, 0);
    const bill = await billCreate(path, draft);
    await eventually(() => watching.frames.length === 2);
    assert.equal(watching.frames.filter(f => f.includes('event: changed')).length, 1);
    assert.equal(isolated.frames.length, 1);
    const snapshot = await json(await api(path, 'bob-token'));
    assert.equal(snapshot.bills[0].id, bill.id);
    await submit(bill.id, 6000);
    await eventually(() => watching.frames.length === 3);
    const completed = await json(await api(path, 'bob-token'));
    assert.ok(completed.bills[0].completedAt);
    assert.equal(completed.ledger.members.find((m: { userId: string }) => m.userId === ids.Bob).netCents, -6000);
    await submit(bill.id, 6000); // Duplicate invalidation is safe; no duplicate financial effect.
    await eventually(() => watching.frames.length === 4);
    assert.deepEqual((await json(await api(path, 'bob-token'))).ledger, completed.ledger);
    assert.equal(isolated.frames.length, 1);
  } finally { await watching.close(); await isolated.close(); }
});

test('SSE heartbeats, bounded authentication lifetime, and reconnects do not write finances', async () => {
  const { group } = await setup(false);
  const watching = await stream(group.id);
  try {
    await eventually(() => watching.frames.some(f => f === ': heartbeat'), 12_000);
    await Promise.race([watching.reading, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Stream did not expire')), 22_000);
      timer.unref();
    })]);
    const again = await stream(group.id);
    try { await eventually(() => again.frames.some(f => f.includes('event: ready'))); }
    finally { await again.close(); }
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM bills')).rows[0].n, 0);
  } finally { await watching.close(); }
});

test("actual partial repayments affect balances only after recipient confirmation", async () => {
  const { group, ids, path, draft } = await setup(false);
  const bill = await billCreate(path, draft);
  await submit(bill.id, 6000);
  const { repayment } = await json(await api(`/groups/${group.id}/repayments`, "bob-token", "POST", {
    requestId: crypto.randomUUID(), recipientId: ids.Alice, amountCents: 2000,
  }), 201);
  assert.equal(repayment.status, "pending");
  assert.equal((await json(await api(path))).summary.netCents, 6000);
  await json(await api(`/repayments/${repayment.id}/decision`, "alice-token", "POST", { decision: "confirmed" }));
  const result = await json(await api(path));
  assert.equal(result.summary.netCents, 4000);
  assert.equal(result.ledger.suggestions[0].amountCents, 4000);
  assert.equal(result.repayments[0].status, "confirmed");
  assert.equal(result.bills.length, 1);
  assert.deepEqual((await json(await api("/summary"))).summary, {
    receivableCents: 4000, payableCents: 0, netCents: 4000,
  });
});

async function recordRepayment(groupId: string, recipientId: string, amountCents: number, token = 'bob-token', requestId = crypto.randomUUID()) {
  return (await json(await api(`/groups/${groupId}/repayments`, token, 'POST', { requestId, recipientId, amountCents }), 201)).repayment;
}
async function decide(id: string, decision = 'confirmed', token = 'alice-token', status = 200) {
  return json(await api(`/repayments/${id}/decision`, token, 'POST', { decision }), status);
}

test('repayment permissions, strict amounts, and group isolation are enforced', async () => {
  const { group, ids, path } = await setup();
  const other = await create('carol-token');
  const body = { requestId: crypto.randomUUID(), recipientId: ids.Alice, amountCents: 100 };
  const endpoint = `/groups/${group.id}/repayments`;
  await json(await api(endpoint, 'invalid-token', 'POST', body), 401);
  await json(await api(`/groups/${other.id}/repayments`, 'bob-token', 'POST', body), 404);
  for (const amountCents of [0, -1, 1.5, 1000001, '100', null])
    await json(await api(endpoint, 'bob-token', 'POST', { ...body, amountCents }), 400);
  await json(await api(endpoint, 'bob-token', 'POST', { ...body, senderId: ids.Carol }), 400);
  await json(await api(endpoint, 'bob-token', 'POST', { ...body, recipientId: ids.Bob }), 400);
  await json(await api(endpoint, 'bob-token', 'POST', { ...body, recipientId: crypto.randomUUID() }), 400);
  const record = await recordRepayment(group.id, ids.Alice, 1000000);
  for (const actor of ['bob-token', 'carol-token']) {
    await decide(record.id, 'confirmed', actor, 403);
    await decide(record.id, 'rejected', actor, 403);
  }
  await json(await api('/groups', 'member-1-token', 'POST', { name: 'Outsider', icon: { type: 'lucide', value: 'coffee' } }), 201);
  await decide(record.id, 'confirmed', 'member-1-token', 404);
  await json(await api(path, 'member-1-token'), 404);
  assert.equal((await json(await api(path, 'carol-token'))).repayments[0].amountCents, 1000000);
  await decide(record.id, 'rejected');
  await decide(record.id, 'confirmed', 'alice-token', 409);
  const result = await json(await api(path));
  assert.equal(result.summary.netCents, 0);
  assert.deepEqual(result.ledger.suggestions, []);
  assert.equal(result.repayments[0].status, 'rejected');
  assert.deepEqual((await json(await api(`/groups/${other.id}/bills`, 'carol-token'))).repayments, []);
});

test('overpayments and transfers without suggestions create reverse balances and preserve records', async () => {
  const { group, ids, path, draft } = await setup();
  const bill = await billCreate(path, draft);
  await submit(bill.id, 6000);
  await submit(bill.id, 0, 'carol-token');
  const extra = await recordRepayment(group.id, ids.Alice, 7000);
  await decide(extra.id);
  let view = await json(await api(path));
  assert.deepEqual(view.summary, { receivableCents: 0, payableCents: 1000, netCents: -1000 });
  assert.deepEqual(view.ledger.suggestions, [{ fromUserId: ids.Alice, toUserId: ids.Bob, amountCents: 1000 }]);
  // Carol has no current debt and Bob is not a suggested recipient for Carol.
  const unrelated = await recordRepayment(group.id, ids.Bob, 500, 'carol-token');
  await decide(unrelated.id, 'confirmed', 'bob-token');
  view = await json(await api(path));
  const balances = Object.fromEntries(view.ledger.members.map((m: { userId: string; netCents: number }) => [m.userId, m.netCents]));
  assert.deepEqual(balances, { [ids.Alice]: -1000, [ids.Bob]: 500, [ids.Carol]: 500 });
  assert.equal(view.bills.length, 1);
  assert.equal(view.repayments.length, 2);
  assert.deepEqual((await json(await api('/summary', 'carol-token'))).summary, { receivableCents: 500, payableCents: 0, netCents: 500 });
  await stopServer();
  await startServer();
  assert.deepEqual(await json(await api(path)), view);
});

test('record retries and competing decisions have one durable outcome', async () => {
  const { group, ids, path } = await setup(false);
  const requestId = crypto.randomUUID();
  const records = await Promise.all(Array.from({ length: 5 }, () => recordRepayment(group.id, ids.Alice, 1234, 'bob-token', requestId)));
  assert.equal(new Set(records.map(r => r.id)).size, 1);
  const record = records[0];
  await json(await api(`/groups/${group.id}/repayments`, 'bob-token', 'POST', { requestId, recipientId: ids.Alice, amountCents: 1235 }), 409);
  const results = await Promise.all(['confirmed', 'rejected'].map(decision => api(`/repayments/${record.id}/decision`, 'alice-token', 'POST', { decision })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const winner = (await (results.find(r => r.status === 200)!).json()).repayment;
  await decide(record.id, winner.status);
  await recordRepayment(group.id, ids.Alice, 1234, 'bob-token', requestId);
  const view = await json(await api(path));
  assert.equal(view.repayments.length, 1);
  assert.equal(view.summary.netCents, winner.status === 'confirmed' ? -1234 : 0);
  assert.equal(view.repayments[0].decidedAt, winner.decidedAt);
});

test('confirmation uses recorded amounts after suggestions change; zero balances do not close a group', async () => {
  const { group, ids, path, draft } = await setup(false);
  const first = await billCreate(path, draft);
  await submit(first.id, 6000);
  const record = await recordRepayment(group.id, ids.Alice, 6000);
  const second = await billCreate(path, { ...draft, requestId: crypto.randomUUID() });
  await submit(second.id, 6000);
  await decide(record.id);
  assert.equal((await json(await api(path))).summary.netCents, 6000);
  const remaining = await recordRepayment(group.id, ids.Alice, 6000);
  await decide(remaining.id);
  const zero = await json(await api(path));
  assert.deepEqual(zero.ledger.suggestions, []);
  assert.equal(zero.bills.length, 2);
  assert.equal(zero.repayments.length, 2);
  const next = await billCreate(path, { ...draft, requestId: crypto.randomUUID() });
  await submit(next.id, 6000);
  const invite = await json(await api(`/groups/${group.id}/invitation`));
  await json(await api('/groups/join', 'carol-token', 'POST', { token: invite.path.split('/').at(-1) }));
  assert.equal((await json(await api(path))).summary.netCents, 6000);
});

test('concurrent confirmations and bill completion yield consistent ledger snapshots', async () => {
  const { group, ids, path, draft } = await setup(false);
  const bill = await billCreate(path, draft);
  const records = await Promise.all([1000, 2000].map(n => recordRepayment(group.id, ids.Alice, n)));
  const mutations = Promise.all([
    submit(bill.id, 6000), ...records.flatMap(r => [decide(r.id), decide(r.id)]),
  ]);
  const views = await Promise.all(Array.from({ length: 15 }, () => api(path).then(r => json(r))));
  await mutations;
  for (const view of views) {
    const eligible = view.bills[0].completedAt ? 6000 : 0;
    const confirmed = view.repayments.filter((r: { status: string }) => r.status === 'confirmed').reduce((sum: number, r: { amountCents: number }) => sum + r.amountCents, 0);
    assert.equal(view.summary.netCents, eligible - confirmed);
    assert.equal(view.ledger.members.find((m: { userId: string }) => m.userId === ids.Alice).netCents, view.summary.netCents);
  }
  const view = await json(await api(path));
  assert.equal(view.summary.netCents, 3000);
  assert.equal(view.ledger.suggestions[0].amountCents, 3000);
});

test('a sender request key cannot create transfers in two groups concurrently', async () => {
  const first = await setup(false);
  const second = await setup(false);
  const requestId = crypto.randomUUID();
  const body = { requestId, recipientId: first.ids.Alice, amountCents: 100 };
  const responses = await Promise.all([first, second].map(({ group }) => api(`/groups/${group.id}/repayments`, 'bob-token', 'POST', body)));
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  const views = await Promise.all([first, second].map(({ path }) => api(path).then(r => json(r))));
  assert.equal(views[0].repayments.length + views[1].repayments.length, 1);
});

test('pending repayments leave bill corrections and invitation joins available', async () => {
  const { group, ids, path, draft } = await setup(false);
  await recordRepayment(group.id, ids.Alice, 100);
  const bill = await billCreate(path, draft);
  await shareAt(bill.id, bill.revision, 4000, 4100, 'alice-token');
  const invite = await json(await api(`/groups/${group.id}/invitation`));
  await json(await api('/groups/join', 'carol-token', 'POST', { token: invite.path.split('/').at(-1) }));
  const view = await json(await api(path));
  assert.equal(view.repayments[0].status, 'pending');
  assert.equal(view.ledger.members.length, 3);
  assert.equal(view.bills[0].revision, 2);
  assert.equal(view.summary.netCents, 0);
});

test('overview keeps confirmed repayment effects within each group including groups without bills', async () => {
  const first = await setup(false);
  const second = await setup(false);
  const outgoing = await recordRepayment(first.group.id, first.ids.Bob, 1000, 'alice-token');
  const incoming = await recordRepayment(second.group.id, second.ids.Alice, 600);
  await decide(outgoing.id, 'confirmed', 'bob-token');
  await decide(incoming.id);
  assert.deepEqual((await json(await api('/summary'))).summary, { receivableCents: 1000, payableCents: 600, netCents: 400 });
  assert.deepEqual((await json(await api(first.path))).ledger.suggestions, [{ fromUserId: first.ids.Bob, toUserId: first.ids.Alice, amountCents: 1000 }]);
  assert.deepEqual((await json(await api(second.path))).ledger.suggestions, [{ fromUserId: second.ids.Alice, toUserId: second.ids.Bob, amountCents: 600 }]);
});

test('SSE repayment decisions publish after commit and refresh the complete financial snapshot', async () => {
  const { group, ids, path, draft } = await setup(false);
  const bill = await billCreate(path, draft);
  await submit(bill.id, 6000);
  const watching = await stream(group.id);
  try {
    await eventually(() => watching.frames.length === 1);
    const repayment = await recordRepayment(group.id, ids.Alice, 2000);
    await eventually(() => watching.frames.length === 2);
    assert.equal((await json(await api(path))).summary.netCents, 6000);
    await pool.query(`CREATE FUNCTION reject_stream_decision() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced repayment rollback'; END; $$;
      CREATE TRIGGER reject_stream_decision AFTER UPDATE ON repayments
      FOR EACH ROW EXECUTE FUNCTION reject_stream_decision();`);
    try { await decide(repayment.id, 'confirmed', 'alice-token', 500); }
    finally { await pool.query('DROP TRIGGER reject_stream_decision ON repayments; DROP FUNCTION reject_stream_decision()'); }
    assert.equal((await json(await api(path))).repayments[0].status, 'pending');
    await decide(repayment.id);
    await eventually(() => watching.frames.length === 3);
    const view = await json(await api(path));
    assert.equal(view.summary.netCents, 4000);
    assert.equal(view.ledger.members.find((m: { userId: string }) => m.userId === ids.Alice).netCents, 4000);
    assert.deepEqual(view.ledger.suggestions, [{ fromUserId: ids.Bob, toUserId: ids.Alice, amountCents: 4000 }]);
    assert.equal(view.repayments[0].status, 'confirmed');
    await decide(repayment.id);
    await eventually(() => watching.frames.length === 4);
    assert.deepEqual(await json(await api(path)), view);
  } finally { await watching.close(); }
});

test('attention lists only the signed-in participant’s missing shares and reconfirmations', async () => {
  const { path, draft, ids } = await setup();
  const bill = await billCreate(path, draft);
  const attention = async (token: string) => (await json(await api('/attention', token))).actions;
  await json(await api('/attention', 'invalid-token'), 401);
  assert.deepEqual(await attention('alice-token'), []);
  assert.deepEqual(await attention('bob-token'), [{
    kind: 'missing-share', billId: bill.id, groupId: bill.groupId,
    groupName: 'Costco', title: 'Costco run', amountCents: null,
  }]);
  await submit(bill.id, 0);
  assert.deepEqual(await attention('bob-token'), []);
  await submit(bill.id, 5000, 'alice-token');
  assert.deepEqual(await attention('bob-token'), [{
    kind: 'confirm-share', billId: bill.id, groupId: bill.groupId,
    groupName: 'Costco', title: 'Costco run', amountCents: 0,
  }]);
  assert.equal((await attention('carol-token'))[0].kind, 'missing-share');
  const current = (await json(await api(`/bills/${bill.id}`))).bill;
  await json(await api(`/bills/${bill.id}`, 'alice-token', 'PATCH', {
    title: draft.title, purchaseDate: draft.purchaseDate, timeZone: draft.timeZone,
    notes: draft.notes, totalCents: draft.totalCents, revision: current.revision, participantIds: [ids.Alice, ids.Carol],
  }));
  assert.deepEqual(await attention('bob-token'), []);
});

test('attention includes incoming pending repayments across groups, never another member’s actions', async () => {
  const { group, ids } = await setup(false);
  const other = await setup();
  const first = await recordRepayment(group.id, ids.Alice, 2000);
  const second = await recordRepayment(other.group.id, ids.Alice, 1234);
  const outgoing = await recordRepayment(group.id, ids.Bob, 500, 'alice-token');
  const attention = async (token: string) => (await json(await api('/attention', token))).actions;
  assert.deepEqual(await attention('alice-token'), [first, second].map(record => ({
    kind: 'review-repayment', repaymentId: record.id, groupId: record.groupId,
    groupName: 'Costco', senderName: 'Bob', amountCents: record.amountCents,
  })));
  assert.deepEqual(await attention('carol-token'), []);
  assert.equal((await attention('bob-token'))[0].repaymentId, outgoing.id);
  await decide(first.id);
  await decide(second.id, 'rejected');
  assert.deepEqual(await attention('alice-token'), []);
});

test('attention drops canceled and completed bills and excludes group nonparticipants', async () => {
  const { path, draft, ids } = await setup();
  const bill = await billCreate(path, { ...draft, participantIds: [ids.Alice, ids.Bob] });
  const attention = async (token: string) => (await json(await api('/attention', token))).actions;
  assert.deepEqual(await attention('carol-token'), []);
  const outsider = await create('carol-token');
  await billCreate(`/groups/${outsider.id}/bills`, draft, 404);
  assert.equal((await attention('bob-token')).length, 1);
  await submit(bill.id, 6000);
  assert.deepEqual(await attention('bob-token'), []);
  const canceled = await billCreate(path, { ...draft, requestId: crypto.randomUUID() });
  await json(await api(`/bills/${canceled.id}/cancel`, 'alice-token', 'POST', { revision: 1 }));
  assert.deepEqual(await attention('bob-token'), []);
  assert.deepEqual(await attention('carol-token'), []);
});
