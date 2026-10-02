// Throwaway UI comparison controls. Remove when a design is selected.
import { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function PrototypeSwitcher({ variants, current, onChange, state }: {
  variants: readonly { key: string; name: string }[];
  current: string;
  onChange: (key: string) => void;
  state: string;
}) {
  const index = variants.findIndex(variant => variant.key === current);
  const cycle = (direction: number) => onChange(variants[(index + direction + variants.length) % variants.length].key);
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (!(event.target instanceof HTMLElement) || event.target.closest('input, textarea, select, [contenteditable], [role="radiogroup"]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        onChange(variants[(index + (event.key === 'ArrowLeft' ? -1 : 1) + variants.length) % variants.length].key);
      }
    };
    window.addEventListener('keydown', press);
    return () => window.removeEventListener('keydown', press);
  }, [index, onChange, variants]);
  if (!import.meta.env.DEV) return null;
  return <aside className="history-prototype-switcher" aria-label="Prototype variants">
    <div className="history-prototype-cycle">
      <button type="button" aria-label="Previous variant" onClick={() => cycle(-1)}><ChevronLeft size={20} /></button>
      <span><small>Prototype</small><strong>{current} · {variants[index].name}</strong></span>
      <button type="button" aria-label="Next variant" onClick={() => cycle(1)}><ChevronRight size={20} /></button>
    </div>
    <output aria-live="polite">{state}</output>
  </aside>;
}
