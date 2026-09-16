// THROWAWAY: shared switcher for development-only UI comparisons.
import { useEffect } from 'react';
export default function PrototypeSwitcher({ variants, current, onChange }: { variants: Record<string, string>; current: string; onChange: (key: string) => void }) {
  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable], [role="textbox"]')) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const keys = Object.keys(variants);
      const next = keys[(keys.indexOf(current) + (e.key === 'ArrowLeft' ? keys.length - 1 : 1)) % keys.length];
      const url = new URL(location.href); url.searchParams.set('variant', next); history.replaceState(null, '', url); onChange(next);
    }
    window.addEventListener('keydown', keydown);
    const pop = () => { const key = new URLSearchParams(location.search).get('variant') ?? 'A'; if (key in variants) onChange(key); };
    window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('popstate', pop); };
  }, [variants, current, onChange]);
  if (!import.meta.env.DEV) return null;
  function move(delta: number) { const keys = Object.keys(variants); const next = keys[(keys.indexOf(current) + delta + keys.length) % keys.length]; const url = new URL(location.href); url.searchParams.set('variant', next); history.replaceState(null, '', url); onChange(next); }
  return <nav className="proto-switcher" aria-label="Prototype variants"><button aria-label="Previous variant" onClick={() => move(-1)}>←</button><span><small>UI 方案 · {Object.keys(variants).indexOf(current) + 1}/3</small><b>{current} · {variants[current]}</b></span><button aria-label="Next variant" onClick={() => move(1)}>→</button></nav>;
}
