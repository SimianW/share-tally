import { useRef, useState } from 'react';
import { errorMessage } from './error-message';

/** Excludes duplicate activations and settles UI state; feature commands own retry policy. */
export function useOperation() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function execute(action: () => Promise<unknown>, failed: (error: unknown) => void = error => setError(errorMessage(error))) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (error) { failed(error); }
    finally { pending.current = false; setBusy(false); }
  }
  return { pending, busy, error, setError, execute };
}
