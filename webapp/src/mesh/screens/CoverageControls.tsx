import { type ReactNode, useEffect, useRef, useState } from 'react';

const paths = {
  search: 'm21 21-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  filter: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  layers: 'm12 3 10 6-10 6L2 9l10-6 M2 13l10 6 10-6 M2 17l10 6 10-6',
  data: 'M20 6c0 2-3.6 3-8 3S4 8 4 6s3.6-3 8-3 8 1 8 3v12c0 2-3.6 3-8 3s-8-1-8-3V6 M4 12c0 2 3.6 3 8 3s8-1 8-3',
  measure: 'm3 16 13-13 5 5L8 21l-5-5 M8 11l2 2 M12 7l2 2 M4 15l2 2',
  locate: 'M12 2v4 M12 18v4 M2 12h4 M18 12h4 M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M12 10v4 M10 12h4',
  close: 'm6 6 12 12 M6 18 18 6',
  terrain: 'm2 20 7-15 5 9 3-5 5 11H2 M6 12l3 2 2-2',
  radio: 'M8 11v10h8V11H8 M12 11V3 M7 4a7 7 0 0 0 0 7 M17 4a7 7 0 0 1 0 7 M11 17h2',
  arrow: 'M4 12h16 M14 6l6 6-6 6',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M19 8a8 8 0 0 0-14-2 M5 16a8 8 0 0 0 14 2',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
};

export function CoverageIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

/** Edge cues reveal overflow before a person has to discover it by scrolling. */
export function CoverageScrollSurface({ children, className = '', label }: { children: ReactNode; className?: string; label: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  useEffect(() => {
    const element = viewport.current;
    if (!element || !content.current) return;
    const update = () => setEdges({ top: element.scrollTop > 2, bottom: element.scrollHeight - element.clientHeight - element.scrollTop > 2 });
    const observer = new ResizeObserver(update);
    observer.observe(element); observer.observe(content.current);
    element.addEventListener('scroll', update, { passive: true }); update();
    return () => { observer.disconnect(); element.removeEventListener('scroll', update); };
  }, []);
  return <div className={`coverage-scroll ${className}`} data-top={edges.top} data-bottom={edges.bottom}>
    <div ref={viewport} className="coverage-scroll-viewport" role="region" aria-label={label} tabIndex={0}><div ref={content}>{children}</div></div>
  </div>;
}
