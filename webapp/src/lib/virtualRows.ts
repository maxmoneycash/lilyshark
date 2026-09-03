/**
 * Windowed rendering math for the frame tables.
 *
 * A capture is now allowed to be large — an overnight field session is
 * hundreds of thousands of frames — so a table renders only the rows the
 * scrollport can actually show, with two spacer rows standing in for the
 * frames above and below. The *logical* list is unchanged: selection,
 * keyboard navigation and the roving tab stop all walk positions in the shown
 * index set, whether or not the row at a position happens to be mounted.
 *
 * Everything here is arithmetic over plain numbers — no DOM, no React — so it
 * runs under node:test (virtualRows.test.ts), the same way trafficView.ts is
 * the pure half of the IO graph.
 */

/** Rows rendered above and below the scrollport, so a flick never shows gaps. */
export const ROW_OVERSCAN = 12;

/**
 * Hard ceiling on mounted rows, whatever the viewport claims to be.
 *
 * At the table's ~30 px row this covers a 12,000 px scrollport — far past any
 * real display — and it is what bounds the DOM on a layout where the pane does
 * not scroll inside itself (a phone hands scrolling back to the page, so the
 * pane's own client height is the whole list). 400 rows is the number the
 * browser pays for; the capture behind them may be a thousand times longer.
 */
export const MAX_RENDERED_ROWS = 400;

/** Fallback row height, in CSS px, until a rendered row has been measured. */
export const DEFAULT_ROW_HEIGHT_PX = 30;

/** The slice of the logical row list that is mounted, plus its spacers. */
export interface RowWindow {
	/** First rendered position in the shown set, inclusive. */
	start: number;
	/** One past the last rendered position. */
	end: number;
	/** Height of the leading spacer row, standing in for rows [0, start). */
	topPadPx: number;
	/** Height of the trailing spacer row, standing in for [end, rowCount). */
	bottomPadPx: number;
}

const EMPTY_WINDOW: RowWindow = {
	start: 0,
	end: 0,
	topPadPx: 0,
	bottomPadPx: 0,
};

function finite(value: number, fallback: number): number {
	return Number.isFinite(value) ? value : fallback;
}

/**
 * The rows to mount for a scroll position.
 *
 * `scrollTopPx` and `viewportPx` describe the visible band in the row list's
 * own coordinates (see `visibleSpan`, which reads them off the DOM). The
 * window is anchored at the top of that band, extended by `overscan` in both
 * directions and then clipped to `maxRows` — so the number of mounted rows is
 * bounded by a constant no matter how many frames the capture holds.
 */
export function computeRowWindow(opts: {
	rowCount: number;
	rowHeightPx: number;
	scrollTopPx: number;
	viewportPx: number;
	overscan?: number;
	maxRows?: number;
}): RowWindow {
	const rowCount = Math.max(0, Math.floor(finite(opts.rowCount, 0)));
	if (rowCount === 0) return EMPTY_WINDOW;

	const rowHeight = Math.max(
		1,
		finite(opts.rowHeightPx, DEFAULT_ROW_HEIGHT_PX),
	);
	const overscan = Math.max(0, Math.floor(opts.overscan ?? ROW_OVERSCAN));
	const maxRows = Math.max(1, Math.floor(opts.maxRows ?? MAX_RENDERED_ROWS));
	const scrollTop = Math.max(0, finite(opts.scrollTopPx, 0));
	const viewport = Math.max(0, finite(opts.viewportPx, 0));

	const firstVisible = Math.floor(scrollTop / rowHeight);
	const start = Math.min(rowCount - 1, Math.max(0, firstVisible - overscan));
	// +1 for the row the scrollport's top edge cuts through.
	const wanted = Math.ceil(viewport / rowHeight) + 1 + overscan * 2;
	const end = Math.min(
		rowCount,
		start + Math.min(Math.max(1, wanted), maxRows),
	);

	return {
		start,
		end,
		topPadPx: start * rowHeight,
		bottomPadPx: (rowCount - end) * rowHeight,
	};
}

/** Whether a logical position is currently mounted. */
export function rowInWindow(win: RowWindow, position: number): boolean {
	return position >= win.start && position < win.end;
}

/**
 * Render only the mounted slice of a logical row list.
 *
 * The table components go through this rather than `rows.map(...)`, which is
 * what makes "the capture is 128,000 frames and the DOM holds 60 of them" a
 * property of the code rather than a claim about it: `render` is called once
 * per mounted position and not at all for the rest.
 */
export function mapRowWindow<T, R>(
	rows: readonly T[],
	win: RowWindow,
	render: (row: T, position: number) => R,
): R[] {
	const out: R[] = [];
	const end = Math.min(win.end, rows.length);
	for (let position = Math.max(0, win.start); position < end; position++) {
		out.push(render(rows[position], position));
	}
	return out;
}

/**
 * The mounted positions on their own, for a list that is READ in an order
 * other than the one it is stored in — the sniffer keeps frames oldest-first
 * and reads them newest-first, and reversing a copy of the list on every
 * render is exactly the cost virtualisation exists to remove. The array this
 * returns is one window wide, never the list.
 */
export function rowWindowPositions(win: RowWindow): number[] {
	const out: number[] = [];
	for (let position = Math.max(0, win.start); position < win.end; position++) {
		out.push(position);
	}
	return out;
}

/** Whole rows a scrollport shows at once — the Page Up/Down step. */
export function rowsPerPage(viewportPx: number, rowHeightPx: number): number {
	const rowHeight = Math.max(1, finite(rowHeightPx, DEFAULT_ROW_HEIGHT_PX));
	const viewport = Math.max(0, finite(viewportPx, 0));
	return Math.max(1, Math.floor(viewport / rowHeight) - 1);
}

/**
 * The scroll offset that brings a row fully into the scrollport, or the
 * current offset when it is already there ("scroll as little as possible" —
 * the same rule `scrollIntoView({ block: "nearest" })` follows).
 *
 * `headerPx` is whatever sits above the first row inside the scrolling
 * element (the table's own `thead`).
 */
export function scrollTopForRow(opts: {
	position: number;
	rowHeightPx: number;
	scrollTopPx: number;
	viewportPx: number;
	headerPx?: number;
}): number {
	const rowHeight = Math.max(
		1,
		finite(opts.rowHeightPx, DEFAULT_ROW_HEIGHT_PX),
	);
	const header = Math.max(0, finite(opts.headerPx ?? 0, 0));
	const scrollTop = Math.max(0, finite(opts.scrollTopPx, 0));
	const viewport = Math.max(0, finite(opts.viewportPx, 0));
	const top = header + Math.max(0, Math.floor(opts.position)) * rowHeight;
	const bottom = top + rowHeight;
	if (top < scrollTop) return top;
	if (viewport > 0 && bottom > scrollTop + viewport)
		return Math.max(0, bottom - viewport);
	return scrollTop;
}

/**
 * Whether a pane scrolls inside itself, or has handed scrolling back to the
 * page. One pixel of slack: a fractional layout height is not a scrollbar.
 */
export function paneSelfScrolls(
	scrollHeightPx: number,
	clientHeightPx: number,
): boolean {
	return scrollHeightPx - clientHeightPx > 1;
}

/**
 * The visible band of a list, in the list's own coordinates, for either
 * layout the app uses: a pane that scrolls inside itself (desktop), or one
 * that has handed scrolling back to the page (the phone stack, where
 * `.scroll-y` becomes `overflow: visible`).
 */
export function visibleSpan(m: {
	/** The pane's own scroll offset and box. */
	scrollTopPx: number;
	clientHeightPx: number;
	scrollHeightPx: number;
	/** The pane's top edge relative to the page viewport, and its full height. */
	rectTopPx: number;
	rectHeightPx: number;
	/** Height of the page viewport. */
	windowHeightPx: number;
}): { scrollTopPx: number; viewportPx: number } {
	if (paneSelfScrolls(m.scrollHeightPx, m.clientHeightPx))
		return {
			scrollTopPx: Math.max(0, finite(m.scrollTopPx, 0)),
			viewportPx: Math.max(0, finite(m.clientHeightPx, 0)),
		};
	const windowHeight = Math.max(0, finite(m.windowHeightPx, 0));
	const rectTop = finite(m.rectTopPx, 0);
	const rectHeight = Math.max(0, finite(m.rectHeightPx, 0));
	return {
		scrollTopPx: Math.max(0, -rectTop),
		// What is on screen of the pane: its own height, clipped by the page.
		viewportPx: Math.max(
			0,
			Math.min(rectHeight, windowHeight, rectHeight + Math.min(0, rectTop)),
		),
	};
}

/* ── keyboard navigation over the logical list ───────────────────────────
 * A table whose arrows walk DOM siblings only works while every row is
 * mounted. These walk positions instead, so navigation is the same whether
 * the next row is rendered, three screens down, or the 200,000th frame of the
 * capture. */

export interface RowNav {
	/** Position to select — always inside [0, count). */
	position: number;
	/** True when the key was Enter/Space: select in place, do not move. */
	activate: boolean;
}

/**
 * Where a key takes the selection from `position`, or null when the key is
 * not one the table handles (so the event keeps bubbling).
 */
export function tableKeyNav(
	position: number,
	count: number,
	key: string,
	pageRows = 10,
): RowNav | null {
	if (count <= 0) return null;
	const last = count - 1;
	const at = Math.min(last, Math.max(0, Math.floor(position)));
	const page = Math.max(1, Math.floor(pageRows));
	const to = (n: number): RowNav => ({
		position: Math.min(last, Math.max(0, n)),
		activate: false,
	});
	switch (key) {
		case "ArrowDown":
			return to(at + 1);
		case "ArrowUp":
			return to(at - 1);
		case "PageDown":
			return to(at + page);
		case "PageUp":
			return to(at - page);
		case "Home":
			return to(0);
		case "End":
			return to(last);
		case "Enter":
		case " ":
			return { position: at, activate: true };
		default:
			return null;
	}
}
