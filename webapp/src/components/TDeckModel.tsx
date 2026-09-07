import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { TDeckPhoto } from './TDeckPhoto';
import type { TDeckViewer } from './tdeck-scene';
import './tdeck-model.css';

/** A single persistent scene: scrolling changes the LCD, never the model. */
export function TDeckModel({ screen }: { screen: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<TDeckViewer>();
  const reduceMotion = usePrefersReducedMotion();
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const settings = useRef({ screen, moving: !reduceMotion });
  settings.current = { screen, moving: !reduceMotion };

  useEffect(() => {
    let cancelled = false;
    // Keep Three and its decoder out of the analyzer's initial JS execution.
    import('./tdeck-scene').then(({ mountTDeck }) => {
      if (cancelled || !canvas.current) return;
      viewer.current = mountTDeck(canvas.current, {
        onReady: () => { if (!cancelled) setStatus('ready'); },
        onError: () => { if (!cancelled) setStatus('fallback'); },
      });
      viewer.current.setScreen(settings.current.screen);
      viewer.current.setMotion(settings.current.moving);
    }).catch(() => { if (!cancelled) setStatus('fallback'); });
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
    <div className="tdeck-model" data-state={status} data-screen={screen}>
      {status !== 'ready' && (
        <div className="tdeck-model-fallback">
          <TDeckPhoto screen={screen} alt="LILYGO T-Deck Plus running Lilyshark" />
        </div>
      )}
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
