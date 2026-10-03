import { useAuth } from '@clerk/react';
import { useEffect, useEffectEvent, useRef } from 'react';
import type { ProfileNameFields } from '@share-tally/domain/display-name';
import { createTransport } from '../../shared/api/transport';

const profileChannel = 'share-tally:profile';

// Clerk's account window saves names to Clerk only. Whenever this account's
// fields change, and on sign-in, the server rereads them from Clerk itself and
// announces a changed name to every member who can see it. This browser's other
// tabs reload the account from Clerk at once.
export function useProfileSync({ username, firstName, lastName }: ProfileNameFields, reload: () => void) {
  const { getToken } = useAuth();
  const reloadAccount = useEffectEvent(reload);
  useEffect(() => {
    const channel = new BroadcastChannel(profileChannel);
    channel.onmessage = () => reloadAccount();
    return () => channel.close();
  }, []);
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const fields = JSON.stringify([username, firstName, lastName]);
    if (previous.current !== null && previous.current !== fields) {
      const channel = new BroadcastChannel(profileChannel);
      channel.postMessage('changed');
      channel.close();
    }
    previous.current = fields;
  }, [username, firstName, lastName]);
  useEffect(() => {
    const controller = new AbortController();
    const transport = createTransport(getToken, {
      unauthenticated: () => new Error('No active session.'),
      failed: ({ status }) => new Error(`Name synchronization failed (${status}).`),
    });
    // Retry a failure with backoff, and at once when the browser comes back online.
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failed = false;
    function send() {
      clearTimeout(retry);
      failed = false;
      transport.json('/me/profile', 'POST', undefined, controller.signal).catch(() => {
        if (controller.signal.aborted) return;
        failed = true;
        retry = setTimeout(send, Math.min(1000 * 2 ** attempt++, 60_000));
      });
    }
    const online = () => { if (failed) send(); };
    window.addEventListener('online', online);
    send();
    return () => { controller.abort(); clearTimeout(retry); window.removeEventListener('online', online); };
  }, [getToken, username, firstName, lastName]);
}
