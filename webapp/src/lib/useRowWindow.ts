/**
 * The DOM half of virtualRows.ts: read a scrolling pane, hand back the window
 * of rows a table should mount.
 *
 * virtualRows.ts is deliberately free of the DOM so it can be tested; this is
 * the small piece that cannot be. It measures three things and nothing else —
 * where the pane is scrolled to, how tall the visible band is, and how tall
 * one row turned out to be — then feeds them to computeRowWindow.
 *
 * Both layouts the app uses are handled by the same code (see visibleSpan):
 * on desktop the `.scroll-y` pane scrolls inside itself, and on a phone it
 * becomes `overflow: visible` and the page scrolls instead, so this listens on
 * the pane AND on the window.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  computeRowWindow,
  DEFAULT_ROW_HEIGHT_PX,
  paneSelfScrolls,
  type RowWindow,
  rowsPerPage,
  scrollTopForRow,
  visibleSpan,
} from './virtualRows';

/**
 * The spacer rows every virtualised table draws above and below its window.
 *
 * Inline rather than a class because the table styling in meshterm.css lights
 * a hovered row and draws a rule under every cell, and a spacer standing in
 * for 100,000 frames must do neither: without this a mouse resting anywhere in
 * the blank region paints a solid bar three million pixels tall, and the
 * borders would add a pixel per spacer to a height the window arithmetic has
 * already accounted for exactly.
 */
export const SPACER_ROW_STYLE: CSSProperties = {
  background: 'transparent',
  cursor: 'default',
};

/** Height is the caller's — it is the whole point of the spacer. */
export const SPACER_CELL_STYLE: CSSProperties = { padding: 0, border: 0 };

/** What one read of the pane says, in the pane's own content coordinates. */
interface PaneMetrics {
  /** How far the pane's content has moved up past its top edge. */
  contentTopPx: number;
  /** How much of the pane is on screen. */
  viewportPx: number;
  /** The table header sitting above the first row, inside the same scroller. */
  headerPx: number;
}

const ZERO: PaneMetrics = { contentTopPx: 0, viewportPx: 0, headerPx: 0 };

function readPane(el: HTMLElement, head: HTMLElement | null): PaneMetrics {
  const rect = el.getBoundingClientRect();
  const span = visibleSpan({
    scrollTopPx: el.scrollTop,
    clientHeightPx: el.clientHeight,
    scrollHeightPx: el.scrollHeight,
    rectTopPx: rect.top,
    rectHeightPx: rect.height,
    windowHeightPx: window.innerHeight,
  });
  return {
    contentTopPx: span.scrollTopPx,
    viewportPx: span.viewportPx,
    headerPx: head ? head.getBoundingClientRect().height : 0,
  };
}

const same = (a: PaneMetrics, b: PaneMetrics) =>
  a.contentTopPx === b.contentTopPx &&
  a.viewportPx === b.viewportPx &&
  a.headerPx === b.headerPx;

export interface RowWindowHandle {
  /** Goes on the element that scrolls — the `.scroll-y` pane. */
  scrollRef: (el: HTMLDivElement | null) => void;
  /** Goes on the table's `thead`, so row offsets account for its height. */
  headRef: (el: HTMLTableSectionElement | null) => void;
  /** Goes on one mounted row, so a real row height replaces the guess. */
  rowRef: (el: HTMLTableRowElement | null) => void;
  /** The rows to mount, and the spacers that stand in for the rest. */
  win: RowWindow;
  rowHeightPx: number;
  /** Whole rows on screen: the Page Up / Page Down step. */
  pageRows: number;
  /**
   * Pixels between the bottom of the visible band and the end of the list.
   * Zero means the last row is on screen — which is how a live view decides
   * whether it is still following the stream or the operator has scrolled
   * back to read something.
   */
  distanceToTailPx: number;
  /**
   * Bring a logical position on screen, moving as little as possible. Needed
   * because a selected row may not be mounted at all — the selection lives in
   * the capture, not in the DOM.
   */
  scrollToRow: (position: number) => void;
}

export function useRowWindow(
  rowCount: number,
  opts: { overscan?: number; maxRows?: number } = {},
): RowWindowHandle {
  // The nodes are state, not refs: the listeners and the ResizeObserver have
  // to be re-attached when the pane is mounted, and an effect keyed on a ref
  // would never re-run.
  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null);
  const [headNode, setHeadNode] = useState<HTMLTableSectionElement | null>(null);
  const [metrics, setMetrics] = useState<PaneMetrics>(ZERO);
  const [rowHeightPx, setRowHeightPx] = useState(DEFAULT_ROW_HEIGHT_PX);

  const frame = useRef(0);
  const measure = useCallback(() => {
    if (!scrollNode) return;
    const next = readPane(scrollNode, headNode);
    setMetrics((prev) => (same(prev, next) ? prev : next));
  }, [scrollNode, headNode]);

  // Coalesce to one read per animation frame: a scroll fires far more often
  // than the screen is painted, and each read forces a layout.
  const schedule = useCallback(() => {
    if (frame.current !== 0) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    if (!scrollNode) return;
    schedule();
    scrollNode.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(scrollNode);
    return () => {
      scrollNode.removeEventListener('scroll', schedule);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (frame.current !== 0) {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
      }
    };
  }, [scrollNode, schedule]);

  // A filter that shrank the list, or a capture that grew, changes the pane's
  // scroll height under a window measured against the old one.
  useEffect(() => {
    schedule();
  }, [rowCount, schedule]);

  const rowRef = useCallback((el: HTMLTableRowElement | null) => {
    if (!el) return;
    const height = el.getBoundingClientRect().height;
    // Sub-pixel drift is not a new row height; without the threshold the
    // measurement and the window it produces chase each other every frame.
    if (height > 0) {
      setRowHeightPx((prev) => (Math.abs(prev - height) > 0.5 ? height : prev));
    }
  }, []);

  const win = useMemo(
    () =>
      computeRowWindow({
        rowCount,
        rowHeightPx,
        scrollTopPx: metrics.contentTopPx - metrics.headerPx,
        viewportPx: metrics.viewportPx,
        overscan: opts.overscan,
        maxRows: opts.maxRows,
      }),
    [rowCount, rowHeightPx, metrics, opts.overscan, opts.maxRows],
  );

  const scrollToRow = useCallback(
    (position: number) => {
      const el = scrollNode;
      if (!el) return;
      // Read fresh rather than trust `metrics`: this is usually called right
      // after the selection changed, in the same tick as the scroll it wants.
      const now = readPane(el, headNode);
      const want = scrollTopForRow({
        position,
        rowHeightPx,
        scrollTopPx: now.contentTopPx,
        viewportPx: now.viewportPx,
        headerPx: now.headerPx,
      });
      if (want === now.contentTopPx) return;
      if (paneSelfScrolls(el.scrollHeight, el.clientHeight)) el.scrollTop = want;
      // The page is the scroller on a phone, and `want` is in the pane's
      // coordinates, so move the page by the difference.
      else window.scrollTo({ top: Math.max(0, window.scrollY + want - now.contentTopPx) });
    },
    [scrollNode, headNode, rowHeightPx],
  );

  return {
    scrollRef: setScrollNode,
    headRef: setHeadNode,
    rowRef,
    win,
    rowHeightPx,
    pageRows: rowsPerPage(metrics.viewportPx, rowHeightPx),
    distanceToTailPx: Math.max(
      0,
      metrics.headerPx +
        rowCount * rowHeightPx -
        (metrics.contentTopPx + metrics.viewportPx),
    ),
    scrollToRow,
  };
}
