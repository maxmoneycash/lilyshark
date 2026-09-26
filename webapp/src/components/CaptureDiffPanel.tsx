import { useMemo, useState } from 'react';
import {
  captureEndpoints,
  conversationCoverage,
  coverageNote,
  endpointsOnlyIn,
  frameAddressing,
} from '../lib/conversation';
import {
  diffCaptures,
  type DiffRow,
  diffRows,
  diffSummaryNote,
  isReceivedEvidence,
  offsetLabel,
  witnessSummary,
} from '../lib/captureDiff';
import type { LscapFrame } from '../lib/lscap';
import {
  SPACER_CELL_STYLE,
  SPACER_ROW_STYLE,
  useRowWindow,
} from '../lib/useRowWindow';
import { mapRowWindow } from '../lib/virtualRows';
import { CaptureWindowComparison } from './CaptureWindowComparison';

/**
 * DIFF — two simultaneous receiver captures, side by side.
 *
 * A is the active TRAFFIC tab and B is another open capture. The table can
 * show what each receiver recorded during the same event after their clocks
 * are aligned. Sequential before/after surveys need a different comparison.
 *
 * B comes from the capture slots rather than from a file picker of its own.
 * lib/captureDiff has been able to compare two captures for a while; what it
 * had no way to get was a second capture, because the analyzer held exactly
 * one. Now that several are open, "the other one" is a tab, and the panel
 * never has to load or hold a capture that the rest of the screen cannot see
 * and name.
 *
 * Two devices never share a clock — a .lscap timestamp is that board's own
 * boot-relative microseconds — so lib/captureDiff estimates the offset from
 * multiple distinct shared payloads and reports how much the estimate rests
 * on. Without enough agreement the captures remain separate.
 *
 * The node lists are the endpoint sets of the two captures differenced
 * (lib/conversation). They are only as complete as the addressing each
 * capture proves, so the coverage line beside them says how many frames named
 * no endpoint at all — a node absent from a list may be a node whose frames
 * could not be decoded rather than one that went quiet.
 */

/** One capture this diff could compare against: another open tab. */
export interface DiffCandidate {
  id: string;
  name: string;
  frameCount: number;
}

interface CaptureDiffPanelProps {
  /** Capture A: whatever the TRAFFIC table currently has open. */
  aName: string;
  aFrames: LscapFrame[];
  /** Capture B: another open capture, or null while none is picked. */
  bName: string;
  bFrames: LscapFrame[] | null;
  /** The other open captures, in tab order. */
  candidates: DiffCandidate[];
  /** Slot id of B, "" for none. */
  bId: string;
  onPickB: (id: string) => void;
  /** Select this frame in the main table — a diff row is a way into A. */
  onSelectA: (index: number) => void;
  onClose: () => void;
}

/** Stable empties, so a render with no B does not churn identities. */
const EMPTY_FRAMES: LscapFrame[] = [];
const EMPTY_ROWS: DiffRow[] = [];

/** Columns in the row table, so a spacer row spans exactly the table. */
const COLUMNS = 7;

export function CaptureDiffPanel({
  aName,
  aFrames,
  bName,
  bFrames,
  candidates,
  bId,
  onPickB,
  onSelectA,
  onClose,
}: CaptureDiffPanelProps) {
  const [mode, setMode] = useState<'same-event' | 'separate-visits'>('same-event');
  // One memo for the whole comparison: the matching, the rows it produces and
  // the endpoint sets all read the same two frame lists, and splitting them
  // apart only invites a dependency list that re-runs the matching whenever
  // this panel re-renders for an unrelated reason.
  const comparison = useMemo(() => {
    if (!bFrames || mode !== 'same-event') return null;
    const diff = diffCaptures(aFrames, bFrames);
    const addressA = aFrames.filter(isReceivedEvidence)
      .map((fr) => frameAddressing(fr.bytes, fr.profileId));
    const addressB = bFrames.filter(isReceivedEvidence)
      .map((fr) => frameAddressing(fr.bytes, fr.profileId));
    const endpointsA = captureEndpoints(addressA);
    const endpointsB = captureEndpoints(addressB);
    const onlyA = endpointsOnlyIn(endpointsA, endpointsB);
    return {
      diff,
      rows: diffRows(aFrames, bFrames, diff),
      summary: witnessSummary(diff),
      nodes: {
        onlyA,
        onlyB: endpointsOnlyIn(endpointsB, endpointsA),
        both: endpointsA.length - onlyA.length,
        note: `A: ${coverageNote(conversationCoverage(addressA))} · B: ${coverageNote(
          conversationCoverage(addressB),
        )}`,
      },
    };
  }, [aFrames, bFrames, mode]);
  const diff = comparison?.diff ?? null;
  const rows = comparison?.rows ?? EMPTY_ROWS;
  const summary = comparison?.summary ?? null;
  const nodes = comparison?.nodes ?? null;
  const shownB = bFrames ?? EMPTY_FRAMES;

  const rowFileLabel = (row: DiffRow): string => {
    if (row.pair) return 'A + B';
    const side = row.aIndex !== null ? 'A' : 'B';
    const frame = row.aIndex !== null
      ? aFrames[row.aIndex] : shownB[row.bIndex ?? 0];
    if (frame.synthetic) return `${side} GENERATED`;
    if (frame.direction !== 'rx') return `${side} ${frame.direction.toUpperCase()}`;
    return `${side} ${diff?.offsetSource === 'none' ? 'UNPAIRED RX' : 'ONLY RX'}`;
  };

  // A diff of two full captures runs to hundreds of thousands of rows. The
  // table used to draw the first 400 and say so; it draws a window now and
  // every row is reachable by scrolling to it.
  const table = useRowWindow(rows.length);

  const nodeList = (addresses: string[]) =>
    addresses.length === 0 ? (
      <span className="dim">none</span>
    ) : (
      <span style={{ wordBreak: 'break-all' }}>{addresses.join(' · ')}</span>
    );

  return (
    <div className="panel traffic-diff">
      <div className="panel-title">
        DIFF // A vs B
        <span className="spacer" />
        <button onClick={onClose}>CLOSE</button>
      </div>

      <div className="kv">
        <span className="k">A</span>
        <span className="v">
          {aName || 'the open capture'} · {aFrames.length.toLocaleString()} frame(s)
        </span>
        <span className="k">B</span>
        <span className="v">
          {bFrames ? (
            `${bName} · ${shownB.length.toLocaleString()} frame(s)`
          ) : (
            <span className="dim">
              none picked — B is another open capture, so open the second .lscap
              with OPEN, SAMPLE or FETCH and it becomes a tab you can pick here.
            </span>
          )}
        </span>
      </div>

      {/* Every other open capture, as a choice. A is not offered: comparing a
          capture with itself answers nothing. */}
      <div
        className="panel-foot"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <span className="k">COMPARE WITH</span>
        {candidates.length === 0 ? (
          <span className="dim">
            no other capture is open — the analyzer holds several at once, and a
            diff needs two of them
          </span>
        ) : (
          candidates.map((c) => (
            <button
              key={c.id}
              className={c.id === bId ? 'primary' : ''}
              title={`Compare against ${c.name} · ${c.frameCount.toLocaleString()} frame(s)`}
              onClick={() => onPickB(c.id === bId ? '' : c.id)}
            >
              {c.name}
            </button>
          ))
        )}
      </div>

      <div className="panel-foot" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span className="k">QUESTION</span>
        <button className={mode === 'same-event' ? 'primary' : ''}
          aria-pressed={mode === 'same-event'}
          onClick={() => setMode('same-event')}>SAME EVENT · TWO RECEIVERS</button>
        <button className={mode === 'separate-visits' ? 'primary' : ''}
          aria-pressed={mode === 'separate-visits'}
          onClick={() => setMode('separate-visits')}>SEPARATE VISITS</button>
      </div>

      {mode === 'separate-visits' && bFrames && (
        <CaptureWindowComparison aName={aName} aFrames={aFrames}
          bName={bName} bFrames={bFrames} />
      )}

      {diff && summary && nodes && (
        <>
          <div className="stat-strip">
            <span className="stat">
              <span className="k">SHARED MATCHES</span>
              <span className="v">{summary.bothHeard}</span>
            </span>
            <span className="stat">
              <span className="k">{diff.offsetSource === 'none' ? 'A UNPAIRED RX' : 'ONLY A RX'}</span>
              <span className="v warn">{summary.onlyA}</span>
            </span>
            <span className="stat">
              <span className="k">{diff.offsetSource === 'none' ? 'B UNPAIRED RX' : 'ONLY B RX'}</span>
              <span className="v warn">{summary.onlyB}</span>
            </span>
            <span className="stat">
              <span className="k">CLOCK OFFSET</span>
              <span className={`v ${diff.offsetSource === 'none' ? 'warn' : ''}`}>
                {diff.offsetSource === 'none' ? 'unaligned' : offsetLabel(diff.offsetUs)}
              </span>
            </span>
            {(diff.ineligibleA + diff.ineligibleB > 0) && (
              <span className="stat">
                <span className="k">OTHER RECORDS A / B</span>
                <span className="v">{diff.ineligibleA} / {diff.ineligibleB}</span>
              </span>
            )}
            <span className="stat">
              <span className="k">MEAN ΔRSSI</span>
              <span className="v">
                {summary.meanRssiDeltaDb === null
                  ? '—'
                  : `${summary.meanRssiDeltaDb > 0 ? '+' : ''}${summary.meanRssiDeltaDb.toFixed(1)} DB`}
              </span>
            </span>
            <span className="stat">
              <span className="k">MEAN ΔSNR</span>
              <span className="v">
                {summary.meanSnrDeltaDb === null
                  ? '—'
                  : `${summary.meanSnrDeltaDb > 0 ? '+' : ''}${summary.meanSnrDeltaDb.toFixed(1)} DB`}
              </span>
            </span>
          </div>

          <div className="panel-foot" style={{ display: 'block' }}>
            {diffSummaryNote(diff)}
          </div>

          <div className="panel-foot dim" style={{ display: 'block' }}>
            Use captures of the same event. A missing frame is only missing from this
            receiver's capture. It does not prove that a remote relay failed or that a
            location has no coverage. Matching bytes and aligned times are consistent
            with shared reception; they do not prove independent receivers.
          </div>

          <div className="kv">
            <span className="k">RX NODES ONLY IN A</span>
            <span className="v">{nodeList(nodes.onlyA)}</span>
            <span className="k">RX NODES ONLY IN B</span>
            <span className="v">{nodeList(nodes.onlyB)}</span>
            <span className="k">RX NODES IN BOTH</span>
            <span className="v">{nodes.both}</span>
            <span className="k">ADDRESSING</span>
            <span className="v dim">{nodes.note}</span>
          </div>

          <div className="scroll-y" ref={table.scrollRef}>
            <div className="scroll-x">
              <table className="grid">
                <thead ref={table.headRef}>
                  <tr>
                    <th>{diff.offsetSource === 'none' ? 'LOCAL TIME' : 'TIME'}</th>
                    <th>{diff.offsetSource === 'none' ? 'FILE' : 'HEARD BY'}</th>
                    <th>LEN</th>
                    <th>A RSSI</th>
                    <th>B RSSI</th>
                    <th>ΔRSSI</th>
                    <th>ΔSNR</th>
                  </tr>
                </thead>
                <tbody>
                  {table.win.topPadPx > 0 && (
                    <tr aria-hidden="true" style={SPACER_ROW_STYLE}>
                      <td
                        colSpan={COLUMNS}
                        style={{ ...SPACER_CELL_STYLE, height: table.win.topPadPx }}
                      />
                    </tr>
                  )}
                  {mapRowWindow(rows, table.win, (row, position) => (
                    <tr
                      key={`${row.kind}:${row.aIndex ?? 'x'}:${row.bIndex ?? 'x'}`}
                      ref={position === table.win.start ? table.rowRef : undefined}
                      onClick={() => row.aIndex !== null && onSelectA(row.aIndex)}
                      style={{ cursor: row.aIndex !== null ? 'pointer' : 'default' }}
                      title={
                        row.aIndex !== null
                          ? 'Show this frame in the capture table'
                          : diff.offsetSource === 'none'
                            ? 'This frame is in B; no aligned comparison is available'
                            : 'This frame is only in B, which the table above does not hold'
                      }
                    >
                      <td>{row.timeS.toFixed(3)}</td>
                      <td className={row.kind === 'both' ? 'ok' : 'warn'}>
                        {rowFileLabel(row)}
                      </td>
                      <td>
                        {row.pair
                          ? row.pair.payloadLength
                          : row.aIndex !== null
                            ? aFrames[row.aIndex].capturedLength
                            : shownB[row.bIndex ?? 0].capturedLength}
                      </td>
                      <td>{row.pair?.a.rssiDbm?.toFixed(1) ?? '—'}</td>
                      <td>{row.pair?.b.rssiDbm?.toFixed(1) ?? '—'}</td>
                      <td>
                        {row.pair?.rssiDeltaDb === null || row.pair === null
                          ? '—'
                          : `${row.pair.rssiDeltaDb > 0 ? '+' : ''}${row.pair.rssiDeltaDb.toFixed(1)}`}
                      </td>
                      <td>
                        {row.pair?.snrDeltaDb === null || row.pair === null
                          ? '—'
                          : `${row.pair.snrDeltaDb > 0 ? '+' : ''}${row.pair.snrDeltaDb.toFixed(1)}`}
                      </td>
                    </tr>
                  ))}
                  {table.win.bottomPadPx > 0 && (
                    <tr aria-hidden="true" style={SPACER_ROW_STYLE}>
                      <td
                        colSpan={COLUMNS}
                        style={{ ...SPACER_CELL_STYLE, height: table.win.bottomPadPx }}
                      />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel-foot">
            {rows.length.toLocaleString()} ROWS · {diff.offsetSource === 'none'
              ? 'EACH FILE USES ITS OWN FIRST RECORDED FRAME AS TIME ZERO'
              : "TIME IS SECONDS ON THE ALIGNED CLOCK, FROM A'S FIRST FRAME"}
          </div>
        </>
      )}
    </div>
  );
}
