import { backoff, type StreamData, type SyncSession } from './notification-channel';

export const groupDeletedEvent = 'share-tally:group-deleted';
export type GroupDeleted = { id: string; name?: string };
const stale = 'Live updates interrupted. Displayed data may be out of date.';

type SyncOptions<T> = {
  session: SyncSession;
  groupId: string;
  read: (signal: AbortSignal) => Promise<T>;
  apply: (value: T) => void;
  status: (message: string) => void;
  accessDenied?: (status: number, error?: Error) => void;
  invalidateRead?: () => void;
};

// Snapshot ownership outlives stream replacements. Each consumer serializes its
// own reads; a newer invalidation cancels the old result before cache or apply.
export function startGroupSync<T>(options: SyncOptions<T>) {
  let stopped = false;
  let reading = false;
  let dirty = false;
  let generation = 0;
  let failures = 0;
  let active: AbortController | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let available = false;
  function obsolete() {
    generation++;
    dirty = false;
    active?.abort();
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  function refresh() {
    if (stopped || !available) return;
    obsolete();
    options.invalidateRead?.();
    dirty = true;
    // Invalidate all shared cache reads before any consumer starts its next one.
    queueMicrotask(() => void read());
  }
  async function read() {
    if (reading || stopped || !available) return;
    reading = true;
    try {
      while (dirty && !stopped && available) {
        dirty = false;
        const revision = generation;
        const controller = new AbortController();
        active = controller;
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
          const value = await Promise.race([
            options.read(controller.signal),
            new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Snapshot cancelled')), { once: true })),
          ]);
          if (stopped || revision !== generation || controller.signal.aborted || !available) continue;
          options.apply(value);
          options.status('');
          failures = 0;
        } catch (error) {
          if (stopped || revision !== generation || !available) continue;
          if (error instanceof Error && 'status' in error && [401, 403, 404].includes(Number(error.status))) {
            if (Number(error.status) === 401) options.session.authenticationLost();
            options.accessDenied?.(Number(error.status), error);
            options.status(error.message);
            stop();
            return;
          }
          options.status(stale);
          retryTimer = setTimeout(() => { retryTimer = undefined; refresh(); }, backoff(failures++));
          return;
        } finally { clearTimeout(timeout); controller.abort(); if (active === controller) active = undefined; }
      }
    } finally { reading = false; }
  }
  const subscription = options.session.subscribe(`/api/groups/${encodeURIComponent(options.groupId)}/events`, {
    ready() { available = true; refresh(); },
    changed: refresh,
    unavailable() { available = false; obsolete(); options.status(stale); },
    suspend() { available = false; obsolete(); },
    denied(status, error) { available = false; obsolete(); options.accessDenied?.(status, error); options.status(status === 401 ? "Please sign in again." : "Group not found."); },
    deleted(name) {
      available = false; obsolete();
      window.dispatchEvent(new CustomEvent<GroupDeleted>(groupDeletedEvent, { detail: { id: options.groupId, name } }));
    },
  });
  function stop() { stopped = true; available = false; obsolete(); subscription.stop(); }
  return {
    retry() {
      if (stopped) return;
      if (subscription.healthy()) refresh(); else subscription.retry();
    },
    stop,
  };
}

export function startMemberSync(options: { session: SyncSession; changed: () => void }) {
  let version: string | undefined;
  let initialized = false;
  function snapshot(data: StreamData) {
    // Every subscriber compares its own last snapshot; the session version also
    // catches a rename missed while no member consumer was mounted.
    const missed = options.session.namesChanged(data.version);
    if (!initialized ? missed : data.version === undefined || version !== data.version) options.changed();
    initialized = true;
    version = data.version;
  }
  const subscription = options.session.subscribe('/api/me/events', {
    ready: snapshot, changed: snapshot,
    unavailable() {}, suspend() {}, denied() {}, deleted() {},
  });
  return { retry: subscription.retry, stop: subscription.stop };
}
