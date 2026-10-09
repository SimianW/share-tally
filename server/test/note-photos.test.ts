import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import sharp from 'sharp';

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let child: ChildProcess | undefined;
let baseUrl: string;

before(async () => {
  // Never use the developer's DATABASE_URL or .env: migrate an isolated real DB.
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  const running = fork(new URL('./server-process.ts', import.meta.url), {
    execArgv: ['--import=tsx'],
    env: { PATH: process.env.PATH, DATABASE_URL: container.getConnectionUri() },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  child = running;
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server startup timed out')), 30_000);
    running.once('message', message => {
      clearTimeout(timer);
      if (typeof message === 'number') resolve(message);
      else reject(new Error('Invalid server port'));
    });
    running.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Test server exited before startup: ${code}`));
    });
  });
  baseUrl = `http://127.0.0.1:${port}`;
}, { timeout: 120_000 });

after(async () => {
  try {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      const timer = setTimeout(() => child?.kill('SIGKILL'), 5_000);
      child.kill('SIGTERM');
      try { await exited; } finally { clearTimeout(timer); }
    }
  } finally {
    try { await pool?.end(); } finally { await container?.stop(); }
  }
});

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE note_photos, item_claims, bill_items, receipt_evidence, receipt_photos, receipt_drafts, repayments, bill_shares, bills, group_members, groups, users');
});

async function api(path: string, token = 'alice-token', method = 'GET', body?: unknown) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
}
async function json(response: Response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}

// Alice creates the group; Bob joins it. Carol is in no group with them.
async function setup() {
  const { group } = await json(await api('/groups', 'alice-token', 'POST', { name: 'Costco', icon: { type: 'unicode', value: '🛒' } }), 201);
  const invite = await json(await api(`/groups/${group.id}/invitation`));
  await json(await api('/groups/join', 'bob-token', 'POST', { token: invite.path.split('/').at(-1) }));
  const { members } = (await json(await api(`/groups/${group.id}`))).group;
  const ids = Object.fromEntries(members.map((m: { displayName: string; id: string }) => [m.displayName, m.id]));
  return { groupId: group.id as string, ids: ids as Record<'Alice' | 'Bob', string> };
}
function draftData(ids: Record<string, string>, mode: 'manual' | 'items' = 'manual') {
  return {
    mode, title: 'Bulk run', purchaseDate: '2026-01-01', timeZone: 'America/Toronto', notes: 'See photos',
    totalCents: mode === 'manual' ? 1000 : null, participantIds: [ids.Alice, ids.Bob],
    items: mode === 'items' ? [{ id: crypto.randomUUID(), name: 'Rice', originalText: 'RICE', quantity: '1', amountCents: 1000, finalCents: 1000, discountCents: 0 }] : [],
  };
}
async function draft(groupId: string, ids: Record<string, string>, mode: 'manual' | 'items' = 'manual') {
  const id = crypto.randomUUID();
  const saved = (await json(await api(`/groups/${groupId}/receipt-drafts/${id}`, 'alice-token', 'PUT', { revision: 0, data: draftData(ids, mode) }))).draft;
  return { id, revision: saved.revision as number };
}
async function initiate(draftId: string, revision: number) {
  return (await json(await api(`/receipt-drafts/${draftId}/initialize`, 'alice-token', 'POST', { revision }))).bill;
}

const pictures = new Map<string, string>();
// A small, distinct JPEG per label, so stored photos can be told apart by size.
async function picture(label = 'a', width = 64, height = 48) {
  const key = `${label}:${width}x${height}`;
  if (!pictures.has(key)) {
    const shade = [...label].reduce((n, c) => n + c.charCodeAt(0), 0) % 200;
    pictures.set(key, (await sharp({ create: { width, height, channels: 3, background: { r: shade, g: 80, b: 160 } } }).jpeg().toBuffer()).toString('base64'));
  }
  return pictures.get(key)!;
}
const addToDraft = (id: string, base64: string, token = 'alice-token') => api(`/receipt-drafts/${id}/note-photos`, token, 'POST', { base64 });
const addToBill = (id: string, base64: string, token = 'alice-token') => api(`/bills/${id}/note-photos`, token, 'POST', { base64 });
const removePhoto = (id: string, token = 'alice-token') => api(`/note-photos/${id}`, token, 'DELETE');
const photoBytes = (id: string, token = 'alice-token') => api(`/note-photos/${id}`, token);
const draftPhotos = async (id: string) => (await json(await api(`/receipt-drafts/${id}`))).draft.notePhotos;
const billPhotos = async (id: string, token = 'alice-token') => (await json(await api(`/bills/${id}`, token))).bill.notePhotos;

test('an initiator adds up to three note photos to a draft, in order, and removes one', async () => {
  const { groupId, ids } = await setup();
  const { id, revision } = await draft(groupId, ids);
  const added = [];
  for (const label of ['a', 'b', 'c'])
    added.push((await json(await addToDraft(id, await picture(label)), 201)).notePhoto);
  assert.deepEqual(await draftPhotos(id), added);
  assert.deepEqual(added.map(photo => photo.position), [0, 1, 2]);
  await json(await addToDraft(id, await picture('d')), 409);
  // Photo changes leave the draft's own revision for its editor's next save.
  assert.equal((await json(await api(`/receipt-drafts/${id}`))).draft.revision, revision);

  await json(await removePhoto(added[1].id));
  await json(await removePhoto(added[1].id), 404);
  const fourth = (await json(await addToDraft(id, await picture('d')), 201)).notePhoto;
  assert.deepEqual(await draftPhotos(id), [added[0], added[2], fourth]);
  const response = await photoBytes(fourth.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format, 'jpeg');
});

test('concurrent uploads fill the remaining slots and never exceed three', async () => {
  const { groupId, ids } = await setup();
  const { id } = await draft(groupId, ids);
  await json(await addToDraft(id, await picture('first')), 201);
  // With two slots left, two of three simultaneous uploads succeed.
  const statuses = await Promise.all(['b', 'c', 'd'].map(async label => (await addToDraft(id, await picture(label))).status));
  assert.deepEqual([...statuses].sort(), [201, 201, 409]);
  const photos = await draftPhotos(id);
  assert.equal(photos.length, 3);
  assert.equal(new Set(photos.map((photo: { position: number }) => photo.position)).size, 3);
  // The same holds for an initiated bill.
  const bill = await initiate(id, (await json(await api(`/receipt-drafts/${id}`))).draft.revision);
  await json(await removePhoto(photos[0].id));
  const billStatuses = await Promise.all(['e', 'f'].map(async label => (await addToBill(bill.id, await picture(label))).status));
  assert.deepEqual([...billStatuses].sort(), [201, 409]);
  assert.equal((await billPhotos(bill.id)).length, 3);
});

test('stored photos are the server re-encoding: oriented, at most 2048 px, without EXIF or GPS', async () => {
  const { groupId, ids } = await setup();
  const { id } = await draft(groupId, ids);
  // Orientation 6 displays this 3000x1000 picture rotated, as a 1000x3000 portrait.
  const tagged = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#4a7' } })
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Make: 'PrivatePhone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '43/1 28/1 0/1' } })
    .jpeg().toBuffer();
  const before = await sharp(tagged).metadata();
  assert.equal(before.orientation, 6);
  assert.ok(before.exif);
  assert.ok(tagged.includes(Buffer.from('PrivatePhone')));
  const { notePhoto } = await json(await addToDraft(id, tagged.toString('base64')), 201);
  const stored = Buffer.from(await (await photoBytes(notePhoto.id)).arrayBuffer());
  const after = await sharp(stored).metadata();
  assert.equal(after.format, 'jpeg');
  assert.equal(after.exif, undefined);
  assert.equal(after.orientation, undefined);
  assert.ok(!stored.includes(Buffer.from('PrivatePhone')));
  assert.equal(after.height, 2048);
  assert.equal(after.width, Math.round(2048 / 3));
  // Smaller pictures are never enlarged.
  const small = (await json(await addToDraft(id, await picture('small', 300, 200)), 201)).notePhoto;
  const smallMeta = await sharp(Buffer.from(await (await photoBytes(small.id)).arrayBuffer())).metadata();
  assert.deepEqual([smallMeta.width, smallMeta.height], [300, 200]);
});

test('oversize, non-image, multi-page and malformed uploads are rejected', async () => {
  const { groupId, ids } = await setup();
  const { id } = await draft(groupId, ids);
  const oversize = Buffer.alloc(1.5 * 1024 * 1024 + 1, 7).toString('base64');
  await json(await addToDraft(id, oversize), 413);
  await json(await addToDraft(id, Buffer.from('not a picture').toString('base64')), 400);
  await json(await addToDraft(id, 'not base64!'), 400);
  const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).gif().toBuffer();
  await json(await addToDraft(id, gif.toString('base64')), 400);
  const tiff = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).tiff().toBuffer();
  await json(await addToDraft(id, tiff.toString('base64')), 400);
  for (const format of ['png', 'webp'] as const) {
    const image = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#0a0f' } })[format]().toBuffer();
    await json(await addToDraft(id, image.toString('base64')), 201);
  }
  await json(await api(`/receipt-drafts/${id}/note-photos`, 'alice-token', 'POST', { base64: await picture(), extra: true }), 400);
  assert.equal((await draftPhotos(id)).length, 2);
});

test('draft photos are private to the initiator until initiation carries them to the bill in order', async () => {
  const { groupId, ids } = await setup();
  const { id, revision } = await draft(groupId, ids);
  const added = [];
  for (const label of ['a', 'b']) added.push((await json(await addToDraft(id, await picture(label)), 201)).notePhoto);
  for (const token of ['bob-token', 'carol-token']) {
    await json(await photoBytes(added[0].id, token), 404);
    await json(await addToDraft(id, await picture('x'), token), 404);
    await json(await removePhoto(added[0].id, token), 404);
    await json(await api(`/receipt-drafts/${id}`, token), 404);
  }
  const bill = await initiate(id, revision);
  assert.deepEqual(bill.notePhotos, added);
  assert.deepEqual(await billPhotos(bill.id, 'bob-token'), added);
  const bytes = await photoBytes(added[1].id, 'bob-token');
  assert.equal(bytes.status, 200);
  // A non-participant group member sees the same bill; other groups see nothing.
  await json(await api(`/bills/${bill.id}`, 'alice-token', 'PATCH', {
    revision: bill.revision, title: bill.title, purchaseDate: bill.purchaseDate, timeZone: 'America/Toronto',
    notes: bill.notes, totalCents: bill.totalCents, participantIds: [ids.Alice],
  }));
  assert.equal((await photoBytes(added[0].id, 'bob-token')).status, 200);
  await json(await photoBytes(added[0].id, 'carol-token'), 404);
  await json(await api(`/bills/${bill.id}`, 'carol-token'), 404);
  await json(await photoBytes(crypto.randomUUID()), 404);
  await json(await photoBytes('not-a-uuid'), 404);
  // The initiated draft no longer holds them and accepts no new ones.
  assert.deepEqual(await draftPhotos(id), []);
  await json(await addToDraft(id, await picture('late')), 409);
});

test('a bill takes note photos until it is complete or canceled; canceled bills keep them', async () => {
  const { groupId, ids } = await setup();
  const first = await draft(groupId, ids);
  const bill = await initiate(first.id, first.revision);
  const { notePhoto } = await json(await addToBill(bill.id, await picture('a')), 201);
  assert.deepEqual(await billPhotos(bill.id, 'bob-token'), [notePhoto]);
  // Only the initiator writes: a member is told so, an outsider learns nothing.
  await json(await addToBill(bill.id, await picture('b'), 'bob-token'), 403);
  await json(await removePhoto(notePhoto.id, 'bob-token'), 403);
  await json(await addToBill(bill.id, await picture('b'), 'carol-token'), 404);
  await json(await removePhoto(notePhoto.id, 'carol-token'), 404);
  for (const label of ['b', 'c']) await json(await addToBill(bill.id, await picture(label)), 201);
  await json(await addToBill(bill.id, await picture('d')), 409);

  await json(await api(`/bills/${bill.id}/cancel`, 'alice-token', 'POST', { revision: bill.revision }));
  await json(await addToBill(bill.id, await picture('e')), 409);
  await json(await removePhoto(notePhoto.id), 409);
  assert.equal((await billPhotos(bill.id, 'bob-token')).length, 3);
  assert.equal((await photoBytes(notePhoto.id, 'bob-token')).status, 200);

  const second = await draft(groupId, ids);
  const open = await initiate(second.id, second.revision);
  const kept = (await json(await addToBill(open.id, await picture('kept')), 201)).notePhoto;
  for (const [token, amountCents] of [['alice-token', 400], ['bob-token', 600]] as const) {
    const current = (await json(await api(`/bills/${open.id}`, token))).bill;
    await json(await api(`/bills/${open.id}/share`, token, 'POST', { amountCents, expectedAmountCents: null, revision: current.revision }));
  }
  assert.ok((await json(await api(`/bills/${open.id}`))).bill.completedAt);
  await json(await addToBill(open.id, await picture('f')), 409);
  await json(await removePhoto(kept.id), 409);
  assert.deepEqual(await billPhotos(open.id), [kept]);
});

test('a processing draft locks its note photos', async () => {
  const { groupId, ids } = await setup();
  const { id } = await draft(groupId, ids);
  const { notePhoto } = await json(await addToDraft(id, await picture('a')), 201);
  await pool.query("UPDATE receipt_drafts SET processing_status = 'processing', processing_started_at = now() WHERE id = $1", [id]);
  await json(await addToDraft(id, await picture('b')), 409);
  await json(await removePhoto(notePhoto.id), 409);
  assert.equal((await photoBytes(notePhoto.id)).status, 200);
});

test('adding or removing note photos keeps the revision, every confirmation and item versions', async () => {
  const { groupId, ids } = await setup();
  const manualDraft = await draft(groupId, ids);
  const manual = await initiate(manualDraft.id, manualDraft.revision);
  await json(await api(`/bills/${manual.id}/share`, 'bob-token', 'POST', { amountCents: 600, expectedAmountCents: null, revision: manual.revision }));
  const itemDraft = await draft(groupId, ids, 'items');
  const items = await initiate(itemDraft.id, itemDraft.revision);
  const claims = [{ itemId: items.items[0].id, numerator: 1, denominator: 2 }];
  const reviewedItems = items.items.map((item: { id: string; version: number }) => ({ itemId: item.id, version: item.version }));
  await json(await api(`/bills/${items.id}/claims`, 'bob-token', 'POST', { reviewedItems, claims }));

  const events = await stream(groupId);
  for (const bill of [manual, items]) {
    const before = (await json(await api(`/bills/${bill.id}`, 'bob-token'))).bill;
    const changes = events.frames.length;
    const { notePhoto } = await json(await addToBill(bill.id, await picture(bill.id)), 201);
    await eventually(() => events.frames.slice(changes).some(frame => frame.startsWith('event: changed')));
    const added = (await json(await api(`/bills/${bill.id}`, 'bob-token'))).bill;
    assert.deepEqual({ ...added, notePhotos: [] }, { ...before, notePhotos: [] });
    assert.deepEqual(added.notePhotos, [notePhoto]);
    const removedAt = events.frames.length;
    await json(await removePhoto(notePhoto.id));
    await eventually(() => events.frames.slice(removedAt).some(frame => frame.startsWith('event: changed')));
    assert.deepEqual(await json(await api(`/bills/${bill.id}`, 'bob-token')).then(r => r.bill), before);
  }
  // Draft photos are the initiator's alone, so they announce nothing to the group.
  const quiet = events.frames.length;
  const pending = await draft(groupId, ids);
  await json(await addToDraft(pending.id, await picture('quiet')), 201);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(events.frames.slice(quiet).filter(frame => frame.startsWith('event: changed')).length, 0);
  await events.close();
  const confirmed = (await json(await api(`/bills/${manual.id}`))).bill.participants.find((p: { userId: string }) => p.userId === ids.Bob);
  assert.ok(confirmed.confirmedAt);
});

test('deleting a draft deletes its note photos', async () => {
  const { groupId, ids } = await setup();
  const { id, revision } = await draft(groupId, ids);
  const { notePhoto } = await json(await addToDraft(id, await picture('a')), 201);
  await json(await api(`/receipt-drafts/${id}`, 'alice-token', 'DELETE', { revision }));
  await json(await photoBytes(notePhoto.id), 404);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM note_photos')).rows[0].n, 0);
});

async function stream(groupId: string, token = 'bob-token') {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/groups/${groupId}/events`, {
    headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
  });
  assert.equal(response.status, 200);
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
  await eventually(() => frames.some(frame => frame.startsWith('event: ready')));
  return { frames, async close() { controller.abort(); await reading; } };
}
async function eventually(check: () => boolean | Promise<boolean>, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, 'Expected condition before deadline');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
