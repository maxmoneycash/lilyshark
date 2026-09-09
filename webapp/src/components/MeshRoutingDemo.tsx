import { useEffect, useId, useRef, useState } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import {
  MESH_DEMO_COPY,
  MESH_DEMO_CYCLE_MS,
  MESH_DEMO_NODES,
  MESH_DEMO_REDUCED_MOTION_PROGRESS,
  MESH_FLOOD_LINKS,
  MESH_ROUTE,
  type MeshRoutingMode,
  meshDemoProgress,
  meshDemoPulses,
} from './meshDemo';

function readTheme(canvas: HTMLCanvasElement) {
  const styles = getComputedStyle(canvas);
  const fg = styles.getPropertyValue('--fg').trim() || '#C00068';
  const ink = styles.getPropertyValue('--ink').trim() || fg;
  return { fg, ink };
}

function paint(canvas: HTMLCanvasElement, mode: MeshRoutingMode, progress: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width < 8 || height < 8) return;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const theme = readTheme(canvas);
  const pad = 18;
  const faint = theme.ink.includes('rgb') || theme.ink.startsWith('#')
    ? theme.ink
    : theme.fg;
  const point = (index: number) => {
    const node = MESH_DEMO_NODES[index];
    return {
      x: pad + node.x * (width - pad * 2),
      y: pad + node.y * (height - pad * 2),
    };
  };

  const stroke = (from: number, to: number, color: string, widthPx = 1) => {
    const a = point(from);
    const b = point(to);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = widthPx;
    ctx.stroke();
  };

  ctx.save();
  ctx.globalAlpha = 0.28;
  for (const link of MESH_FLOOD_LINKS) {
    stroke(link.a, link.b, faint);
  }
  ctx.restore();

  const pulses = meshDemoPulses(mode, progress);
  if (mode === 'routed') {
    for (let hop = 0; hop < MESH_ROUTE.length - 1; hop += 1) {
      stroke(MESH_ROUTE[hop], MESH_ROUTE[hop + 1], theme.fg, 1.6);
    }
  } else {
    for (const pulse of pulses) {
      stroke(pulse.from, pulse.to, theme.fg, 1.6);
    }
  }

  for (const pulse of pulses) {
    const a = point(pulse.from);
    const b = point(pulse.to);
    const x = a.x + (b.x - a.x) * pulse.t;
    const y = a.y + (b.y - a.y) * pulse.t;
    ctx.beginPath();
    ctx.arc(x, y, pulse.kind === 'receipt' ? 3.5 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = pulse.kind === 'receipt' ? theme.ink : theme.fg;
    ctx.fill();
  }

  ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const [index, node] of MESH_DEMO_NODES.entries()) {
    const center = point(index);
    ctx.beginPath();
    ctx.arc(center.x, center.y, 6, 0, Math.PI * 2);
    if (index !== 0 && index !== MESH_DEMO_NODES.length - 1) ctx.globalAlpha = 0.6;
    ctx.fillStyle = index === MESH_DEMO_NODES.length - 1 ? theme.fg : theme.ink;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (node.label) {
      ctx.fillStyle = index === 0 ? theme.ink : theme.fg;
      ctx.fillText(node.label, center.x, center.y + 10);
    }
  }
}

export function MeshRoutingDemo({
  mode,
  onModeChange,
}: {
  mode: MeshRoutingMode;
  onModeChange: (mode: MeshRoutingMode) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  const groupId = useId();
  const copy = MESH_DEMO_COPY[mode];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const draw = (now: number) => {
      const progress = reduceMotion
        ? MESH_DEMO_REDUCED_MOTION_PROGRESS
        : meshDemoProgress(now, MESH_DEMO_CYCLE_MS);
      paint(canvas, mode, progress);
      if (!reduceMotion) frame = requestAnimationFrame(draw);
    };
    draw(performance.now());
    const resize = new ResizeObserver(() => {
      draw(reduceMotion ? 0 : performance.now());
    });
    resize.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, [mode, reduceMotion]);

  return (
    <section className="mesh-demo" aria-label={`Demonstration of ${copy.title}`}>
      <div className="mesh-demo-modes" role="radiogroup" aria-label="Routing strategy">
        {(['flood', 'routed'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            aria-labelledby={`${groupId}-${value}`}
            onClick={() => onModeChange(value)}
          >
            <span id={`${groupId}-${value}`}>{MESH_DEMO_COPY[value].title}</span>
          </button>
        ))}
      </div>
      <div className="mesh-demo-stage">
        <canvas ref={canvasRef} className="mesh-demo-canvas" aria-hidden="true" />
        <span className="mesh-demo-badge">ILLUSTRATIVE DEMO</span>
      </div>
      <p className="mesh-demo-copy">{copy.body}</p>
    </section>
  );
}

export function useMeshDemoMode(sectionIndex: number): [MeshRoutingMode, (mode: MeshRoutingMode) => void] {
  const suggested: MeshRoutingMode = sectionIndex === 2 ? 'routed' : 'flood';
  const [mode, setMode] = useState<MeshRoutingMode>(suggested);
  useEffect(() => {
    setMode(suggested);
  }, [suggested]);
  return [mode, setMode];
}
