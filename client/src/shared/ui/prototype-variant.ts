// PROTOTYPE: throwaway `?variant=` state shared by PrototypeSwitcher and the page it switches.
import { useSyncExternalStore } from "react";

const changed = "prototype-variant-change";
const subscribe = (notify: () => void) => {
  window.addEventListener(changed, notify);
  window.addEventListener("popstate", notify);
  return () => {
    window.removeEventListener(changed, notify);
    window.removeEventListener("popstate", notify);
  };
};

/** The `?variant=` search parameter; the app routes by hash, so the search is free. */
export function usePrototypeVariant(keys: readonly string[]) {
  const value = useSyncExternalStore(subscribe, () => new URLSearchParams(location.search).get("variant"));
  return value && keys.includes(value) ? value : keys[0];
}

export function selectPrototypeVariant(key: string) {
  const url = new URL(location.href);
  url.searchParams.set("variant", key);
  history.replaceState(history.state, "", url);
  window.dispatchEvent(new Event(changed));
}

