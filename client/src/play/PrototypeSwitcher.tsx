/* eslint-disable react-refresh/only-export-components -- Throwaway prototype module. */
// PROTOTYPE — throwaway variant switcher. Reads ?variant= from the real query string (routing
// lives in the hash, so it is untouched). Dev builds only.
import { useEffect, useSyncExternalStore } from "react";

const event = "prototype-variant";
function subscribe(changed: () => void) {
  window.addEventListener(event, changed);
  window.addEventListener("popstate", changed);
  return () => { window.removeEventListener(event, changed); window.removeEventListener("popstate", changed); };
}
export function usePrototypeVariant(keys: string[]) {
  const value = useSyncExternalStore(subscribe, () => new URLSearchParams(window.location.search).get("variant"));
  return import.meta.env.DEV && value && keys.includes(value) ? value : keys[0];
}
function setVariant(key: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", key);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(event));
}

export function PrototypeSwitcher({ variants, current }: { variants: { key: string; name: string }[]; current: string }) {
  const index = Math.max(0, variants.findIndex((v) => v.key === current));
  const step = (delta: number) => setVariant(variants[(index + delta + variants.length) % variants.length].key);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  if (!import.meta.env.DEV) return null;
  return <div className="prototype-switcher" role="toolbar" aria-label="Prototype variants">
    <button type="button" aria-label="Previous variant" onClick={() => step(-1)}>←</button>
    <span>{variants[index].key} · {variants[index].name}</span>
    <button type="button" aria-label="Next variant" onClick={() => step(1)}>→</button>
  </div>;
}
