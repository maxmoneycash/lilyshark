import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import {
  bucketAt,
  bucketRange,
  type IoGraph,
  type IoSlice,
  type IoSplit,
  IO_OTHER_KEY,
  IO_UNATTRIBUTED_KEY,
  ioGraphNote,
  slicesFor,
  stackDescending,
} from '../lib/ioGraph';
import { type BrushRange, brushLabel, normalizeBrush } from '../lib/trafficView';
import { accent, fg, isLight, useThemeTick } from '../mesh/theme';

/**
 * The IO graph strip on TRAFFIC: the whole capture on one clock, stacked by
 * protocol or by node, and brushable.
 *
 * It plots the WHOLE capture, never the filtered subset. A graph that shrank
 * as the operator typed a filter could not show what the filter is hiding,
 * and the point of the strip is to see the bursts and silences the table's
 * current view sits inside. What the filter and the brush select is reported
 * in numbers underneath instead.
 *
 * Stacking is done by over-painting rather than by uPlot bands: each bar is
 * drawn from zero to the running total at its own level, tallest first, so
 * every later bar covers the lower part of the one before it. stackDescending
 * in lib/ioGraph.ts builds those arrays and its tests pin the ordering
 * property the trick depends on.
 *
 * The uPlot container is a div with NO React children — React and uPlot
 * fighting over the same node is what takes the app down on removeChild.
 */

/** Below this many pixels a drag is a click, not a brush. */
const CLICK_SLOP_PX = 4;

/** The strip is a readout, not a chart page: tall enough to read, no taller. */
const PLOT_HEIGHT = 132;

/**
 * Fixed colour per protocol, so a protocol keeps its colour whether or not
 * the others are present. `unknown` and `custom` are deliberately muted: they
 * are the frames whose protocol the capture profile did not name, and they
 * must not read as louder than the ones it did.
 */
function protocolColor(key: string): string {
  const light = isLight();
  switch (key) {
    case 'meshtastic':
      return fg();
    case 'meshcore':
      return light ? '#0f6f86' : '#5ccfe6';
    case 'reticulum':
      return light ? '#9a6a00' : '#ffb000';
    case 'custom':
      return light ? '#54459c' : '#b3a5e3';
    default:
      return light ? '#00000055' : '#ffffff44';
  }
}

const NODE_PALETTE = (): string[] =>
  isLight()
    ? [fg(), '#0f6f86', '#9a6a00', '#54459c', '#2f7d32', '#a03030']
    : [fg(), '#5ccfe6', '#ffb000', '#b3a5e3', '#7ddc8a', '#ff8f8f'];

/**
 * Colour per slice, in slice order. The legend and the canvas both read this,
 * so a swatch can never disagree with the bar it names.
 *
 * UNATTRIBUTED and OTHER are neutral greys rather than palette entries: one
 * is "the protocol proved no talker", the other is a bag of nodes, and
 * neither is a node whose colour an operator should learn.
 */
function sliceColors(slices: readonly IoSlice[], split: IoSplit): string[] {
  if (split === 'protocol') return slices.map((s) => protocolColor(s.key));
  const palette = NODE_PALETTE();
  let next = 0;
  return slices.map((s) => {
    if (s.key === IO_UNATTRIBUTED_KEY) return isLight() ? '#00000044' : '#ffffff38';
    if (s.key === IO_OTHER_KEY) return isLight() ? '#00000077' : '#ffffff66';
    return palette[next++ % palette.length];
  });
}

/** Seconds on the capture clock, as an axis tick: "12.5s", "3:20". */
function fmtClock(s: number): string {
  if (!Number.isFinite(s)) return '';
  const a = Math.abs(s);
  const sign = s < 0 ? '-' : '';
  if (a < 60) return `${sign}${Number(a.toFixed(3))}s`;
  const m = Math.floor(a / 60);
  return `${sign}${m}:${String(Math.round(a - m * 60)).padStart(2, '0')}`;
}

interface IoGraphPanelProps {
  graph: IoGraph;
  split: IoSplit;
  onSplitChange: (split: IoSplit) => void;
  brush: BrushRange | null;
  onBrush: (brush: BrushRange | null) => void;
  /** Frames the table is showing under the filter and the brush together. */
  shownFrames: number;
  /** Frames the display filter alone leaves, before the brush narrows them. */
  filteredFrames: number;
}

export function IoGraphPanel({
  graph,
  split,
  onSplitChange,
  brush,
  onBrush,
  shownFrames,
  filteredFrames,
}: IoGraphPanelProps) {
  // uPlot paints on a canvas with fg(), which cannot follow a CSS variable:
  // the plot is rebuilt when the theme changes.
  const themeTick = useThemeTick();
  const boxRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  // The canvas listeners outlive any one render, so what they need has to
  // reach them through refs or they would brush against a stale capture.
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const onBrushRef = useRef(onBrush);
  onBrushRef.current = onBrush;

  const slices = useMemo(() => slicesFor(graph, split), [graph, split]);
  const colors = useMemo(
    () => sliceColors(slices, split),
    // themeTick is a real input: every colour above is read from the theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slices, split, themeTick],
  );

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    plotRef.current?.destroy();
    plotRef.current = null;
    if (graph.frames === 0) return;

    const stacked = stackDescending(slices);
    const colorOf = new Map(slices.map((s, i) => [s.key, colors[i]]));
    const barsFactory = uPlot.paths.bars;
    // size: [width factor, max px, min px] — a capture with 240 buckets in a
    // narrow panel would otherwise round every bar away to nothing.
    const bars = barsFactory ? barsFactory({ size: [1, Infinity, 1], gap: 1 }) : undefined;

    const data: uPlot.AlignedData = [
      graph.centerS,
      ...stacked.map((s) => s.cumulative),
      // Drawn only when there is something to draw, so an all-over-the-air
      // capture carries no synthetic series at all.
      ...(graph.syntheticFrames > 0 ? [graph.synthetic] : []),
    ];

    const axis = {
      stroke: fg('88'),
      grid: { stroke: fg('22'), dash: [2, 6] },
      ticks: { stroke: fg('44') },
      font: '11px JetBrains Mono',
    };

    const plot = new uPlot(
      {
        width: Math.max(120, box.clientWidth),
        height: PLOT_HEIGHT,
        legend: { show: false },
        // The x axis is seconds on the capture clock, not wall-clock time.
        scales: {
          x: { time: false },
          y: { range: (_u, _min, max) => [0, Math.max(1, max)] },
        },
        cursor: {
          y: false,
          points: { show: false },
          // setScale false: dragging brushes the frame list, it does not zoom.
          // Zooming would move the graph away from the table's own clock.
          drag: { x: true, y: false, setScale: false },
        },
        select: { show: true, left: 0, top: 0, width: 0, height: 0 },
        series: [
          { value: (_u, v) => (v == null ? '' : fmtClock(v)) },
          ...stacked.map((s) => {
            const color = colorOf.get(s.slice.key) ?? fg();
            return {
              label: s.slice.label,
              stroke: color,
              fill: color,
              width: 1,
              paths: bars,
              points: { show: false },
            };
          }),
          ...(graph.syntheticFrames > 0
            ? [
                {
                  label: 'SYNTHETIC',
                  stroke: accent(),
                  width: 1,
                  dash: [3, 3],
                  points: { show: false },
                },
              ]
            : []),
        ],
        axes: [
          { ...axis, values: (_u, splits) => splits.map(fmtClock) },
          {
            ...axis,
            size: 46,
            // Frames are whole things. Left to itself uPlot labels a quiet
            // capture 0, 0.5, 1, and half a frame was never heard.
            incrs: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000],
            values: (_u, splits) => splits.map((v) => String(v)),
          },
        ],
        hooks: {
          setSelect: [
            (u) => {
              // A click leaves a zero-width selection and never reaches here;
              // the click listener below owns that gesture.
              if (u.select.width <= CLICK_SLOP_PX) return;
              const a = u.posToVal(u.select.left, 'x');
              const b = u.posToVal(u.select.left + u.select.width, 'x');
              onBrushRef.current(normalizeBrush(a, b));
            },
          ],
        },
      },
      data,
      box,
    );
    plotRef.current = plot;

    // A click selects the bar under the pointer. uPlot fires setSelect only
    // for a real drag, so the click is handled here — and told apart from the
    // click that ends a drag by how far the pointer travelled.
    let downX = 0;
    const onDown = (e: MouseEvent) => {
      downX = e.clientX;
    };
    const onClick = (e: MouseEvent) => {
      if (Math.abs(e.clientX - downX) > CLICK_SLOP_PX) return;
      const g = graphRef.current;
      const tS = plot.posToVal(e.clientX - plot.over.getBoundingClientRect().left, 'x');
      const index = bucketAt(g, tS);
      onBrushRef.current(index >= 0 ? bucketRange(g, index) : null);
    };
    // Double-click is the chart's own way back to the whole capture, next to
    // the button in the title bar.
    const onDoubleClick = () => onBrushRef.current(null);
    plot.over.addEventListener('mousedown', onDown);
    plot.over.addEventListener('click', onClick);
    plot.over.addEventListener('dblclick', onDoubleClick);

    return () => {
      plot.over.removeEventListener('mousedown', onDown);
      plot.over.removeEventListener('click', onClick);
      plot.over.removeEventListener('dblclick', onDoubleClick);
      plot.destroy();
      if (plotRef.current === plot) plotRef.current = null;
    };
  }, [graph, slices, colors]);

  // The brushed span is drawn from the prop rather than left wherever the
  // drag ended, so clearing it from the button, from a keystroke or from a
  // new capture all wipe the shading too. `false` suppresses setSelect, which
  // would otherwise loop straight back into onBrush.
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const height = plot.over.clientHeight;
    if (!brush) {
      plot.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
      return;
    }
    const left = plot.valToPos(brush.startS, 'x');
    const right = plot.valToPos(brush.endS, 'x');
    plot.setSelect(
      { left, top: 0, width: Math.max(1, right - left), height },
      false,
    );
  }, [brush, graph, slices, colors]);

  // The canvas is sized in pixels once and would otherwise keep its first
  // width through a window resize or the detail pane wrapping away.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      plotRef.current?.setSize({
        width: Math.max(120, box.clientWidth),
        height: PLOT_HEIGHT,
      });
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const brushed = brush !== null;

  return (
    <>
      <div className="panel-title">
        IO // WHOLE CAPTURE
        <span className="spacer" />
        <button
          className={split === 'protocol' ? 'primary' : ''}
          title="Stack the bars by the protocol each frame's capture profile names"
          onClick={() => onSplitChange('protocol')}
        >
          BY PROTOCOL
        </button>
        <button
          className={split === 'node' ? 'primary' : ''}
          title="Stack the bars by the source each frame's own protocol proves"
          onClick={() => onSplitChange('node')}
        >
          BY NODE
        </button>
        <button
          disabled={!brushed}
          title="Drop the time range and show the whole capture again"
          onClick={() => onBrush(null)}
        >
          ⟲ WHOLE CAPTURE
        </button>
      </div>

      {/* A div uPlot owns outright: no React children, ever. */}
      <div
        ref={boxRef}
        style={{ width: '100%', height: PLOT_HEIGHT, padding: '4px 0 0' }}
      />

      {graph.frames > 0 && (
        <div
          className="panel-foot"
          style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
        >
          {slices.map((slice, i) => (
            <span
              key={slice.key}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <span
                aria-hidden
                style={{
                  width: 9,
                  height: 9,
                  background: colors[i],
                  border: '1px solid var(--border)',
                  flexShrink: 0,
                }}
              />
              {slice.label} <span className="dim">{slice.total}</span>
            </span>
          ))}
          {graph.syntheticFrames > 0 && (
            <span className="warn">
              ┄ SYNTHETIC · NOT OTA {graph.syntheticFrames}
            </span>
          )}
        </div>
      )}

      <div className="panel-foot" style={{ display: 'block' }}>
        <span className="dim">{ioGraphNote(graph)}</span>
        {graph.frames > 0 && (
          <>
            {' · '}
            {brushed ? (
              <span className="ok">
                BRUSHED {brushLabel(brush)} · {shownFrames} OF {filteredFrames} FILTERED
                FRAME(S) IN RANGE — click a bar, drag across bars, or press ⟲ WHOLE
                CAPTURE
              </span>
            ) : (
              <span className="dim">
                click a bar to select its span, or drag across the strip to select a
                range
              </span>
            )}
          </>
        )}
      </div>
    </>
  );
}
