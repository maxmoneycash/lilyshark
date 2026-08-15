import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  findShelbyPointer,
  hasField,
  hexDump,
  type LscapCapture,
  type LscapFrame,
  LscapParseError,
  parseLscap,
  RF_FIELD,
  summarize,
} from '../lib/lscap';
import { demoNextFrame, isDemo } from '../mesh/demo';

/** The live table stops growing here; old frames age out on the left. */
const LIVE_CAP = 250;

/**
 * TRAFFIC — the analyzer. Opens a .lscap capture written by the T-Deck
 * firmware, either from disk or by Shelby blob name.
 *
 * Laid out the way the rest of the terminal is: a `main` holding a list pane
 * and a detail pane, each scrolling inside itself on desktop and stacking into
 * one scrolling column on a phone. `main` is the element the shell gives its
 * spare height to, so it has to be the root here.
 */

const fmtFreq = (hz: number) =>
  hz >= 1_000_000 ? `${(hz / 1_000_000).toFixed(3)} MHz` : `${(hz / 1000).toFixed(1)} kHz`;

const crcClass = (c: LscapFrame['crc']) => (c === 'valid' ? 'ok' : c === 'invalid' ? 'err' : 'dim');

export function TrafficTab() {
  const [capture, setCapture] = useState<LscapCapture | null>(null);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState('');
  const [busy, setBusy] = useState(false);
  // Live mode: synthetic frames keep arriving, the way they would with a
  // radio listening. On by default while the demo mesh is up, so the screen
  // is moving from the first second; opening a file of your own pauses it.
  const [live, setLive] = useState(() => isDemo());
  const liveSeq = useRef(1000);
  const fileRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const load = (buf: ArrayBuffer, from: string) => {
    try {
      const c = parseLscap(buf);
      setCapture(c);
      setName(from);
      // Land on the most interesting frame: the first one carrying a Shelby
      // pointer, so the decoded pointer detail is on screen from the start.
      const ptrIdx = c.frames.findIndex((fr) => findShelbyPointer(fr.bytes));
      setSelected(ptrIdx >= 0 ? ptrIdx : 0);
      setError(
        c.trailingBytes > 0
          ? `${c.trailingBytes} trailing byte(s) were not a complete record`
          : null,
      );
    } catch (e) {
      setCapture(null);
      setError(e instanceof LscapParseError ? e.message : 'not a .lscap capture');
    }
  };

  const openFile = async (f: File) => {
    setBusy(true);
    setLive(false); // the user's own capture is a document, not a stream
    try {
      load(await f.arrayBuffer(), f.name);
    } finally {
      setBusy(false);
    }
  };

  const fetchBlob = async () => {
    const n = blob.trim();
    if (!n) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/view/${encodeURIComponent(n)}`);
      if (!res.ok) throw new Error(`SHELBY HTTP ${res.status}`);
      load(await res.arrayBuffer(), n);
    } catch (e) {
      setCapture(null);
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setBusy(false);
    }
  };

  /** Bundled demo capture: 24 frames with a Shelby pointer at sequence 9. */
  const openSample = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/sample-mesh-traffic.lscap');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load(await res.arrayBuffer(), 'sample-mesh-traffic.lscap');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'sample unavailable');
    } finally {
      setBusy(false);
    }
  };

  // The bundled capture opens itself: an analyzer that lands on an empty panel
  // shows nothing about what it does, and the sample costs one small fetch.
  // Anything the user opens afterwards replaces it as usual.
  useEffect(() => {
    void openSample();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live air: a frame lands every few seconds, timed like a LongFast channel.
  // The table follows the newest frame unless the user has scrolled back up
  // to study something — the same follow rule every log viewer uses.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      setCapture((c) => {
        if (!c) return c;
        const last = c.frames[c.frames.length - 1];
        const seq = liveSeq.current++;
        const f = demoNextFrame(
          seq,
          Number(last ? last.timestampUs : 0n) + 2_400_000 + (seq % 5) * 640_000,
        );
        return { ...c, frames: [...c.frames.slice(-(LIVE_CAP - 1)), f] };
      });
      const el = tableRef.current;
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    }, 2600);
    return () => clearInterval(id);
  }, [live]);

  const frames = capture?.frames ?? [];
  const stats = useMemo(() => summarize(frames), [frames]);
  // A pointer rides behind whatever protocol header enclosed it, so every
  // payload is scanned once rather than only at a fixed offset.
  const pointers = useMemo(() => frames.map((f) => findShelbyPointer(f.bytes)), [frames]);
  const t0 = frames.length ? frames[0].timestampUs : 0n;
  const f = frames[selected];
  const ptr = f ? pointers[selected] : null;

  return (
    <main>
      <div className="panel" style={{ flex: 1 }}>
        <div className="panel-title">
          PANEL // TRAFFIC{name ? ` · ${name}` : ''}
          <span className="spacer" />
          <button onClick={() => fileRef.current?.click()} disabled={busy}>
            OPEN
          </button>
          <button onClick={() => void openSample()} disabled={busy}>
            SAMPLE
          </button>
          <button
            className={live ? 'primary' : ''}
            title="synthetic LongFast air, timed like the real channel"
            onClick={() => setLive((v) => !v)}
          >
            {/* Glyphs the bundled mono actually has — ⏸ fell back to tofu. */}
            {live ? '● LIVE' : '▶ LIVE'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".lscap,application/octet-stream"
            hidden
            onChange={(e) => {
              const x = e.target.files?.[0];
              if (x) void openFile(x);
            }}
          />
          <input
            placeholder="shelby blob name_"
            value={blob}
            style={{ width: 160 }}
            onChange={(e) => setBlob(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void fetchBlob()}
          />
          <button onClick={() => void fetchBlob()} disabled={busy || !blob.trim()}>
            FETCH
          </button>
        </div>

        {error && <div className="panel-foot err">{error}</div>}

        {!capture && (
          <div className="kv">
            <span className="k">CAPTURE</span>
            <span className="v dim">
              {busy
                ? 'reading…'
                : 'none open. The T-Deck writes .lscap to microSD — load the bundled sample to read 24 frames of LongFast traffic, one of them carrying a Shelby pointer.'}
            </span>
          </div>
        )}

        {capture && (
          <>
            {/* One horizontal strip: as a two-column kv this stretched seven
                short readouts down half the panel with the right side empty. */}
            <div className="stat-strip">
              {(
                [
                  ['FRAMES', <>{stats.frames}</>],
                  ['PAYLOAD', <>{stats.bytes.toLocaleString()} B</>],
                  [
                    'CRC',
                    <>
                      <span className="ok">{stats.crcValid} OK</span>
                      {' · '}
                      <span className={stats.crcInvalid ? 'err' : 'dim'}>
                        {stats.crcInvalid} BAD
                      </span>
                    </>,
                  ],
                  ['BEST SNR', <>{stats.bestSnrDb?.toFixed(1) ?? '—'} dB</>],
                  ['MEDIAN RSSI', <>{stats.medianRssiDbm?.toFixed(1) ?? '—'} dBm</>],
                  ['AIRTIME', <>{stats.airtimeMs.toFixed(0)} ms</>],
                  [
                    'SHELBY PTRS',
                    <span className={pointers.some(Boolean) ? 'ok' : 'dim'}>
                      {pointers.filter(Boolean).length}
                    </span>,
                  ],
                ] as [string, ReactNode][]
              ).map(([k, v]) => (
                <span className="stat" key={k}>
                  <span className="k">{k}</span>
                  <span className="v">{v}</span>
                </span>
              ))}
            </div>

            <div className="scroll-y" ref={tableRef}>
              <div className="scroll-x">
              <table className="grid">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>TIME</th>
                    <th>DIR</th>
                    <th>LEN</th>
                    <th>FREQUENCY</th>
                    <th>SF/CR</th>
                    <th>RSSI</th>
                    <th>SNR</th>
                    <th>CRC</th>
                  </tr>
                </thead>
                <tbody>
                  {frames.map((fr, i) => (
                    <tr
                      key={i}
                      className={i === selected ? 'sel' : undefined}
                      onClick={() => setSelected(i)}
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
                      <td>{(Number(fr.timestampUs - t0) / 1e6).toFixed(3)}</td>
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
                      <td className={crcClass(fr.crc)}>{fr.crc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>

            <div className="panel-foot">
              {frames.length} FRAMES · {pointers.filter(Boolean).length} SHELBY POINTER(S)
              {frames.some((fr) => fr.truncated) && (
                <span className="dim">* = FRAME TRUNCATED AT CAPTURE</span>
              )}
            </div>
          </>
        )}
      </div>

      {f && (
        <div className="panel" style={{ width: 360, flexShrink: 0 }}>
          <div className="panel-title">FRAME {Number(f.sequence)}</div>

          <div className="scroll-y">
            <div className="kv">
              <span className="k">MODULATION</span>
              <span className="v">{f.modulation.toUpperCase()}</span>
              <span className="k">CAPTURED</span>
              <span className="v">
                {f.capturedLength} / {f.originalLength} B
              </span>
              <span className="k">FREQUENCY</span>
              <span className="v">
                {hasField(f, RF_FIELD.frequency) ? fmtFreq(f.centerFrequencyHz) : 'n/r'}
              </span>
              <span className="k">BANDWIDTH</span>
              <span className="v">
                {hasField(f, RF_FIELD.bandwidth) ? fmtFreq(f.bandwidthHz) : 'n/r'}
              </span>
              <span className="k">SF / CR</span>
              <span className="v">
                SF{f.spreadingFactor} · 4/{f.codingRateDenominator}
              </span>
              <span className="k">RSSI</span>
              <span className="v">
                {hasField(f, RF_FIELD.rssi) ? `${f.rssiDbm.toFixed(1)} dBm` : 'n/r'}
              </span>
              <span className="k">SNR</span>
              <span className="v">
                {hasField(f, RF_FIELD.snr) ? `${f.snrDb.toFixed(1)} dB` : 'n/r'}
              </span>
              <span className="k">AIRTIME</span>
              <span className="v">
                {hasField(f, RF_FIELD.airtime) ? `${(f.airtimeUs / 1000).toFixed(1)} ms` : 'n/r'}
              </span>
              <span className="k">INTEGRITY</span>
              <span className={`v ${crcClass(f.crc)}`}>{f.crc}</span>
            </div>

            {ptr && (
              <>
                <div className="panel-title">SHELBY POINTER · OFFSET {ptr.offset}</div>
                <div className="kv">
                  <span className="k">COMMITMENT</span>
                  <span className="v">{ptr.pointer.commitment}</span>
                  <span className="k">OWNER</span>
                  <span className="v">{ptr.pointer.owner}</span>
                  <span className="k">BLOB SIZE</span>
                  <span className="v">{ptr.pointer.sizeBytes.toLocaleString()} B</span>
                  <span className="k">CHUNK</span>
                  <span className="v">
                    {ptr.pointer.chunkIndex + 1} / {ptr.pointer.chunkCount}
                  </span>
                </div>
              </>
            )}

            <div className="panel-title">RAW BYTES</div>
            <div style={{ padding: '8px 12px', overflowX: 'auto' }}>
              <pre style={{ margin: 0 }}>
                {/* 8 bytes per row: the 360px detail pane fits it without a
                    horizontal scrollbar, where the classic 16 did not. */}
                {f.capturedLength ? hexDump(f.bytes, 8) : 'no payload captured'}
              </pre>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
