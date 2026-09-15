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
  const { fork } = await import('node:child_process');
  const { once } = await import('node:events');
  // An unreachable database makes accidental DB access fail this test.
  const child = fork(new URL('./server-process.ts', import.meta.url), {
    execArgv: ['--import=tsx'],
    env: { PATH: process.env.PATH, DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test?connect_timeout=1' },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10_000);
      child.once('message', message => {
        clearTimeout(timer);
        if (typeof message === 'number') resolve(message);
        else reject(new Error('Invalid server port'));
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
    });
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
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      child.kill('SIGTERM');
      try { await exited; } finally { clearTimeout(timer); }
    }
  }
});
