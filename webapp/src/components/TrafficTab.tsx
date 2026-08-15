import { useMemo, useRef, useState } from 'react';
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

/**
 * Traffic — the analyzer. Opens a .lscap capture written by the T-Deck firmware,
 * locally or by Shelby blob name, and reads it the way a protocol analyzer does:
 * frames on top, the selected frame's radio measurements and bytes below.
 */

const fmtFreq = (hz: number) =>
  hz >= 1_000_000 ? `${(hz / 1_000_000).toFixed(3)} MHz` : `${(hz / 1000).toFixed(1)} kHz`;

const crcClass = (c: LscapFrame['crc']) => (c === 'valid' ? 'ok' : c === 'invalid' ? 'bad' : 'dim');

export function TrafficTab() {
  const [capture, setCapture] = useState<LscapCapture | null>(null);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (buf: ArrayBuffer, from: string) => {
    try {
      const c = parseLscap(buf);
      setCapture(c); setName(from); setSelected(0);
      setError(c.trailingBytes > 0
        ? `${c.trailingBytes} trailing byte(s) were not a complete record — the capture may have been cut mid-flush.`
        : null);
    } catch (e) {
      setCapture(null);
      setError(e instanceof LscapParseError ? e.message : 'That file is not a .lscap capture');
    }
  };

  const openFile = async (f: File) => {
    setBusy(true);
    try { load(await f.arrayBuffer(), f.name); } finally { setBusy(false); }
  };

  const fetchBlob = async () => {
    const n = blob.trim(); if (!n) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/share/view/${encodeURIComponent(n)}`);
      if (!res.ok) throw new Error(`Shelby returned HTTP ${res.status}`);
      load(await res.arrayBuffer(), n);
    } catch (e) {
      setCapture(null);
      setError(e instanceof Error ? e.message : 'Could not fetch that blob');
    } finally { setBusy(false); }
  };

  /** The bundled demo capture: 24 frames of LongFast traffic with a Shelby
      pointer at sequence 9. No device, no upload — always works. */
  const openSample = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/sample-mesh-traffic.lscap');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load(await res.arrayBuffer(), 'sample-mesh-traffic.lscap');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the sample capture');
    } finally { setBusy(false); }
  };

  const frames = capture?.frames ?? [];
  const stats = useMemo(() => summarize(frames), [frames]);
  // Scan every payload once: a pointer rides behind whatever protocol header
  // enclosed it, so any frame may carry one.
  const pointers = useMemo(() => frames.map((f) => findShelbyPointer(f.bytes)), [frames]);
  const t0 = frames.length ? frames[0].timestampUs : 0n;
  const f = frames[selected];
  const ptr = f ? pointers[selected] : null;

  return (
    <div className="ls-stack">
      {/* ── Source ─────────────────────────────────────────────────── */}
      <div box-="round">
        <div className="ls-bar">
          <span is-="badge" variant-="background2">CAPTURE</span>
          <button variant-="accent" onClick={() => fileRef.current?.click()} disabled={busy}>
            Open .lscap
          </button>
          <button variant-="background1" onClick={() => void openSample()} disabled={busy}>
            Sample
          </button>
          <input ref={fileRef} type="file" accept=".lscap,application/octet-stream" hidden
            onChange={(e) => { const x = e.target.files?.[0]; if (x) void openFile(x); }} />
          <input is-="input" placeholder="…or a Shelby blob name" value={blob}
            onChange={(e) => setBlob(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void fetchBlob()} />
          <button variant-="background1" onClick={() => void fetchBlob()} disabled={busy || !blob.trim()}>
            Fetch
          </button>
          {name && <span className="ls-muted">{name}</span>}
        </div>

        {error && (
          <div className="ls-pad">
            <span className="bad">{error}</span>
          </div>
        )}

        {!capture && !busy && !error && (
          <div className="ls-hero">
            <img className="ls-device" src="/lilyshark-device.png"
                 alt="A LILYGO T-Deck running Lilyshark, showing a live frame feed" />
            <div>
              <h1>Read what is on the air</h1>
              <p>
                Lilyshark turns a LILYGO T-Deck into a handheld LoRa analyzer. It captures
                Meshtastic, MeshCore, and Reticulum frames with their radio measurements and
                writes them to microSD as <code>.lscap</code>.
              </p>
              <div className="ls-actions">
                <button variant-="accent" onClick={() => void openSample()} disabled={busy}>
                  Open a sample capture
                </button>
                <button variant-="background1" onClick={() => fileRef.current?.click()} disabled={busy}>
                  Open your own
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {capture && (
        <>
          {/* ── Readouts ─────────────────────────────────────────── */}
          <dl className="ls-readouts">
            <div className="ls-readout"><dt>Frames</dt><dd>{stats.frames.toLocaleString()}</dd></div>
            <div className="ls-readout"><dt>Payload</dt><dd>{stats.bytes.toLocaleString()}<span> B</span></dd></div>
            <div className="ls-readout"><dt>CRC</dt>
              <dd>
                <span className="ok">{stats.crcValid}</span>
                <span className="dim"> / </span>
                <span className={stats.crcInvalid ? 'bad' : 'dim'}>{stats.crcInvalid}</span>
              </dd>
            </div>
            <div className="ls-readout"><dt>Best SNR</dt><dd>{stats.bestSnrDb?.toFixed(1) ?? '—'}<span> dB</span></dd></div>
            <div className="ls-readout"><dt>Median RSSI</dt><dd>{stats.medianRssiDbm?.toFixed(1) ?? '—'}<span> dBm</span></dd></div>
            <div className="ls-readout"><dt>Airtime</dt><dd>{stats.airtimeMs.toFixed(0)}<span> ms</span></dd></div>
            <div className="ls-readout"><dt>Shelby pointers</dt>
              <dd className={pointers.some(Boolean) ? 'ok' : undefined}>{pointers.filter(Boolean).length}</dd></div>
          </dl>

          {/* ── Frames ───────────────────────────────────────────── */}
          <div box-="round">
            <div className="ls-tablewrap ls-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>Time</th><th>Dir</th><th>Len</th>
                    <th>Frequency</th><th>SF/CR</th><th>RSSI</th><th>SNR</th><th>CRC</th>
                  </tr>
                </thead>
                <tbody>
                  {frames.map((fr, i) => (
                    <tr key={i} aria-selected={i === selected} onClick={() => setSelected(i)}
                        tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelected(i)}>
                      <td>
                        {Number(fr.sequence)}
                        {pointers[i] && <span className="ok" title="Carries a Shelby pointer"> ◆</span>}
                      </td>
                      <td>{(Number(fr.timestampUs - t0) / 1e6).toFixed(3)}</td>
                      <td>{fr.direction.toUpperCase()}</td>
                      <td>{fr.capturedLength}{fr.truncated && <span className="warn">*</span>}</td>
                      <td>{hasField(fr, RF_FIELD.frequency) ? fmtFreq(fr.centerFrequencyHz) : '—'}</td>
                      <td>{fr.spreadingFactor}/{fr.codingRateDenominator}</td>
                      <td>{hasField(fr, RF_FIELD.rssi) ? fr.rssiDbm.toFixed(1) : '—'}</td>
                      <td>{hasField(fr, RF_FIELD.snr) ? fr.snrDb.toFixed(1) : '—'}</td>
                      <td className={crcClass(fr.crc)}>{fr.crc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Selected frame ───────────────────────────────────── */}
          {f && (
            <div>
              <div box-="round">
                <div className="ls-bar"><span is-="badge" variant-="background2">FRAME {Number(f.sequence)}</span></div>
                <div className="ls-pad">
                  <dl className="ls-kv">
                    <dt>Modulation</dt><dd>{f.modulation.toUpperCase()}</dd>
                    <dt>Captured</dt><dd>{f.capturedLength} / {f.originalLength} B</dd>
                    <dt>Frequency</dt><dd>{hasField(f, RF_FIELD.frequency) ? fmtFreq(f.centerFrequencyHz) : 'n/r'}</dd>
                    <dt>Bandwidth</dt><dd>{hasField(f, RF_FIELD.bandwidth) ? fmtFreq(f.bandwidthHz) : 'n/r'}</dd>
                    <dt>Spreading</dt><dd>SF{f.spreadingFactor}</dd>
                    <dt>Coding rate</dt><dd>4/{f.codingRateDenominator}</dd>
                    <dt>RSSI</dt><dd>{hasField(f, RF_FIELD.rssi) ? `${f.rssiDbm.toFixed(1)} dBm` : 'n/r'}</dd>
                    <dt>SNR</dt><dd>{hasField(f, RF_FIELD.snr) ? `${f.snrDb.toFixed(1)} dB` : 'n/r'}</dd>
                    <dt>Airtime</dt><dd>{hasField(f, RF_FIELD.airtime) ? `${(f.airtimeUs / 1000).toFixed(1)} ms` : 'n/r'}</dd>
                    <dt>Sync word</dt><dd>{hasField(f, RF_FIELD.syncWord) ? `0x${f.syncWord.toString(16).toUpperCase()}` : 'n/r'}</dd>
                    <dt>Integrity</dt><dd className={crcClass(f.crc)}>{f.crc}</dd>
                  </dl>
                </div>
              </div>

              <div box-="round">
                <div className="ls-bar">
                  <span is-="badge" variant-="background2">{ptr ? 'SHELBY POINTER' : 'RAW BYTES'}</span>
                  {ptr && <span className="ls-muted">at offset {ptr.offset}</span>}
                </div>
                <div className="ls-panel-b ls-scroll">
                  {ptr ? (
                    <dl className="ls-kv">
                      <dt>Commitment</dt><dd>{ptr.pointer.commitment}</dd>
                      <dt>Owner</dt><dd>{ptr.pointer.owner}</dd>
                      <dt>Blob size</dt><dd>{ptr.pointer.sizeBytes.toLocaleString()} B</dd>
                      <dt>Chunk</dt><dd>{ptr.pointer.chunkIndex + 1} / {ptr.pointer.chunkCount}</dd>
                      <dt>Encrypted</dt><dd className={ptr.pointer.encrypted ? 'ok' : 'dim'}>{ptr.pointer.encrypted ? 'yes' : 'no'}</dd>
                    </dl>
                  ) : (
                    <pre className="ls-hex">{f.capturedLength ? hexDump(f.bytes) : 'no payload captured'}</pre>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
