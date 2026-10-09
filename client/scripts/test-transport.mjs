import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTransport } from '../src/shared/api/transport.ts';

const policy = {
  unauthenticated: () => new Error('Sign in again'),
  failed: ({ status, body }) => Object.assign(new Error(body?.error ?? `Request failed (${status})`), { status, body }),
};

test('JSON transport retains authentication, payload and caller cancellation', async t => {
  const signal = new AbortController().signal;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (...args) => { calls.push(args); return Response.json({ revision: 3 }); });
  const transport = createTransport(async () => 'token', policy);
  assert.deepEqual(await transport.json('/bills/1', 'PATCH', { revision: 2 }, signal), { revision: 3 });
  assert.deepEqual(calls, [['/api/bills/1', {
    method: 'PATCH', signal, headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: '{"revision":2}',
  }]]);
});

test('missing auth does not send a request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  await assert.rejects(createTransport(async () => null, policy).json('/groups'), /Sign in again/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('conflict details survive the transport for feature-specific recovery', async t => {
  const body = { error: 'Item changed', conflicts: { items: ['item-id'] } };
  t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status: 409 }));
  await assert.rejects(createTransport(async () => 'token', policy).json('/items'), error => {
    assert.equal(error.status, 409);
    assert.deepEqual(error.body, body);
    return true;
  });
});

test('non-JSON failures and canceled requests retain their original failure semantics', async t => {
  const transport = createTransport(async () => 'token', policy);
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('upstream unavailable', { status: 502 }));
  await assert.rejects(transport.json('/groups'), /Request failed \(502\)/);
  const canceled = new DOMException('Canceled', 'AbortError');
  fetch.mock.mockImplementation(async () => { throw canceled; });
  await assert.rejects(transport.json('/groups'), error => error === canceled);
});

test('a request deadline starts after the token is available', async t => {
  const events = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', ms => { events.push(`deadline ${ms}`); return timeout(ms); });
  t.mock.method(globalThis, 'fetch', async (_path, { signal }) => {
    events.push(`fetch aborted=${signal.aborted}`);
    return Response.json({ groups: [] });
  });
  const transport = createTransport(async () => { events.push('token'); return 'token'; }, policy);
  assert.deepEqual(await transport.json('/groups', 'GET', undefined, new AbortController().signal, false, 15_000), { groups: [] });
  assert.deepEqual(events, ['token', 'deadline 15000', 'fetch aborted=false']);
});

test('binary reads retry an expired token once and keep the caller signal', async t => {
  const signal = new AbortController().signal;
  const tokens = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (_path, { headers }) =>
    headers.Authorization === 'Bearer fresh' ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } }) : new Response(null, { status: 401 }));
  const transport = createTransport(async options => { tokens.push(options?.skipCache ?? false); return options?.skipCache ? 'fresh' : 'stale'; }, policy);
  const blob = await transport.blob('/note-photos/1', signal);
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
  assert.deepEqual(tokens, [false, true]);
  assert.deepEqual(fetch.mock.calls.map(call => [call.arguments[0], call.arguments[1].method, call.arguments[1].signal]), [
    ['/api/note-photos/1', undefined, signal], ['/api/note-photos/1', undefined, signal],
  ]);
});
