import { useLayoutEffect, useRef } from 'react';
import { money } from './bill-api';

// Display only. Financial actions always receive the unanimated server value.
export function AnimatedMoney({ cents }: { cents: number }) {
  const element = useRef<HTMLSpanElement>(null);
  const displayed = useRef(Math.abs(cents));
  const previous = useRef(cents);
  useLayoutEffect(() => {
    const node = element.current!;
    const target = Math.abs(cents);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    function finish() {
      cancelAnimationFrame(frame);
      displayed.current = target;
      node.textContent = money(target);
      node.removeAttribute('data-animating');
    }
    const unchanged = previous.current === cents;
    previous.current = cents;
    if (unchanged || motion.matches) { finish(); return; }
    const from = displayed.current;
    const start = performance.now();
    node.textContent = money(from);
    node.dataset.animating = 'true';
    function tick(now: number) {
      const progress = Math.min((now - start) / 400, 1);
      displayed.current = Math.round(from + (target - from) * progress);
      node.textContent = money(displayed.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else finish();
    }
    frame = requestAnimationFrame(tick);
    const changed = () => { if (motion.matches) finish(); };
    motion.addEventListener('change', changed);
    return () => { cancelAnimationFrame(frame); motion.removeEventListener('change', changed); };
  }, [cents]);
  return <span aria-label={money(Math.abs(cents))}><span aria-hidden="true" ref={element}>{money(Math.abs(cents))}</span></span>;
}
