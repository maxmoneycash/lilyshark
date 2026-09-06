import { useEffect, useId, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { TDeckPhoto } from './TDeckPhoto';
import type { TDeckViewer } from './tdeck-scene';
import './tdeck-model.css';

/** A single persistent scene: scrolling changes the LCD, never the model. */
export function TDeckModel({ screen }: { screen: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<TDeckViewer>();
  const reduceMotion = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const instructions = useId();
  const settings = useRef({ screen, moving: !reduceMotion && !paused });
  settings.current = { screen, moving: !reduceMotion && !paused };

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
    viewer.current?.setMotion(!reduceMotion && !paused);
  }, [reduceMotion, paused]);

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
        aria-describedby={instructions}
        tabIndex={status === 'ready' ? 0 : -1}
        aria-hidden={status !== 'ready'}
      />
      <div className="tdeck-model-controls" hidden={status !== 'ready'}>
        <span id={instructions} className="tdeck-model-hint">
          Drag to spin · Scroll to explore
          <span className="tdeck-model-sr">. Arrow keys rotate. Home resets the view.</span>
        </span>
        <div className="tdeck-model-buttons">
          {!reduceMotion && (
            <button type="button" onClick={() => setPaused(value => !value)}>
              {paused ? 'Resume rotation' : 'Pause rotation'}
            </button>
          )}
          <button type="button" onClick={() => viewer.current?.reset()}>Reset view</button>
        </div>
      </div>
    </div>
  );
}
