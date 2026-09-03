import { useMemo, useRef, useState } from 'react';
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
  offsetLabel,
  witnessSummary,
} from '../lib/captureDiff';
import { type LscapCapture, type LscapFrame, LscapParseError, parseLscap } from '../lib/lscap';

/**
 * DIFF — two captures of the same air, side by side.
 *
 * The question this answers is "what changed when I moved the antenna": open
 * the capture taken before as A (it is whatever TRAFFIC already has open),
 * the capture taken after as B, and read what only one of them heard.
 *
 * Two devices never share a clock — a .lscap timestamp is that board's own
 * boot-relative microseconds — so lib/captureDiff estimates the offset from
 * the payloads both files hold and reports how much the estimate rests on.
 * This panel shows that reading rather than hiding it, because a diff aligned
 * on two unrelated clocks is an assumption and the operator has to be able to
 * see when it is one.
 *
 * The node lists are the endpoint sets of the two captures differenced
 * (lib/conversation). They are only as complete as the addressing each
 * capture proves, so the coverage line beside them says how many frames named
 * no endpoint at all — a node absent from a list may be a node whose frames
 * could not be decoded rather than one that went quiet.
 */

interface CaptureDiffPanelProps {
  /** Capture A: whatever the TRAFFIC table currently has open. */
  aName: string;
  aFrames: LscapFrame[];
  /** Select this frame in the main table — a diff row is a way into A. */
  onSelectA: (index: number) => void;
  onClose: () => void;
}

/** Rows past this are not drawn; a two-capture diff can run to thousands. */
const ROW_CAP = 400;

/** Stable empties, so a render with no B does not churn identities. */
const EMPTY_FRAMES: LscapFrame[] = [];
const EMPTY_ROWS: DiffRow[] = [];

export function CaptureDiffPanel({
  aName,
  aFrames,
  onSelectA,
  onClose,
}: CaptureDiffPanelProps) {
  const [b, setB] = useState<{ name: string; capture: LscapCapture } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const openB = async (file: File) => {
    setBusy(true);
    try {
      setB({ name: file.name, capture: parseLscap(await file.arrayBuffer()) });
      setError(null);
    } catch (e) {
      setB(null);
      setError(e instanceof LscapParseError ? e.message : 'not a .lscap capture');
    } finally {
      setBusy(false);
    }
  };

  const bFrames = b?.capture.frames ?? EMPTY_FRAMES;
  // One memo for the whole comparison: the matching, the rows it produces and
  // the endpoint sets all read the same two frame lists, and splitting them
  // apart only invites a dependency list that re-runs the matching whenever
  // this panel re-renders for an unrelated reason.
  const comparison = useMemo(() => {
    if (!b) return null;
    const frames = b.capture.frames;
    const diff = diffCaptures(aFrames, frames);
    const addressA = aFrames.map((fr) => frameAddressing(fr.bytes, fr.profileId));
    const addressB = frames.map((fr) => frameAddressing(fr.bytes, fr.profileId));
    const endpointsA = captureEndpoints(addressA);
    const endpointsB = captureEndpoints(addressB);
    const onlyA = endpointsOnlyIn(endpointsA, endpointsB);
    return {
      diff,
      rows: diffRows(aFrames, frames, diff),
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
  }, [aFrames, b]);
  const diff = comparison?.diff ?? null;
  const rows = comparison?.rows ?? EMPTY_ROWS;
  const summary = comparison?.summary ?? null;
  const nodes = comparison?.nodes ?? null;

  const nodeList = (addresses: string[]) =>
    addresses.length === 0 ? (
      <span className="dim">none</span>
    ) : (
      <span style={{ wordBreak: 'break-all' }}>{addresses.join(' · ')}</span>
    );

  return (
    <div className="panel" style={{ width: 420, flexShrink: 0 }}>
      <div className="panel-title">
        DIFF // A ↔ B
        <span className="spacer" />
        <button onClick={() => fileRef.current?.click()} disabled={busy}>
          {b ? 'CHANGE B' : 'OPEN B'}
        </button>
        <button onClick={onClose}>CLOSE</button>
        <input
          ref={fileRef}
          type="file"
          accept=".lscap,application/octet-stream"
          hidden
          onChange={(e) => {
            const x = e.target.files?.[0];
            if (x) void openB(x);
          }}
        />
      </div>

      {error && <div className="panel-foot err">{error}</div>}

      <div className="kv">
        <span className="k">A</span>
        <span className="v">
          {aName || 'the open capture'} · {aFrames.length} frame(s)
        </span>
        <span className="k">B</span>
        <span className="v">
          {b ? (
            `${b.name} · ${bFrames.length} frame(s)`
          ) : (
            <span className="dim">
              {busy
                ? 'reading…'
                : 'none open — OPEN B to compare this capture against another .lscap, e.g. the same minutes recorded after the antenna moved'}
            </span>
          )}
        </span>
      </div>

      {diff && summary && nodes && (
        <>
          <div className="stat-strip">
            <span className="stat">
              <span className="k">BOTH HEARD</span>
              <span className="v">{summary.bothHeard}</span>
            </span>
            <span className="stat">
              <span className="k">ONLY A</span>
              <span className="v warn">{summary.onlyA}</span>
            </span>
            <span className="stat">
              <span className="k">ONLY B</span>
              <span className="v warn">{summary.onlyB}</span>
            </span>
            <span className="stat">
              <span className="k">CLOCK OFFSET</span>
              <span className={`v ${diff.offsetSource === 'none' ? 'warn' : ''}`}>
                {diff.offsetSource === 'none' ? 'unaligned' : offsetLabel(diff.offsetUs)}
              </span>
            </span>
            <span className="stat">
              <span className="k">MEAN ΔRSSI</span>
              <span className="v">
                {summary.meanRssiDeltaDb === null
                  ? '—'
                  : `${summary.meanRssiDeltaDb > 0 ? '+' : ''}${summary.meanRssiDeltaDb.toFixed(1)} dB`}
              </span>
            </span>
            <span className="stat">
              <span className="k">MEAN ΔSNR</span>
              <span className="v">
                {summary.meanSnrDeltaDb === null
                  ? '—'
                  : `${summary.meanSnrDeltaDb > 0 ? '+' : ''}${summary.meanSnrDeltaDb.toFixed(1)} dB`}
              </span>
            </span>
          </div>

          <div className="panel-foot" style={{ display: 'block' }}>
            {diffSummaryNote(diff)}
          </div>

          <div className="kv">
            <span className="k">NODES ONLY IN A</span>
            <span className="v">{nodeList(nodes.onlyA)}</span>
            <span className="k">NODES ONLY IN B</span>
            <span className="v">{nodeList(nodes.onlyB)}</span>
            <span className="k">NODES IN BOTH</span>
            <span className="v">{nodes.both}</span>
            <span className="k">ADDRESSING</span>
            <span className="v dim">{nodes.note}</span>
          </div>

          <div className="scroll-y">
            <div className="scroll-x">
              <table className="grid">
                <thead>
                  <tr>
                    <th>TIME</th>
                    <th>HEARD BY</th>
                    <th>LEN</th>
                    <th>A RSSI</th>
                    <th>B RSSI</th>
                    <th>ΔRSSI</th>
                    <th>ΔSNR</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, ROW_CAP).map((row) => (
                    <tr
                      key={`${row.kind}:${row.aIndex ?? 'x'}:${row.bIndex ?? 'x'}`}
                      onClick={() => row.aIndex !== null && onSelectA(row.aIndex)}
                      style={{ cursor: row.aIndex !== null ? 'pointer' : 'default' }}
                      title={
                        row.aIndex !== null
                          ? 'Show this frame in the capture table'
                          : 'This frame is only in B, which the table above does not hold'
                      }
                    >
                      <td>{row.timeS.toFixed(3)}</td>
                      <td className={row.kind === 'both' ? 'ok' : 'warn'}>
                        {row.kind === 'both' ? 'A + B' : row.kind === 'a-only' ? 'A ONLY' : 'B ONLY'}
                      </td>
                      <td>
                        {row.pair
                          ? row.pair.payloadLength
                          : row.aIndex !== null
                            ? aFrames[row.aIndex].capturedLength
                            : bFrames[row.bIndex ?? 0].capturedLength}
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
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel-foot">
            {rows.length > ROW_CAP
              ? `FIRST ${ROW_CAP} OF ${rows.length} ROWS · TIME IS SECONDS ON THE COMMON CLOCK, FROM A'S FIRST FRAME`
              : `${rows.length} ROWS · TIME IS SECONDS ON THE COMMON CLOCK, FROM A'S FIRST FRAME`}
          </div>
        </>
      )}
    </div>
  );
}
