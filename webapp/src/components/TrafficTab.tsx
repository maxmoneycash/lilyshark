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
import { startTrafficDemoInterval } from './trafficDemo';
import {
  DEMO_BLOB,
  fetchAnchor,
  fetchBlob as fetchBlobBytes,
  resolveByCommitment,
} from '../lib/shelby';
import { connectDeviceLink, useDeviceLink } from '../lib/deviceLink';

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

interface TrafficTabProps {
  /** True only while TerminalApp is showing its synthetic demo state. */
  demoActive: boolean;
}

export function TrafficTab({ demoActive }: TrafficTabProps) {
  const [capture, setCapture] = useState<LscapCapture | null>(null);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState('');
  const [busy, setBusy] = useState(false);
  // Live demo mode adds synthetic frames at a configured cadence. It is
  // available only while TerminalApp is showing the demo mesh. Opening a file
  // pauses it.
  const [live, setLive] = useState(() => demoActive && isDemo());
  const liveSeq = useRef(1000);
  const fileRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const demoActiveRef = useRef(demoActive);
  demoActiveRef.current = demoActive;
  const simulatedLive = live && demoActive;

  useEffect(() => {
    if (!demoActive) setLive(false);
  }, [demoActive]);

  const load = (buf: ArrayBuffer, from: string) => {
    try {
      const c = parseLscap(buf);
      setCapture(c);
      setName(from);
      // Land on the most interesting frame: the first one carrying a Shelby
      // pointer, so the decoded pointer detail is on screen from the start.
      const ptrIdx = c.frames.findIndex((fr) => findShelbyPointer(fr.bytes));
      setSelected(ptrIdx >= 0 ? ptrIdx : 0);
      // Live frames continue the capture's own numbering; a jump from 23 to
      // 1000 read as a glitch, not a stream.
      liveSeq.current = Number(c.frames[c.frames.length - 1]?.sequence ?? -1n) + 1;
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

  /**
   * Fetch a capture straight from the Shelby RPC. Accepts "owner/blob/name"
   * or a bare blob name, which reads from the demo blob's account.
   */
  const fetchBlob = async () => {
    const n = blob.trim();
    if (!n) return;
    setBusy(true);
    setError(null);
    setLive(false);
    try {
      const [owner, name] = n.startsWith('0x')
        ? [n.slice(0, n.indexOf('/')), n.slice(n.indexOf('/') + 1)]
        : [DEMO_BLOB.owner, n];
      load(await fetchBlobBytes(owner, name), name);
    } catch (e) {
      setCapture(null);
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setBusy(false);
    }
  };

  /**
   * The full off-grid loop, in one click — and narrated on screen while it
   * happens, because to a viewer a bare button press followed by a table
   * reload explains nothing. Each step lands in the trace with its real
   * timing: the indexer lookup that turns a commitment into an object name,
   * the RPC fetch, the size check against what the pointer promised, the
   * on-chain anchor check against the capture registry, and the open. The
   * trace stays up afterward so the story can be read back.
   */
  interface TraceStep {
    label: string;
    detail: string;
    state: 'run' | 'ok' | 'err';
  }
  const [trace, setTrace] = useState<TraceStep[] | null>(null);
  const resolving = trace?.some((t) => t.state === 'run') ?? false;
  const link = useDeviceLink();

  // Shared by the selected frame's RESOLVE and the device link's pointer
  // hand-off: both are the same walk from coordinates to opened capture.
  const runResolve = async (p: { owner: string; commitment: string; sizeBytes: number }) => {
    setLive(false);
    const steps: TraceStep[] = [
      { label: 'POINTER', detail: `82 B decoded from the frame`, state: 'ok' },
      { label: 'INDEXER', detail: 'commitment → object name…', state: 'run' },
    ];
    const show = () => setTrace([...steps]);
    show();
    try {
      let t0 = performance.now();
      const found = await resolveByCommitment(p.owner, p.commitment);
      if (!found) throw new Error('no blob with this commitment under that owner');
      steps[1] = {
        label: 'INDEXER',
        detail: `${found.name} · ${Math.round(performance.now() - t0)} ms`,
        state: 'ok',
      };
      steps.push({ label: 'SHELBY RPC', detail: 'fetching the bytes…', state: 'run' });
      show();

      t0 = performance.now();
      const bytes = await fetchBlobBytes(p.owner, found.name, (attempt, waitMs) => {
        steps[2] = {
          label: 'SHELBY RPC',
          detail: `rate-limited — retrying in ${Math.round(waitMs / 1000)} s (${attempt}/2)…`,
          state: 'run',
        };
        show();
      });
      steps[2] = {
        label: 'SHELBY RPC',
        detail: `${bytes.byteLength.toLocaleString()} B · ${Math.round(performance.now() - t0)} ms`,
        state: 'ok',
      };
      const sizeOk = bytes.byteLength === p.sizeBytes;
      steps.push({
        label: 'VERIFY',
        detail: sizeOk
          ? `size matches the pointer: ${p.sizeBytes.toLocaleString()} B`
          : `size mismatch: pointer said ${p.sizeBytes.toLocaleString()} B`,
        state: sizeOk ? 'ok' : 'err',
      });
      steps.push({ label: 'ANCHOR', detail: 'checking the on-chain registry…', state: 'run' });
      show();

      // The chain check must never block the open: a dead fullnode leaves the
      // anchor unverified, not the capture unreadable.
      t0 = performance.now();
      try {
        const anchor = await fetchAnchor(p.owner, p.commitment);
        steps[steps.length - 1] = anchor
          ? {
              label: 'ANCHOR',
              detail: `vouched on-chain by ${p.owner.slice(0, 6)}…${p.owner.slice(-4)} on ${new Date(anchor.registeredAtUnix * 1000).toISOString().slice(0, 10)} · ${Math.round(performance.now() - t0)} ms`,
              state: 'ok',
            }
          : {
              label: 'ANCHOR',
              detail: 'no on-chain anchor for this commitment',
              state: 'err',
            };
      } catch {
        steps[steps.length - 1] = {
          label: 'ANCHOR',
          detail: 'registry unreachable — anchor unverified',
          state: 'err',
        };
      }
      show();

      keepTrace.current = true;
      load(bytes, found.name);
      steps.push({ label: 'OPENED', detail: `${found.name}`, state: 'ok' });
      show();
    } catch (e) {
      const running = steps.findIndex((s) => s.state === 'run');
      if (running >= 0)
        steps[running] = {
          ...steps[running],
          detail: e instanceof Error ? e.message : 'failed',
          state: 'err',
        };
      show();
    }
  };

  const resolvePointer = () => {
    if (!ptr) return;
    void runResolve(ptr.pointer);
  };

  // A new frame selection is a new story; the old trace would misattribute —
  // except for the load the resolve itself performs, which must keep its
  // trace on screen so the finished story can be read back.
  const keepTrace = useRef(false);
  useEffect(() => {
    if (keepTrace.current) {
      keepTrace.current = false;
      return;
    }
    setTrace(null);
  }, [selected, capture]);

  /** Bundled synthetic capture: 24 frames with a Shelby pointer at sequence 9. */
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

  // Synthetic demo traffic: a frame lands every few seconds.
  // The table follows the newest frame unless the user has scrolled back up
  // to study something — the same follow rule every log viewer uses.
  // Follow from the start — but only once the capture exists; scrolling the
  // still-empty table was a no-op and the live screen opened looking frozen,
  // with every arrival landing below the fold.
  const followInit = useRef(false);
  useEffect(() => {
    if (!simulatedLive) {
      followInit.current = false;
      return;
    }
    if (!capture || followInit.current) return;
    followInit.current = true;
    requestAnimationFrame(() => {
      const el = tableRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [simulatedLive, capture]);

  useEffect(() => {
    return startTrafficDemoInterval(
      simulatedLive,
      () => demoActiveRef.current,
      () => {
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
      },
    );
  }, [simulatedLive]);

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
            className={simulatedLive ? 'primary' : ''}
            title={
              demoActive
                ? 'synthetic LongFast demo, timed like the configured channel'
                : 'synthetic Traffic demo is disabled while a device is connected'
            }
            disabled={!demoActive}
            onClick={() => setLive((v) => !v)}
          >
            {/* Glyphs the bundled mono actually has. The pause glyph rendered as tofu. */}
            {!demoActive ? 'SIM DISABLED' : simulatedLive ? '● SIM LIVE' : '▶ SIM LIVE'}
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

        {link.status !== 'off' && (
          <div className="kv">
            <span className="k">T-DECK LINK</span>
            {link.status === 'connecting' && (
              <span className="v dim">
                connecting… (a reboot on first contact is normal; this waits it out)
              </span>
            )}
            {link.status === 'error' && (
              <span className="v err">
                {link.error}{' '}
                <button onClick={() => void connectDeviceLink()}>RETRY</button>
              </span>
            )}
            {link.status === 'linked' && (
              <span className="v ok">
                Lilyshark {link.firmware} over USB
                {link.telemetry?.sim ? ' · SIMULATE MODE (SYNTHETIC)' : ''}
              </span>
            )}
            {link.status === 'linked' && link.telemetry && (
              <>
                <span className="k">DEVICE</span>
                <span className="v">
                  {link.telemetry.bat} · {link.telemetry.gps} · {link.telemetry.profile} · frame
                  #{link.telemetry.frames} · RSSI {(link.telemetry.rssiX10 / 10).toFixed(1)} dBm ·
                  SNR {(link.telemetry.snrX10 / 10).toFixed(1)} dB
                </span>
              </>
            )}
            {link.status === 'linked' && link.pointer && (
              <>
                <span className="k">POINTER RX</span>
                <span className="v">
                  {link.pointer.sizeBytes.toLocaleString()} B blob · commit{' '}
                  {link.pointer.commitment.slice(0, 10)}…{link.pointer.commitment.slice(-4)}{' '}
                  <button
                    disabled={resolving}
                    onClick={() => {
                      const p = link.pointer;
                      if (p)
                        void runResolve({
                          owner: p.owner,
                          commitment: p.commitment,
                          sizeBytes: p.sizeBytes,
                        });
                    }}
                  >
                    RESOLVE
                  </button>
                </span>
              </>
            )}
          </div>
        )}

        {!capture && (
          <div className="kv">
            <span className="k">CAPTURE</span>
            <span className="v dim">
              {busy
                ? 'reading…'
                : 'none open. The T-Deck writes .lscap to microSD. Load the bundled sample to inspect 24 synthetic LongFast frames, including one Shelby pointer.'}
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
                    <th>ORIGIN</th>
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
                      <td className={fr.synthetic ? 'warn' : 'dim'}>
                        {fr.synthetic ? 'SIM' : 'UNMARKED'}
                      </td>
                      <td className={crcClass(fr.crc)}>{fr.crc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>

            <div className="panel-foot">
              {frames.length} FRAMES · {pointers.filter(Boolean).length} SHELBY POINTER(S)
              {frames.some((fr) => fr.synthetic) && (
                <span className="warn">
                  {frames.filter((fr) => fr.synthetic).length} SYNTHETIC · NOT OTA
                </span>
              )}
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
              <span className="k">ORIGIN</span>
              <span className={`v ${f.synthetic ? 'warn' : 'dim'}`}>
                {f.synthetic ? 'SYNTHETIC · NOT OTA' : 'UNMARKED'}
              </span>
            </div>

            {ptr && (
              <>
                <div className="panel-title">
                  SHELBY POINTER · OFFSET {ptr.offset}
                  <span className="spacer" />
                  <button onClick={() => void resolvePointer()} disabled={resolving}>
                    {resolving ? 'RESOLVING…' : '⇓ RESOLVE'}
                  </button>
                </div>
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

            {trace && (
              <>
                <div className="panel-title">
                  SHELBY RESOLVE
                  <span className="spacer" />
                  {!resolving && (
                    <button onClick={() => setTrace(null)}>DISMISS</button>
                  )}
                </div>
                <div className="trace">
                  {trace.map((t) => (
                    <div className={`trace-step ${t.state}`} key={t.label}>
                      <span className="trace-glyph">
                        {t.state === 'ok' ? '✓' : t.state === 'err' ? '✕' : '▸'}
                      </span>
                      <span className="trace-label">{t.label}</span>
                      <span className="trace-detail">{t.detail}</span>
                    </div>
                  ))}
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
