import { useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  type findShelbyPointer,
  hasField,
  type LscapFrame,
  RF_FIELD,
} from '../lib/lscap';
import { frameTimeS } from '../lib/trafficView';
import {
  SPACER_CELL_STYLE,
  SPACER_ROW_STYLE,
  useRowWindow,
} from '../lib/useRowWindow';
import { mapRowWindow, tableKeyNav } from '../lib/virtualRows';
import { crcClass, fmtFreq } from './trafficFormat';

/**
 * The TRAFFIC frame table.
 *
 * Split out of TrafficTab for two reasons. One is virtualisation: the table
 * mounts a screenful of rows and two spacers, so a capture may run to 128,000
 * frames without the browser being asked to lay out 128,000 table rows — the
 * arithmetic is in lib/virtualRows.ts and the measuring in lib/useRowWindow.
 * The other is that the TRAFFIC panel is shared: what sits above this table is
 * a separate component, and keeping the table's whole implementation here is
 * what lets the two change without touching each other.
 *
 * Two index spaces meet here and must not be confused:
 *
 *   - a FRAME INDEX is a position in the capture, and is what `selected`,
 *     `pointers` and the diff panel all speak in;
 *   - a POSITION is a row number in `shown`, the display filter's output,
 *     which is what the window and the keyboard walk.
 *
 * `shown` holds frame indices, so `shown[position]` converts one to the other
 * and a filtered view never renumbers the capture.
 */

type PointerHit = ReturnType<typeof findShelbyPointer>;

interface TrafficFrameTableProps {
  frames: LscapFrame[];
  /** Frame indices in display order — the display filter's output. */
  shown: number[];
  /** Shelby pointer hits, indexed by frame index like `frames`. */
  pointers: readonly PointerHit[];
  /** The capture's first timestamp, for the relative TIME column. */
  t0Us: bigint;
  /** Selected FRAME INDEX, or -1 for nothing selected. */
  selected: number;
  onSelect: (frameIndex: number) => void;
  /** Keep the newest frame on screen while a live stream is appending. */
  follow: boolean;
}

/** How close to the end of the list still counts as following, in CSS px. */
const FOLLOW_SLACK_PX = 120;

/** Columns in the header, so a spacer row spans exactly the table. */
const COLUMNS = 10;

export function TrafficFrameTable({
  frames,
  shown,
  pointers,
  t0Us,
  selected,
  onSelect,
  follow,
}: TrafficFrameTableProps) {
  const rows = useRowWindow(shown.length);
  const { distanceToTailPx, pageRows, win, scrollToRow } = rows;

  // Where the selected frame sits in the filtered list. -1 when the filter
  // hides it, which is a real state: the detail pane still shows that frame.
  const selectedPosition = useMemo(
    () => (selected < 0 ? -1 : shown.indexOf(selected)),
    [shown, selected],
  );

  // A selection made anywhere else — the diff panel, a Shelby resolve landing
  // on a pointer frame, the sample opening itself — may name a row that is not
  // mounted, so the table has to go to it rather than assume it is on screen.
  useEffect(() => {
    if (selectedPosition >= 0) scrollToRow(selectedPosition);
  }, [selectedPosition, scrollToRow]);

  // Following the tail of a live stream, but only while the operator has not
  // scrolled back to study something — the rule every log viewer uses. The
  // distance is read through a ref so that arriving frames, and not a scroll,
  // are what re-runs this. Turning the stream ON always jumps to the tail:
  // otherwise a live view opened over a long capture sits at frame 0 and
  // looks frozen while every arrival lands below the fold.
  const rowCount = shown.length;
  const tailRef = useRef(distanceToTailPx);
  tailRef.current = distanceToTailPx;
  const wasFollowing = useRef(false);
  useEffect(() => {
    if (!follow) {
      wasFollowing.current = false;
      return;
    }
    if (rowCount === 0) return;
    const starting = !wasFollowing.current;
    wasFollowing.current = true;
    if (starting || tailRef.current <= FOLLOW_SLACK_PX) scrollToRow(rowCount - 1);
  }, [follow, rowCount, scrollToRow]);

  // Keyboard navigation walks POSITIONS, not DOM siblings: the next row down
  // may be three screens away and not mounted at all.
  const rowNodes = useRef(new Map<number, HTMLTableRowElement>());
  const wantFocus = useRef(false);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTableSectionElement>) => {
    const from = selectedPosition >= 0 ? selectedPosition : win.start;
    const nav = tableKeyNav(from, shown.length, event.key, pageRows);
    if (!nav) return;
    event.preventDefault();
    wantFocus.current = true;
    onSelect(shown[nav.position]);
  };

  // The row the keyboard moved to may not exist yet — it mounts once the
  // scroll this triggered has been measured — so this runs again on every
  // window change until the row is there to take focus.
  useEffect(() => {
    if (!wantFocus.current || selectedPosition < 0) return;
    const node = rowNodes.current.get(selectedPosition);
    if (!node) return;
    wantFocus.current = false;
    node.focus({ preventScroll: true });
  }, [selectedPosition, win.start, win.end]);

  // One tab stop for the whole table: the selected row while it is mounted,
  // and otherwise the first row that is, so scrolling away from the selection
  // never leaves the table unreachable from the keyboard.
  const roving =
    selectedPosition >= win.start && selectedPosition < win.end
      ? selectedPosition
      : win.start;

  return (
    <div className="scroll-y" ref={rows.scrollRef}>
      <div className="scroll-x">
        <table className="grid">
          <thead ref={rows.headRef}>
            <tr>
              <th>#</th>
              <th>TIME</th>
              <th>DIR</th>
              <th>LEN</th>
              <th>FREQUENCY</th>
              <th>SF/CR</th>
              <th>RSSI</th>
              <th>SNR</th>
              <th>ORIGIN</th>
              <th>CRC</th>
            </tr>
          </thead>
          <tbody onKeyDown={onKeyDown}>
            {/* The two spacers carry the height of every row that is not
                mounted, so the scrollbar describes the whole capture rather
                than just the window. */}
            {win.topPadPx > 0 && (
              <tr aria-hidden="true" style={SPACER_ROW_STYLE}>
                <td colSpan={COLUMNS} style={{ ...SPACER_CELL_STYLE, height: win.topPadPx }} />
              </tr>
            )}
            {mapRowWindow(shown, win, (i, position) => {
              const fr = frames[i];
              return (
                <tr
                  key={i}
                  ref={(el) => {
                    if (el) rowNodes.current.set(position, el);
                    else rowNodes.current.delete(position);
                    // One real row is measured, so the window's arithmetic
                    // runs on this table's row height and not on the guess.
                    if (position === win.start) rows.rowRef(el);
                  }}
                  className={i === selected ? 'sel' : undefined}
                  tabIndex={position === roving ? 0 : -1}
                  onClick={() => onSelect(i)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    {Number(fr.sequence)}
                    {pointers[i] && (
                      <span className="ok" title="carries a Shelby pointer">
                        {' '}
                        ◆
                      </span>
                    )}
                  </td>
                  <td>{frameTimeS(fr, t0Us).toFixed(3)}</td>
                  <td>{fr.direction.toUpperCase()}</td>
                  <td>
                    {fr.capturedLength}
                    {fr.truncated && <span className="warn">*</span>}
                  </td>
                  <td>
                    {hasField(fr, RF_FIELD.frequency) ? fmtFreq(fr.centerFrequencyHz) : '—'}
                  </td>
                  <td>
                    {fr.spreadingFactor}/{fr.codingRateDenominator}
                  </td>
                  <td>{hasField(fr, RF_FIELD.rssi) ? fr.rssiDbm.toFixed(1) : '—'}</td>
                  <td>{hasField(fr, RF_FIELD.snr) ? fr.snrDb.toFixed(1) : '—'}</td>
                  <td className={fr.synthetic ? 'warn' : 'dim'}>
                    {fr.synthetic ? 'SIM' : 'UNMARKED'}
                  </td>
                  <td className={crcClass(fr.crc)}>{fr.crc}</td>
                </tr>
              );
            })}
            {win.bottomPadPx > 0 && (
              <tr aria-hidden="true" style={SPACER_ROW_STYLE}>
                <td
                  colSpan={COLUMNS}
                  style={{ ...SPACER_CELL_STYLE, height: win.bottomPadPx }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
