import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { mountTDeck, preloadTDeck, type TDeckViewer } from './tdeck-scene';
import './tdeck-model.css';

preloadTDeck();

/** A single persistent scene: scrolling changes the LCD, never the model. */
export function TDeckModel({ screen }: { screen: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<TDeckViewer>();
  const reduceMotion = usePrefersReducedMotion();
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const settings = useRef({ screen, moving: !reduceMotion });
  settings.current = { screen, moving: !reduceMotion };

  useLayoutEffect(() => {
    const node = canvas.current;
    if (!node) return;
    let cancelled = false;
    try {
      viewer.current = mountTDeck(node, {
        onReady: () => { if (!cancelled) setStatus('ready'); },
        onError: () => { if (!cancelled) setStatus('fallback'); },
      });
      viewer.current.setScreen(settings.current.screen);
      viewer.current.setMotion(settings.current.moving);
    } catch {
      if (!cancelled) setStatus('fallback');
    }
    return () => {
      cancelled = true;
      viewer.current?.dispose();
      viewer.current = undefined;
    };
  }, []);

  useEffect(() => { viewer.current?.setScreen(screen); }, [screen]);
  useEffect(() => {
    viewer.current?.setMotion(!reduceMotion);
  }, [reduceMotion]);

  return (
    <div className="tdeck-model" data-state={status} data-screen={screen} aria-busy={status === 'loading'}>
      <canvas
        ref={canvas}
        className="tdeck-model-canvas"
        role="img"
        aria-label="Interactive 3D LILYGO T-Deck Plus running Lilyshark"
        tabIndex={status === 'ready' ? 0 : -1}
        aria-hidden={status !== 'ready'}
      />
    </div>
  );
}
