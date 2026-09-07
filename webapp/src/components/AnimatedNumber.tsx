import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/** Ticks a displayed number toward `value` in ~280ms. Reduced motion snaps. */
export function AnimatedNumber({
  value,
  format,
}: {
  value: number;
  format?: (n: number) => string;
}) {
  const reduce = usePrefersReducedMotion();
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  shownRef.current = shown;

  useEffect(() => {
    if (reduce) {
      setShown(value);
      return;
    }
    const start = shownRef.current;
    if (start === value) return;
    const t0 = performance.now();
    const dur = 280;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const ease = 1 - (1 - t) ** 3;
      const next = start + (value - start) * ease;
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setShown(value);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce]);

  return (
    <span className="anim-num">
      {format ? format(shown) : String(Math.round(shown))}
    </span>
  );
}
