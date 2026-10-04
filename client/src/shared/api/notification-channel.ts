// One session owns these channels. Consumers keep their own snapshot coordinators.
import type { TokenProvider } from './transport';
export type StreamData = { expiresAt: number; expiresInMs: number; version?: string };
export type Subscription = {
  ready: (data: StreamData) => void;
  changed: (data: StreamData) => void;
  unavailable: () => void;
  suspend: () => void;
  denied: (status: number, error?: Error) => void;
  deleted: (name?: string) => void;
};
type Stream = {
  controller: AbortController;
  deadline?: ReturnType<typeof setTimeout>;
  expiry?: ReturnType<typeof setTimeout>;
  liveness?: ReturnType<typeof setTimeout>;
  data?: StreamData;
};
const backoff = (attempt: number) => Math.min(1000 * 2 ** Math.min(attempt, 4), 15_000);
export { backoff };

export function createSyncSession(getToken: TokenProvider, unauthenticated: () => void) {
  const lifetime = new AbortController();
  const channels = new Map<string, ReturnType<typeof createChannel>>();
  let refresh: Promise<string | null> | undefined;
  let seenNamesVersion: string | undefined;
  let signedOut = false;
  let retirement = 0;
  // SDK work can outlive an attempt. Release it when it settles, even after cleanup.
  function freshToken() {
    if (!refresh) {
      const pending = Promise.resolve().then(() => getToken({ skipCache: true }));
      refresh = pending;
      void pending.finally(() => { if (refresh === pending) refresh = undefined; }).catch(() => {});
    }
    return refresh;
  }
  function authenticationLost() {
    if (signedOut) return;
    signedOut = true;
    lifetime.abort();
    unauthenticated();
    for (const channel of channels.values()) channel.deny(401);
  }
  function stop() {
    lifetime.abort();
    for (const channel of channels.values()) channel.stop();
    channels.clear();
    seenNamesVersion = undefined;
  }
  return {
    signal: lifetime.signal,
    getToken: async (options?: { skipCache?: boolean }) => {
      if (lifetime.signal.aborted) return null;
      const token = await (options?.skipCache ? freshToken() : getToken());
      return lifetime.signal.aborted ? null : token;
    },
    authenticationLost,
    accessDenied(path: string, error: Error & { status: number }) {
      if (error.status === 401) { authenticationLost(); return; }
      const group = path.match(/^\/groups\/([^/]+)/)?.[1];
      if (group) channels.get(`/api/groups/${group}/events`)?.deny(error.status, error);
    },
    subscribe(path: string, subscription: Subscription) {
      let channel = channels.get(path);
      if (!channel) {
        channel = createChannel(path, freshToken, authenticationLost);
        channels.set(path, channel);
        if (signedOut) channel.deny(401);
      }
      const release = channel.add(subscription);
      return {
        healthy: () => channel.healthy(),
        retry: () => channel.retry(),
        stop() {
          release();
          if (channel.empty()) { channel.stop(); if (channels.get(path) === channel) channels.delete(path); }
        },
      };
    },
    namesChanged(version?: string) {
      const changed = version === undefined || version !== seenNamesVersion;
      seenNamesVersion = version;
      return changed;
    },
    // StrictMode replays provider effects immediately. Retire the whole session
    // only when that replay has not reclaimed it; consumers release streams now.
    retain(disposed: () => void) {
      const generation = ++retirement;
      return () => queueMicrotask(() => {
        if (retirement === generation) { stop(); disposed(); }
      });
    },
    stop,
  };
}
export type SyncSession = ReturnType<typeof createSyncSession>;

function createChannel(path: string, freshToken: () => Promise<string | null>, authenticationLost: () => void) {
  const consumers = new Set<Subscription>();
  let current: Stream | undefined;
  let candidate: Stream | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let stopped = false;
  let seenReady = false;
  let terminalStatus: number | undefined;
  let deletedName: string | undefined;
  let wasDeleted = false;
  let lastAttempt = -Infinity;
  const visible = () => document.visibilityState === 'visible';
  const each = (callback: (consumer: Subscription) => void) => { for (const consumer of consumers) callback(consumer); };
  function close(stream?: Stream) {
    if (!stream) return;
    clearTimeout(stream.deadline);
    clearTimeout(stream.expiry);
    clearTimeout(stream.liveness);
    stream.controller.abort();
  }
  function cancel() {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    const old = current, pending = candidate;
    current = candidate = undefined;
    close(old); close(pending);
  }
  function deny(status: number, error?: Error) {
    // A missing snapshot after membership was established has the same deletion
    // semantics as a replacement GET returning 404, even before its final frame.
    if (status === 404 && seenReady && path !== '/api/me/events') { deleted(); return; }
    terminalStatus = status;
    cancel();
    each(consumer => consumer.denied(status, error));
  }
  function deleted(name?: string) {
    wasDeleted = true;
    deletedName = name;
    cancel();
    each(consumer => consumer.deleted(name));
  }
  function schedule(delay: number) {
    if (stopped || terminalStatus || wasDeleted || !visible() || candidate || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = undefined; void connect(); }, delay);
  }
  function failed(stream: Stream) {
    if (stream !== current && stream !== candidate) return;
    if (stream === current) current = undefined;
    if (!current) each(consumer => consumer.unavailable());
    if (stream === candidate) candidate = undefined;
    close(stream);
    if (!candidate) schedule(backoff(failures++));
  }
  function alive(stream: Stream) {
    clearTimeout(stream.liveness);
    stream.liveness = setTimeout(() => failed(stream), 25_000);
  }
  function promote(stream: Stream, data: StreamData) {
    if (candidate !== stream || stream.controller.signal.aborted) return;
    clearTimeout(stream.deadline);
    stream.data = data;
    const old = current;
    current = stream;
    candidate = undefined;
    seenReady = true;
    failures = 0;
    close(old);
    stream.expiry = setTimeout(() => failed(stream), data.expiresInMs);
    each(consumer => consumer.ready(data));
  }
  function event(stream: Stream, frame: string) {
    if (stream !== current && stream !== candidate) return;
    const kind = frame.match(/^event: (.+)$/m)?.[1];
    let data: unknown;
    try { data = JSON.parse(frame.match(/^data: (.*)$/m)?.[1] ?? ''); } catch { return; }
    if (!data || typeof data !== 'object') return;
    if (kind === 'group-deleted' && 'id' in data && path === `/api/groups/${encodeURIComponent(String(data.id))}/events` && 'name' in data && typeof data.name === 'string') {
      deleted(data.name);
    } else if (kind === 'ready' && 'expiresAt' in data && typeof data.expiresAt === 'number' && Number.isFinite(data.expiresAt) && 'expiresInMs' in data && typeof data.expiresInMs === 'number' && data.expiresInMs > 0 && data.expiresInMs <= 30_000 &&
      (path !== '/api/me/events' || ('version' in data && typeof data.version === 'string'))) {
      promote(stream, { expiresAt: data.expiresAt, expiresInMs: data.expiresInMs, version: 'version' in data && typeof data.version === 'string' ? data.version : undefined });
    } else if (kind === 'renew' && stream === current && 'expiresAt' in data && data.expiresAt === stream.data?.expiresAt) {
      // Short-lived credentials cannot create an unbounded rapid renewal loop.
      schedule(Math.max(0, lastAttempt + 1000 - performance.now()));
    } else if (kind === 'changed' && stream.data) {
      const version = 'version' in data && typeof data.version === 'string' ? data.version : undefined;
      stream.data = { ...stream.data, version };
      if (current) current.data = { ...current.data!, version };
      each(consumer => consumer.changed(stream.data!));
    }
  }
  async function connect() {
    if (stopped || terminalStatus || wasDeleted || !visible() || candidate) return;
    const stream: Stream = { controller: new AbortController() };
    candidate = stream;
    lastAttempt = performance.now();
    stream.deadline = setTimeout(() => failed(stream), 10_000);
    const signal = stream.controller.signal;
    try {
      const token = await freshToken();
      if (signal.aborted || candidate !== stream) return;
      if (!token) { authenticationLost(); return; }
      let response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, signal });
      if (response.status === 401 && !signal.aborted) {
        await response.body?.cancel().catch(() => {});
        const renewed = await freshToken();
        if (signal.aborted || candidate !== stream) return;
        if (!renewed) { authenticationLost(); return; }
        response = await fetch(path, { headers: { Authorization: `Bearer ${renewed}` }, signal });
      }
      if (signal.aborted) return;
      if (response.status === 401) { authenticationLost(); return; }
      if (response.status === 403) { deny(403); return; }
      if (response.status === 404 && path !== '/api/me/events') {
        if (seenReady) deleted(); else deny(404);
        return;
      }
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Stream unavailable');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      try {
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          alive(stream);
          pending += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          let end: number;
          while ((end = pending.indexOf('\n\n')) >= 0 && !signal.aborted) {
            event(stream, pending.slice(0, end));
            pending = pending.slice(end + 2);
          }
          if (pending.length > 65_536) throw new Error('Invalid stream');
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch { /* Transient failures keep a healthy current stream. */ }
    finally { failed(stream); }
  }
  function recover() {
    if (!visible() || stopped) return;
    if (current?.data) each(consumer => consumer.ready(current!.data!));
    else { clearTimeout(retryTimer); retryTimer = undefined; void connect(); }
  }
  function visibility() {
    if (visible()) recover();
    else { cancel(); each(consumer => consumer.suspend()); }
  }
  window.addEventListener('online', recover);
  window.addEventListener('focus', recover);
  document.addEventListener('visibilitychange', visibility);
  return {
    deny,
    add(consumer: Subscription) {
      consumers.add(consumer);
      if (terminalStatus) consumer.denied(terminalStatus);
      else if (wasDeleted) consumer.deleted(deletedName);
      else if (visible()) {
        if (current?.data) consumer.ready(current.data);
        else void connect();
      }
      return () => consumers.delete(consumer);
    },
    healthy: () => !!current && visible() && !stopped,
    retry() { if (!current) { clearTimeout(retryTimer); retryTimer = undefined; void connect(); } },
    empty: () => !consumers.size,
    stop() {
      stopped = true;
      cancel();
      each(consumer => consumer.suspend());
      consumers.clear();
      window.removeEventListener('online', recover);
      window.removeEventListener('focus', recover);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
