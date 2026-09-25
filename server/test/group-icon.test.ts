import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InvalidGroupIconError, parseGroupIcon } from '../src/group-icon.js';

test('accepts real Lucide names and complete Unicode characters', () => {
  for (const value of ['shopping-basket', 'house', 'sun']) {
    assert.deepEqual(parseGroupIcon({ type: 'lucide', value }), { type: 'lucide', value });
  }
  for (const value of ['🛒', '★', '👍🏽', '🇨🇦', '👨‍👩‍👧‍👦', 'e\u0301', '中', ':']) {
    assert.deepEqual(parseGroupIcon({ type: 'unicode', value }), { type: 'unicode', value });
  }
});

test('rejects malformed input and unknown Lucide names', () => {
  for (const input of [null, undefined, [], 'lucide:house', {}, { type: 'unicode' },
    { type: 'unicode', value: 1 }, { type: 'other', value: '★' },
    ...['', 'not-an-icon', 'toString', 'House'].map(value => ({ type: 'lucide', value }))]) {
    assert.throws(() => parseGroupIcon(input), InvalidGroupIconError);
  }
});

test('rejects empty, invisible, control and multiple Unicode characters', () => {
  for (const value of ['', ' ', '\n', '\u0000', '\u200d', '\ufe0f', 'ab', '🛒★', ' ★ ']) {
    assert.throws(() => parseGroupIcon({ type: 'unicode', value }), InvalidGroupIconError);
  }
});

test('POST /api/groups rejects invalid icons with 400 before database access', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test?connect_timeout=1';
  const { createApp } = await import('../src/app.js');
  // Listen without the production startup sweep: this case deliberately has no
  // database and verifies validation stops requests before accessing one.
  const server = createApp({
    middleware: (_req, _res, next) => next(),
    userId: () => 'user_test_alice',
  }).listen(0, '127.0.0.1');
  try {
    if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    for (const icon of ['lucide:house', null, { type: 'lucide', value: 'not-real' }, { type: 'unicode', value: 'ab' }]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer alice-token' },
        body: JSON.stringify({ name: 'Costco', icon }),
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(typeof body.error, 'string');
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await (await import('../src/db/index.js')).closeDatabase();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
