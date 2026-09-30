// PROTOTYPE for #150 — throwaway, do not ship.
// Plan: three variants of the By amount share picker, switchable via ?variant=A|B|C.
// The floating ← label → pill that cycles variants and keeps ?variant= in the URL.
import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function PrototypeSwitcher<Key extends string>({ variants, value, onChange }: {
  variants: readonly { key: Key; name: string }[];
  value: Key;
  onChange: (key: Key) => void;
}) {
  const index = Math.max(0, variants.findIndex((variant) => variant.key === value));
  const step = (by: number) => {
    const next = variants[(index + by + variants.length) % variants.length].key;
    onChange(next);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    history.replaceState(null, "", url);
  };
  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    }
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  });
  const current = variants[index];
  return <div className="proto-switcher" role="group" aria-label="Prototype variant">
    <button type="button" aria-label="Previous variant" aria-keyshortcuts="ArrowLeft" onClick={() => step(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
    <output aria-live="polite">{current.key} ({current.name})</output>
    <button type="button" aria-label="Next variant" aria-keyshortcuts="ArrowRight" onClick={() => step(1)}><ChevronRight size={18} aria-hidden="true" /></button>
  </div>;
}
