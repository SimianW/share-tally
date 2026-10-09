export type TokenProvider = (options?: { skipCache?: boolean }) => Promise<string | null>;

/** Feature adapters retain error messages/metadata and select caching separately. */
export type SessionLifetime = { signal: AbortSignal; authenticationLost: () => void };
export type Failure = { status: number; body: { error?: string; [key: string]: unknown } | null };
export type ErrorPolicy = { unauthenticated: () => Error; failed: (failure: Failure) => Error };

export function createTransport(getToken: TokenProvider, errors: ErrorPolicy, lifetime?: SessionLifetime) {
  async function response(path: string, options: RequestInit = {}, deadlineMs?: number) {
    const callerSignal = lifetime ? AbortSignal.any([lifetime.signal, ...(options.signal ? [options.signal] : [])]) : options.signal;
    callerSignal?.throwIfAborted();
    const token = await getToken();
    callerSignal?.throwIfAborted();
    if (!token) { lifetime?.authenticationLost(); throw errors.unauthenticated(); }
    // A deadline limits the HTTP request only; token refresh does not consume it.
    const signal = deadlineMs === undefined ? callerSignal
      : AbortSignal.any([...(callerSignal ? [callerSignal] : []), AbortSignal.timeout(deadlineMs)]);
    let result = await fetch(`/api${path}`, { ...options, signal, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
    if (result.status === 401) {
      await result.body?.cancel().catch(() => {});
      signal?.throwIfAborted();
      const fresh = await getToken({ skipCache: true });
      signal?.throwIfAborted();
      if (!fresh) { lifetime?.authenticationLost(); throw errors.unauthenticated(); }
      result = await fetch(`/api${path}`, { ...options, signal, headers: { Authorization: `Bearer ${fresh}`, ...options.headers } });
    }
    if (!result.ok) {
      const body = await result.json().catch(() => null);
      signal?.throwIfAborted();
      if (result.status === 401) lifetime?.authenticationLost();
      throw errors.failed({ status: result.status, body });
    }
    signal?.throwIfAborted();
    return result;
  }
  return {
    /** A binary read, such as a photo, with the same authentication retry and cancellation. */
    async blob(path: string, signal?: AbortSignal): Promise<Blob> {
      const value = await (await response(path, { signal })).blob();
      lifetime?.signal.throwIfAborted();
      signal?.throwIfAborted();
      return value;
    },
    async json<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, contentType = true, deadlineMs?: number): Promise<T> {
      const result = await response(path, { method, signal,
        ...(contentType ? { headers: { 'Content-Type': 'application/json' } } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, deadlineMs);
      const value = await result.json();
      lifetime?.signal.throwIfAborted();
      signal?.throwIfAborted();
      return value;
    },
  };
}
