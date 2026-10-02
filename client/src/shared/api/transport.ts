type TokenProvider = () => Promise<string | null>;

/** Feature adapters retain error messages/metadata and select caching separately. */
export type Failure = { status: number; body: { error?: string; [key: string]: unknown } | null };
export type ErrorPolicy = { unauthenticated: () => Error; failed: (failure: Failure) => Error };

export function createTransport(getToken: TokenProvider, errors: ErrorPolicy) {
  async function response(path: string, options: RequestInit = {}, deadlineMs?: number) {
    const token = await getToken();
    if (!token) throw errors.unauthenticated();
    // A deadline limits the HTTP request only; token refresh does not consume it.
    const signal = deadlineMs === undefined ? options.signal
      : AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(deadlineMs)]);
    const result = await fetch(`/api${path}`, { ...options, signal, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
    if (!result.ok) {
      const body = await result.json().catch(() => null);
      throw errors.failed({ status: result.status, body });
    }
    return result;
  }
  return {
    async json<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, contentType = true, deadlineMs?: number): Promise<T> {
      const result = await response(path, { method, signal,
        ...(contentType ? { headers: { 'Content-Type': 'application/json' } } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, deadlineMs);
      return result.json();
    },
  };
}
