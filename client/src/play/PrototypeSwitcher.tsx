// PROTOTYPE ONLY: floating variant switcher for throwaway UI prototypes. Never rendered in production builds.
import { useEffect } from 'react';

export function PrototypeSwitcher({ variants, current, onChange, extra }: {
  variants: { key: string; name: string }[];
  current: string;
  onChange: (key: string) => void;
  extra?: React.ReactNode;
}) {
  const index = Math.max(0, variants.findIndex(v => v.key === current));
  const step = (delta: number) => onChange(variants[(index + delta + variants.length) % variants.length].key);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      if (event.key === 'ArrowLeft') step(-1);
      if (event.key === 'ArrowRight') step(1);
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  if (!import.meta.env.DEV) return null;
  return <div style={{
    position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 999,
    background: '#111', color: '#fff', font: '600 13px system-ui, sans-serif', boxShadow: '0 6px 24px #0006',
    whiteSpace: 'nowrap', maxWidth: 'calc(100vw - 16px)', boxSizing: 'border-box',
  }}>
    <button onClick={() => step(-1)} style={arrow} aria-label="Previous variant">←</button>
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{variants[index].key} ({variants[index].name})</span>
    <button onClick={() => step(1)} style={arrow} aria-label="Next variant">→</button>
    {extra}
  </div>;
}

const arrow: React.CSSProperties = { background: '#333', color: '#fff', border: 0, borderRadius: 999, width: 28, height: 28, cursor: 'pointer' };
