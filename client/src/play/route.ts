import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}
const snapshot = () => window.location.hash;
export function useRoute() { return useSyncExternalStore(subscribe, snapshot); }
