import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createSyncSession } from '../src/shared/api/notification-channel.ts';

const ready = { expiresAt: 30_000, expiresInMs: 30_000 };

function setup(t) {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  globalThis.window = window;
  globalThis.document = document;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [];
  const encoder = new TextEncoder();
  t.mock.method(globalThis, 'fetch', async (path, { signal }) => {
    let controller;
    const body = new ReadableStream({ start(value) { controller = value; } });
    const request = { path, signal, send(kind, data) {
      controller.enqueue(encoder.encode(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`));
    } };
    requests.push(request);
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const session = createSyncSession(async () => 'token', () => assert.fail('Unexpected sign-out'));
  t.after(() => { session.stop(); delete globalThis.window; delete globalThis.document; });
  const events = [];
  const consumer = {
    ready: () => events.push(['ready']), changed: () => events.push(['changed']),
    unavailable: () => events.push(['unavailable']), suspend() {},
    denied: status => events.push(['denied', status]),
    deleted: (name, reason) => events.push(['ended', name, reason]),
  };
  const subscription = session.subscribe('/api/groups/group/events', consumer);
  return { session, subscription, consumer, requests, events, window, document };
}

for (const [frame, reason, removed] of [['group-deleted', 'deleted'], ['membership-ended', 'removed', true], ['membership-ended', 'left', false]]) {
  test(`${frame} (${reason}) closes both renewal streams and replays its exact reason to late consumers`, async t => {
    const { session, subscription, consumer, requests, events, window } = setup(t);
    await nextTurn();
    requests[0].send('ready', ready);
    await nextTurn();
    requests[0].send('renew', { expiresAt: ready.expiresAt });
    await nextTurn();
    t.mock.timers.tick(1000);
    await nextTurn();
    assert.equal(requests.length, 2);
    requests[0].send(frame, { id: 'other-group', name: 'Wrong group' });
    await nextTurn();
    assert.deepEqual(events, [['ready']]);
    requests[0].send(frame, { id: 'group', name: 'Costco friends', ...(removed === undefined ? {} : { removed }) });
    await nextTurn();
    assert.deepEqual(events, [['ready'], ['ended', 'Costco friends', reason]]);
    assert.ok(requests.every(request => request.signal.aborted));
    assert.equal(subscription.healthy(), false);
    session.subscribe('/api/groups/group/events', { ...consumer, deleted: (name, ended) => events.push(['late', name, ended]) });
    assert.deepEqual(events.at(-1), ['late', 'Costco friends', reason]);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    subscription.retry();
    t.mock.timers.tick(60_000);
    await nextTurn();
    assert.equal(requests.length, 2, 'An ended membership must not reconnect');
  });
}

test('a snapshot 404 after ready ends access without claiming the group was deleted', async t => {
  const { session, requests, events } = setup(t);
  await nextTurn();
  requests[0].send('ready', ready);
  await nextTurn();
  session.accessDenied('/groups/group/bills', Object.assign(new Error('Group not found'), { status: 404 }));
  assert.deepEqual(events, [['ready'], ['ended', undefined, 'unavailable']]);
  assert.equal(requests[0].signal.aborted, true);
});

test('a reconnect 404 cannot distinguish deletion from removal', async t => {
  const { requests, events, document } = setup(t);
  await nextTurn();
  requests[0].send('ready', ready);
  await nextTurn();
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  await nextTurn();
  assert.deepEqual(events, [['ready'], ['ended', undefined, 'unavailable']]);
});

test('an initial 404 remains an access denial, not evidence of a former membership', async t => {
  const { events } = setup(t);
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));
  await nextTurn();
  assert.deepEqual(events, [['denied', 404]]);
});

test('membership-ended does not terminate another group or the member-wide channel', async t => {
  const { session, requests, events } = setup(t);
  const memberEvents = [];
  session.subscribe('/api/me/events', {
    ready() {}, changed() {}, unavailable() {}, suspend() {}, denied() {},
    deleted: () => memberEvents.push('ended'),
  });
  await nextTurn();
  requests.find(request => request.path === '/api/me/events').send('membership-ended', { id: 'group', name: 'Costco friends' });
  requests.find(request => request.path === '/api/groups/group/events').send('membership-ended', { id: 'other-group', name: 'Elsewhere' });
  await nextTurn();
  assert.deepEqual(events, []);
  assert.deepEqual(memberEvents, []);
  assert.ok(requests.every(request => !request.signal.aborted));
});
