// Authenticated invalidation streams. Start the snapshot only after `ready`.
// Reads are serialized and invalidations during a read trigger another read.
export const groupDeletedEvent = 'share-tally:group-deleted';
export type GroupDeleted = { id: string; name?: string };

function announceDeletion(group: GroupDeleted) {
  window.dispatchEvent(new CustomEvent<GroupDeleted>(groupDeletedEvent, { detail: group }));
}

type SyncOptions<T> = {
  getToken: () => Promise<string | null>;
  read: (signal: AbortSignal) => Promise<T>;
  apply: (value: T) => void;
  status: (message: string) => void;
  accessDenied?: (status: number) => void;
  invalidateRead?: () => void;
};

export function startGroupSync<T>(options: SyncOptions<T> & { groupId: string }) {
  return startSync(`/api/groups/${encodeURIComponent(options.groupId)}/events`, options);
}

// The names version this tab last saw. It outlives the stream, so returning to
// Home after missing a rename elsewhere rereads.
let seenNamesVersion: string | undefined;

// Renamed members of any of the signed-in member's groups, for views spanning
// groups such as Home; group pages learn of renames from their group's stream.
// Each event carries a names version, so the event itself is the snapshot: the
// views reread only when it differs from the last one seen. The tab's first
// version is unknown, so it rereads once in case of a rename before subscribing.
export function startMemberSync(options: { getToken: () => Promise<string | null>; changed: () => void }) {
  return startSync('/api/me/events', {
    getToken: options.getToken, read: async () => {}, apply: () => {}, status: () => {},
    reread: event => {
      let next: unknown;
      try { next = JSON.parse(event.match(/^data: (.*)$/m)?.[1] ?? '').version; } catch { /* An unknown version rereads. */ }
      if (typeof next !== 'string' || next !== seenNamesVersion) options.changed();
      seenNamesVersion = typeof next === 'string' ? next : undefined;
      return false;
    },
  });
}

function startSync<T>(path: string, options: SyncOptions<T> & {
  groupId?: string;
  // Whether a ready or changed event needs this view's read, rather than
  // bringing the view up to date itself. Defaults to always.
  reread?: (event: string) => boolean;
}) {
  let stopped = false;
  let seenReady = false;
  let attempt = 0;
  function deleted(name?: string) {
    if (stopped || !options.groupId) return;
    stopped = true;
    announceDeletion({ id: options.groupId, name });
  }
  let active: AbortController | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  const stale = 'Live updates interrupted. Displayed data may be out of date.';
  async function connect() {
    const controller = new AbortController();
    active = controller;
    let liveness: ReturnType<typeof setTimeout> | undefined;
    let reading = false;
    let dirty = false;
    function alive() {
      clearTimeout(liveness);
      liveness = setTimeout(() => controller.abort(), 25_000);
    }
    async function refresh() {
      dirty = true;
      if (reading) return;
      reading = true;
      try {
        while (dirty && !controller.signal.aborted) {
          dirty = false;
          const value = await options.read(AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
          if (controller.signal.aborted) return;
          // A notification received during the read invalidates its result.
          if (!dirty) {
            options.apply(value);
            options.status('');
            attempt = 0;
          }
        }
      } catch {
        if (!stopped && active === controller) options.status(stale);
        controller.abort();
      } finally { reading = false; }
    }
    try {
      alive();
      const token = await Promise.race([
        options.getToken(),
        new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort',
          () => reject(new Error('Connection timed out')), { once: true })),
      ]);
      if (controller.signal.aborted) return;
      if (!token) throw new Error('Authentication required');
      const response = await fetch(path, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      if (response.status === 404 && options.groupId) {
        if (seenReady) deleted();
        else { options.accessDenied?.(404); stopped = true; }
        return;
      }
      if ([401, 403].includes(response.status)) options.accessDenied?.(response.status);
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error('Stream unavailable');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      try {
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          alive();
          pending += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = pending.indexOf('\n\n')) !== -1) {
            const event = pending.slice(0, end);
            pending = pending.slice(end + 2);
            if (/^event: group-deleted$/m.test(event)) {
              try {
                const data = JSON.parse(event.match(/^data: (.*)$/m)?.[1] ?? '');
                if (data.id === options.groupId && typeof data.name === 'string') {
                  deleted(data.name);
                  controller.abort();
                  break;
                }
              } catch { /* Reconnect and check whether the group still exists. */ }
            }
            if (/^event: ready$/m.test(event)) seenReady = true;
            if (/^event: changed$/m.test(event)) options.invalidateRead?.();
            if (/^event: (ready|changed)$/m.test(event)) {
              if (options.reread?.(event) ?? true) void refresh();
              else attempt = 0; // A healthy connection; the next reconnect need not back off.
            }
          }
          if (pending.length > 65_536) throw new Error('Invalid stream');
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch { /* All connection failures use the same recovery path. */ }
    finally {
      clearTimeout(liveness);
      controller.abort();
      if (!stopped && active === controller) {
        options.status(stale);
        reconnect = setTimeout(() => void connect(), Math.min(1000 * 2 ** Math.min(attempt++, 4), 15_000));
      }
    }
  }
  function retry() {
    if (stopped) return;
    clearTimeout(reconnect);
    const previous = active;
    active = undefined;
    previous?.abort();
    void connect();
  }
  function visible() { if (document.visibilityState === 'visible') retry(); }
  window.addEventListener('online', retry);
  window.addEventListener('focus', visible);
  document.addEventListener('visibilitychange', visible);
  void connect();
  return {
    retry,
    stop() {
      stopped = true;
      clearTimeout(reconnect);
      active?.abort();
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    },
  };
}
