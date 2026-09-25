import { useSyncExternalStore } from 'react';

let blocker: ((destination: string) => boolean) | null = null;
let currentHash = window.location.hash;

// A blocked browser-back hash change must be restored before subscribers unmount
// the editor. The editor can then ask whether to discard its unsaved work.
export function blockRouteNavigation(shouldBlock: (destination: string) => boolean) {
  blocker = shouldBlock;
  return () => { if (blocker === shouldBlock) blocker = null; };
}

export function replaceRoute(destination: string) {
  window.history.replaceState(null, '', destination);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function subscribe(onChange: () => void) {
  function changed() {
    const destination = window.location.hash;
    if (destination !== currentHash && blocker?.(destination)) {
      window.history.pushState(null, '', currentHash || '#/');
      return;
    }
    currentHash = destination;
    onChange();
  }
  currentHash = window.location.hash;
  window.addEventListener('hashchange', changed);
  return () => window.removeEventListener('hashchange', changed);
}
const snapshot = () => window.location.hash;
export function useRoute() { return useSyncExternalStore(subscribe, snapshot); }
