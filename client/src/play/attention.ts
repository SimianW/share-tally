import { useEffect, useState } from 'react';
import { useBillApi, type AttentionAction } from './bill-api';
import { errorMessage } from './group-api';

export type Attention = {
  // The latest actions read, or null before the first read and after a failed one.
  actions: AttentionAction[] | null;
  error: string;
  loading: boolean;
  refresh: () => void;
};

// Reloads when the member returns to the tab or comes back online.
export function onMemberReturn(load: () => void) {
  const visible = () => { if (document.visibilityState === 'visible') load(); };
  window.addEventListener('focus', load);
  window.addEventListener('online', load);
  document.addEventListener('visibilitychange', visible);
  return () => {
    window.removeEventListener('focus', load);
    window.removeEventListener('online', load);
    document.removeEventListener('visibilitychange', visible);
  };
}

// Home's heading and its action list read the member's actions once, together,
// so the heading's count always matches the list.
export function useAttention(revision: string): Attention {
  const api = useBillApi();
  const [actions, setActions] = useState<AttentionAction[] | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let controller: AbortController | undefined;
    function load() {
      controller?.abort();
      controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
      const request = controller;
      setLoading(true);
      api.attention(signal).then(result => {
        if (!request.signal.aborted) { setActions(result.actions); setError(''); }
      }).catch(error => {
        if (!request.signal.aborted) { setActions(null); setError(errorMessage(error)); }
      }).finally(() => { if (!request.signal.aborted) setLoading(false); });
    }
    load();
    const stop = onMemberReturn(load);
    return () => { controller?.abort(); stop(); };
  }, [api, revision, refresh]);
  return { actions, error, loading, refresh: () => setRefresh(n => n + 1) };
}
