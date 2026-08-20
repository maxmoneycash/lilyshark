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
  APTOS_EXPLORER_ACCOUNT,
  aptosExplorerAccount,
  CAPTURE_REGISTRY,
  CAPTURE_REGISTRY_URL,
  fetchAnchor,
  fetchBlob as fetchBlobBytes,
  fetchUploadInfo,
  publishCapture,
  type PublishResult,
  resolveByCommitment,
  type UploadServiceInfo,
} from '../lib/shelby';
import {
  connectDeviceLink,
  disconnectDeviceLink,
  useDeviceLink,
} from '../lib/deviceLink';
import {
  captureByteLength,
  captureElapsedMs,
  captureFileName,
  captureToLscap,
  clearCapture,
  startCapture,
  stopCapture,
  useCaptureSession,
} from '../lib/captureSession';

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

  // ── capture session ───────────────────────────────────────────────────
  // Recording keeps the full record of every frame the device streams; on
  // stop the session becomes a real .lscap and opens in this same viewer,
  // so the capture is analyzed where it was made.
  const session = useCaptureSession();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!session.recording) return;
    const id = setInterval(() => setTick((v) => v + 1), 500);
    return () => clearInterval(id);
  }, [session.recording]);

  const onStopCapture = () => {
    const done = stopCapture();
    setLive(false);
    if (done.frames.length === 0) {
      setError('capture stopped with no frames — nothing was heard on this channel');
      return;
    }
    const bytes = captureToLscap(done);
    // Copied into a standalone buffer: load() keeps views onto it for the
    // lifetime of the capture.
    load(bytes.slice().buffer, captureFileName(done));
  };

  const onDownloadCapture = () => {
    const bytes = captureToLscap(session);
    const url = URL.createObjectURL(
      new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = captureFileName(session);
    a.click();
    URL.revokeObjectURL(url);
  };

  const recSeconds = Math.floor(captureElapsedMs(session) / 1000);

  // Asked once, when there is a capture to publish. The answer decides whether
  // PUBLISH is an action or an explanation.
  const [uploadInfo, setUploadInfo] = useState<UploadServiceInfo | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState<{
    publish: PublishResult;
    /** 'pending' while the read-back runs; 'ok' or the mismatch reason after. */
    verified: 'pending' | 'ok' | string;
  } | null>(null);

  // A new recording is a new artifact; the previous publish no longer
  // describes what is on screen.
  const sessionStart = session.startedAtMs;
  useEffect(() => {
    setPublished(null);
    setPublishError(null);
  }, [sessionStart]);

  const onPublish = async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      const bytes = captureToLscap(session);
      const res = await publishCapture(bytes, captureFileName(session));
      setPublished({ publish: res, verified: 'pending' });
      // Prove the loop instead of asserting it: read the blob back from the
      // Shelby RPC and compare every byte with what was just sent.
      try {
        const back = new Uint8Array(await fetchBlobBytes(res.owner, res.blobName));
        const same =
          back.length === bytes.length && back.every((b, i) => b === bytes[i]);
        setPublished({
          publish: res,
          verified: same
            ? 'ok'
            : `Shelby served ${back.length} bytes, we sent ${bytes.length}`,
        });
      } catch (e) {
        setPublished({
          publish: res,
          verified: `read-back failed: ${e instanceof Error ? e.message : e}`,
        });
      }
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  };
  const haveCapture = !session.recording && session.frames.length > 0;
  useEffect(() => {
    if (!haveCapture || uploadInfo) return;
    void fetchUploadInfo().then(setUploadInfo);
  }, [haveCapture, uploadInfo]);

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
  /** Capturing needs a device on the cable; there is nothing else to record. */
  const canCapture = link.status === 'linked';

  // TerminalApp already auto-links a granted T-Deck once for the whole
  // session. A second attempt here raced the header CONNECT button and
  // held the USB CDC port while the board was rebooting.

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

  // The #resolve deep link plays the whole loop unattended: TerminalApp opened
  // this tab for it, the sample opens itself below, and the first capture to
  // land gets its pointer frame resolved as if the user had pressed SAMPLE and
  // then RESOLVE. Armed by a ref rather than state because it must fire exactly
  // once: StrictMode runs mount effects twice in dev, and the resolve's own
  // load() makes this capture effect fire again. Declared after the trace
  // reset above so that the reset cannot wipe the trace's opening steps.
  const autoResolveRef = useRef(window.location.hash.toLowerCase() === '#resolve');
  useEffect(() => {
    if (!autoResolveRef.current || !capture) return;
    autoResolveRef.current = false;
    const hit = capture.frames.map((fr) => findShelbyPointer(fr.bytes)).find(Boolean);
    if (hit) void runResolve(hit.pointer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture]);

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
          {/* Record what the linked radio hears, then open it right here. */}
          {session.recording ? (
            <button className="primary" onClick={onStopCapture} title="Stop and open the capture">
              ■ STOP · {session.frames.length}f · {recSeconds}s
            </button>
          ) : (
            <button
              onClick={() => {
                clearCapture();
                startCapture();
                setLive(false);
              }}
              disabled={!canCapture || busy}
              title={
                canCapture
                  ? 'Record every frame the linked device hears'
                  : 'Connect a Lilyshark device to capture'
              }
            >
              ● CAPTURE
            </button>
          )}
          {!session.recording && session.frames.length > 0 && (
            <button onClick={onDownloadCapture} title="Save the .lscap file">
              ⭳ {(captureByteLength(session) / 1024).toFixed(1)} kB
            </button>
          )}
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

        {/* What the capture is, and where its chain of custody would live. */}
        {haveCapture && (
          <div className="panel-foot cap-chain">
            <span className="k">CAPTURE</span>
            <span className="v">
              {session.frames.length} frames · {(captureByteLength(session) / 1024).toFixed(1)} kB ·{' '}
              {recSeconds}s
              {session.containsSynthetic && (
                <span className="warn"> · CONTAINS SIMULATE-MODE FRAMES</span>
              )}
              {session.skippedNoPayload > 0 && (
                <span className="warn">
                  {' '}
                  · {session.skippedNoPayload} frame(s) had no payload to store
                </span>
              )}
            </span>
            <span className="k">ON CHAIN</span>
            <span className="v">
              <a href={CAPTURE_REGISTRY_URL} target="_blank" rel="noreferrer">
                {CAPTURE_REGISTRY.split('::')[1]}
              </a>{' '}
              is deployed on shelbynet ·{' '}
              <a href={APTOS_EXPLORER_ACCOUNT} target="_blank" rel="noreferrer">
                APTOS EXPLORER
              </a>
            </span>
            <span className="k">PUBLISH</span>
            <span className="v">
              {uploadInfo === null ? (
                <span className="dim">checking the share service…</span>
              ) : !uploadInfo.available ? (
                <span className="warn">
                  unavailable — the share service holds no Shelby signing key, so this
                  capture cannot be uploaded or anchored from the browser. Download the
                  .lscap and publish it with <code>webapp/scripts/shelby-put.ts</code>.
                </span>
              ) : published ? (
                <>
                  <a href={published.publish.url} target="_blank" rel="noreferrer">
                    {published.publish.blobName}
                  </a>{' '}
                  · {published.publish.size.toLocaleString()} B on Shelby ·{' '}
                  {published.verified === 'ok' ? (
                    <span className="ok">
                      served back byte-identical — the network holds exactly this capture
                    </span>
                  ) : published.verified === 'pending' ? (
                    <span className="dim">reading it back from Shelby…</span>
                  ) : (
                    <span className="warn">read-back mismatch: {published.verified}</span>
                  )}{' '}
                  ·{' '}
                  <a
                    href={aptosExplorerAccount(published.publish.owner)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    OWNER ON APTOS EXPLORER
                  </a>
                </>
              ) : (
                <>
                  <button disabled={publishing} onClick={() => void onPublish()}>
                    {publishing ? 'PUBLISHING…' : '⇡ PUBLISH TO SHELBY'}
                  </button>{' '}
                  signs as <code>{uploadInfo.uploaderAddress?.slice(0, 10)}…</code> · the
                  upload registers the blob on shelbynet under that account
                  {publishError && <span className="err"> · {publishError}</span>}
                </>
              )}
            </span>
          </div>
        )}

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
                <button onClick={() => void connectDeviceLink()}>RETRY</button>{' '}
                {link.canPick && (
                  <button onClick={() => void connectDeviceLink({ picker: true })}>
                    CHOOSE PORT
                  </button>
                )}
              </span>
            )}
            {link.status === 'linked' && (
              <span className="v ok">
                Lilyshark {link.firmware} over USB{' '}
                {link.telemetry?.sim ? <span className="sim-badge">SIMULATE MODE · SYNTHETIC</span> : null}{' '}
                <button onClick={() => void disconnectDeviceLink()}>UNLINK</button>
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
