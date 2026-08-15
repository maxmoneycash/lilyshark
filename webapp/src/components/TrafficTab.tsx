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
 * Traffic — the packet analyzer. Opens a Lilyshark .lscap capture written by the
 * T-Deck firmware (locally, or fetched from Shelby by blob name) and presents it
 * Wireshark-style: frame list on top, decoded detail and hex below.
 */

function fmtFreq(hz: number): string {
  return hz >= 1_000_000 ? `${(hz / 1_000_000).toFixed(3)} MHz` : `${(hz / 1000).toFixed(1)} kHz`;
}

function fmtRelTime(frame: LscapFrame, first: bigint): string {
  return (Number(frame.timestampUs - first) / 1_000_000).toFixed(6);
}

function crcColor(crc: LscapFrame['crc']): string {
  if (crc === 'valid') return 'var(--success, #66F05A)';
  if (crc === 'invalid') return 'var(--danger, #F0655A)';
  return 'var(--muted-fg, #888)';
}

export function TrafficTab() {
  const [capture, setCapture] = useState<LscapCapture | null>(null);
  const [sourceName, setSourceName] = useState<string>('');
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [blobName, setBlobName] = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (buffer: ArrayBuffer, name: string) => {
    try {
      const parsed = parseLscap(buffer);
      setCapture(parsed);
      setSourceName(name);
      setSelected(0);
      setError(
        parsed.trailingBytes > 0
          ? `Opened, but ${parsed.trailingBytes} trailing byte(s) were not a complete record — capture may have been cut mid-flush.`
          : null,
      );
    } catch (e) {
      setCapture(null);
      setError(e instanceof LscapParseError ? e.message : 'Could not read that file as .lscap');
    }
  };

  const onFile = async (file: File) => {
    setLoading(true);
    try {
      load(await file.arrayBuffer(), file.name);
    } finally {
      setLoading(false);
    }
  };

  /** Fetch a capture the device already uploaded to Shelby. */
  const onFetchFromShelby = async () => {
    const name = blobName.trim();
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/view/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`Shelby returned HTTP ${res.status}`);
      load(await res.arrayBuffer(), name);
    } catch (e) {
      setCapture(null);
      setError(e instanceof Error ? e.message : 'Failed to fetch from Shelby');
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => summarize(capture?.frames ?? []), [capture]);
  const frames = capture?.frames ?? [];
  const first = frames.length > 0 ? frames[0].timestampUs : 0n;
  const active = frames[selected];
  // Scan every payload once per capture: a pointer rides behind whatever
  // protocol header enclosed it, so any frame may carry one.
  const shelbyHits = useMemo(() => frames.map((f) => findShelbyPointer(f.bytes)), [frames]);
  const shelbyCount = shelbyHits.reduce((n, hit) => n + (hit ? 1 : 0), 0);
  const activePointer = active ? shelbyHits[selected] : null;

  return (
    <column gap-="1" pad-="1">
      {/* ── Source controls ───────────────────────────────────────── */}
      <box shear-="top">
        <row gap-="1" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <span is-="badge" variant-="foreground1">CAPTURE</span>
          <button onClick={() => fileRef.current?.click()} disabled={loading}>
            Open .lscap
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".lscap,application/octet-stream"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          <span style={{ opacity: 0.5 }}>or</span>
          <input
            type="text"
            placeholder="Shelby blob name…"
            value={blobName}
            onChange={(e) => setBlobName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void onFetchFromShelby()}
            style={{ minWidth: '18rem' }}
          />
          <button onClick={() => void onFetchFromShelby()} disabled={loading || !blobName.trim()}>
            Fetch
          </button>
          {loading && <span is-="spinner" />}
          {sourceName && (
            <span style={{ opacity: 0.7, marginLeft: 'auto' }}>
              {sourceName} · v{capture?.header.majorVersion}.{capture?.header.minorVersion}
            </span>
          )}
        </row>
      </box>

      {error && (
        <box style={{ borderColor: 'var(--danger, #F0655A)' }}>
          <span style={{ color: 'var(--danger, #F0655A)' }}>{error}</span>
        </box>
      )}

      {/* ── Empty state ───────────────────────────────────────────── */}
      {!capture && !loading && (
        <box pad-="2" style={{ textAlign: 'center', opacity: 0.75 }}>
          <p style={{ margin: 0 }}>
            No capture open. Lilyshark firmware writes <code>.lscap</code> files to the T-Deck's
            microSD card and can upload them to Shelby.
          </p>
          <p style={{ margin: '0.5rem 0 0' }}>
            Open a local file, or fetch one by its Shelby blob name.
          </p>
        </box>
      )}

      {capture && (
        <>
          {/* ── Summary strip ───────────────────────────────────── */}
          <row gap-="1" style={{ flexWrap: 'wrap' }}>
            {[
              ['Frames', stats.frames.toLocaleString()],
              ['Payload', `${stats.bytes.toLocaleString()} B`],
              ['CRC ok', `${stats.crcValid}`],
              ['CRC bad', `${stats.crcInvalid}`],
              ['Best SNR', stats.bestSnrDb === null ? '—' : `${stats.bestSnrDb.toFixed(1)} dB`],
              ['Median RSSI', stats.medianRssiDbm === null ? '—' : `${stats.medianRssiDbm.toFixed(1)} dBm`],
              ['Airtime', `${stats.airtimeMs.toFixed(0)} ms`],
              ['Rate', `${stats.framesPerMinute.toFixed(1)}/min`],
              ['SHLB', `${shelbyCount}`],
            ].map(([label, value]) => (
              <box key={label} style={{ minWidth: '9rem', flex: '1 1 auto' }}>
                <column>
                  <span style={{ opacity: 0.6, fontSize: '0.75rem' }}>{label}</span>
                  <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
                </column>
              </box>
            ))}
          </row>

          {/* ── Frame list ──────────────────────────────────────── */}
          <box>
            <div style={{ maxHeight: '38vh', overflowY: 'auto', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
                <thead>
                  <tr style={{ textAlign: 'left', position: 'sticky', top: 0, background: 'var(--background1, #111)' }}>
                    <th>#</th><th>Time (s)</th><th>Dir</th><th>Len</th>
                    <th>Freq</th><th>SF/CR</th><th>RSSI</th><th>SNR</th><th>CRC</th><th>SHLB</th>
                  </tr>
                </thead>
                <tbody>
                  {frames.map((f, i) => (
                    <tr
                      key={i}
                      onClick={() => setSelected(i)}
                      style={{
                        cursor: 'pointer',
                        background: i === selected ? 'var(--background2, #222)' : undefined,
                      }}
                    >
                      <td>{Number(f.sequence)}</td>
                      <td>{fmtRelTime(f, first)}</td>
                      <td>{f.direction.toUpperCase()}</td>
                      <td>{f.capturedLength}{f.truncated ? '*' : ''}</td>
                      <td>{hasField(f, RF_FIELD.frequency) ? fmtFreq(f.centerFrequencyHz) : '—'}</td>
                      <td>{f.spreadingFactor}/{f.codingRateDenominator}</td>
                      <td>{hasField(f, RF_FIELD.rssi) ? f.rssiDbm.toFixed(1) : '—'}</td>
                      <td>{hasField(f, RF_FIELD.snr) ? f.snrDb.toFixed(1) : '—'}</td>
                      <td style={{ color: crcColor(f.crc) }}>{f.crc}</td>
                      <td style={{ color: 'var(--success, #66F05A)' }}>{shelbyHits[i] ? 'SHLB' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </box>

          {/* ── Detail + hex ────────────────────────────────────── */}
          {active && (
            <row gap-="1" style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
              <box style={{ flex: '1 1 20rem' }}>
                <column gap-="0">
                  <span is-="badge" variant-="foreground2">FRAME {Number(active.sequence)}</span>
                  {([
                    ['Modulation', active.modulation.toUpperCase()],
                    ['Direction', active.direction.toUpperCase()],
                    ['Captured / original', `${active.capturedLength} / ${active.originalLength} B`],
                    ['Frequency', hasField(active, RF_FIELD.frequency) ? fmtFreq(active.centerFrequencyHz) : 'not reported'],
                    ['Bandwidth', hasField(active, RF_FIELD.bandwidth) ? fmtFreq(active.bandwidthHz) : 'not reported'],
                    ['Spreading factor', `SF${active.spreadingFactor}`],
                    ['Coding rate', `4/${active.codingRateDenominator}`],
                    ['RSSI', hasField(active, RF_FIELD.rssi) ? `${active.rssiDbm.toFixed(1)} dBm` : 'not reported'],
                    ['SNR', hasField(active, RF_FIELD.snr) ? `${active.snrDb.toFixed(1)} dB` : 'not reported'],
                    ['Freq error', hasField(active, RF_FIELD.frequencyError) ? `${active.frequencyErrorHz} Hz` : 'not reported'],
                    ['Airtime', hasField(active, RF_FIELD.airtime) ? `${(active.airtimeUs / 1000).toFixed(1)} ms` : 'not reported'],
                    ['Preamble', hasField(active, RF_FIELD.preamble) ? `${active.preambleSymbols} sym` : 'not reported'],
                    ['Sync word', hasField(active, RF_FIELD.syncWord) ? `0x${active.syncWord.toString(16).toUpperCase()}` : 'not reported'],
                    ['Profile id', String(active.profileId)],
                    ['Radio status', String(active.radioStatus)],
                    ['Integrity', active.crc],
                  ] as [string, string][]).map(([k, v]) => (
                    <row key={k} style={{ justifyContent: 'space-between', gap: '1rem' }}>
                      <span style={{ opacity: 0.6 }}>{k}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                    </row>
                  ))}
                  {activePointer && (
                    <column gap-="0" style={{ marginTop: '0.75rem' }}>
                      <span is-="badge" variant-="foreground1">
                        SHELBY POINTER @ payload offset {activePointer.offset}
                      </span>
                      <span style={{ opacity: 0.7, fontSize: '0.8rem', margin: '0.25rem 0' }}>
                        This frame references a Shelby blob — a connected node resolves the
                        pointer and moves the bytes.
                      </span>
                      {([
                        ['Size', `${activePointer.pointer.sizeBytes.toLocaleString()} B`],
                        ['Expiry', new Date(activePointer.pointer.expiresAtUnix * 1000).toISOString()],
                        ['Chunk', activePointer.pointer.chunked
                          ? `${activePointer.pointer.chunkIndex + 1} of ${activePointer.pointer.chunkCount}`
                          : 'whole blob'],
                        ['Flags', [
                          activePointer.pointer.encrypted && 'encrypted',
                          activePointer.pointer.capture && 'lilyshark capture',
                        ].filter(Boolean).join(', ') || 'none'],
                        ['Commitment', activePointer.pointer.commitment],
                        ['Owner', activePointer.pointer.owner],
                      ] as [string, string][]).map(([k, v]) => (
                        <row key={k} style={{ justifyContent: 'space-between', gap: '1rem' }}>
                          <span style={{ opacity: 0.6 }}>{k}</span>
                          <span style={{
                            fontVariantNumeric: 'tabular-nums',
                            fontSize: k === 'Commitment' || k === 'Owner' ? '0.7rem' : undefined,
                            wordBreak: 'break-all',
                            textAlign: 'right',
                            maxWidth: '75%',
                          }}>{v}</span>
                        </row>
                      ))}
                    </column>
                  )}
                </column>
              </box>
              <box style={{ flex: '2 1 26rem' }}>
                <column gap-="0">
                  <span is-="badge" variant-="foreground2">RAW BYTES</span>
                  <pre style={{ margin: 0, overflowX: 'auto', fontSize: '0.8rem', lineHeight: 1.45 }}>
                    {active.capturedLength > 0 ? hexDump(active.bytes) : '(no payload captured)'}
                  </pre>
                </column>
              </box>
            </row>
          )}
        </>
      )}
    </column>
  );
}
