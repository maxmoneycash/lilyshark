import { useEffect, useMemo, useState } from "react";
import { backendApi } from "../../api/backend";
import {
  CAPTURE_REGISTRY,
  DEMO_BLOB,
  fetchRegistry,
  SHELBY_FULLNODE,
  SHELBY_RPC_BLOBS,
  type RegistryEntry,
} from "../../lib/shelby";
import {
  findShelbyPointer,
  parseLscap,
  SHELBY_POINTER_SIZE,
  type ShelbyPointer,
} from "../../lib/lscap";
import "./shelby.css";

/**
 * SHELBY — what the firmware actually does with the storage network, and why.
 *
 * The argument this screen has to land is narrow and physical: a mesh radio
 * cannot carry a capture, but it can carry a receipt for one. The wire-format
 * table matches the implemented receipt. The rate model uses
 * metadata from the bundled synthetic fixture. Network totals come from the
 * live indexer, and the capture registry is read straight from the shelbynet
 * fullnode.
 */

/** Byte layout of the pointer, mirroring include/lilyshark/shelby/shelby_pointer.h. */
const LAYOUT: [string, string, string][] = [
  ["0..3", "magic", '"SHLB" — lets a decoder find one behind any protocol header'],
  ["4", "version", "1"],
  ["5", "flags", "encrypted · chunked · capture"],
  ["6..37", "commitment", "32-byte blob commitment — the content address"],
  ["38..69", "owner", "32-byte account that uploaded the blob"],
  ["70..73", "size", "blob length in bytes"],
  ["74..77", "expiry", "unix seconds the storage is paid through"],
  ["78..79", "chunk index", "for captures split across several blobs"],
  ["80..81", "chunk count", "0 is rejected; index must be below it"],
];

interface Stats {
  totalBlobs: number;
  totalStorage: number;
  totalStorageFormatted: string;
  uploadRate: number;
  timestamp: number;
}

/** LongFast, the default Meshtastic preset: SF11, 250 kHz, coding rate 4/5. */
const PRESET = "LongFast · SF11 · BW250 · CR4/5";

const hhmm = (s: number) => {
  if (s < 90) return `${s.toFixed(1)} s`;
  if (s < 5400) return `${(s / 60).toFixed(1)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} days`;
};

/** UTC calendar day, because chain timestamps have no local timezone. */
const utcDay = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

/** "0x6ab9…32c9" — the full 32 bytes would drown the table. */
const shortHex = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

export function ShelbyScreen() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Pointer coordinates decoded from the bundled synthetic fixture. */
  const [live, setLive] = useState<{ ptr: ShelbyPointer; offset: number; captureBytes: number } | null>(
    null,
  );
  /** Effective demo throughput derived from the synthetic sample metadata. */
  const [bps, setBps] = useState<number | null>(null);
  /** The on-chain capture registry; null while the fullnode read is in flight. */
  const [registry, setRegistry] = useState<RegistryEntry[] | null>(null);
  const [regErr, setRegErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const s = await backendApi.getNetworkStats();
        if (alive) {
          setStats(s);
          setErr(null);
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "indexer unreachable");
      }
    };
    void pull();
    const id = setInterval(pull, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Read the bundled synthetic fixture once. Its pointer coordinates reference
  // a real Shelby object, while its generated airtime metadata drives the demo
  // rate model below.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/sample-mesh-traffic.lscap");
        if (!res.ok) return;
        const cap = parseLscap(await res.arrayBuffer());
        if (!alive) return;

        let air = 0;
        let bits = 0;
        for (const f of cap.frames) {
          if (f.airtimeUs > 0) {
            air += f.airtimeUs / 1e6;
            bits += f.capturedLength * 8;
          }
        }
        if (air > 0) setBps(bits / air);

        for (const f of cap.frames) {
          const hit = findShelbyPointer(f.bytes);
          if (hit) {
            setLive({ ptr: hit.pointer, offset: hit.offset, captureBytes: cap.frames.length });
            break;
          }
        }
      } catch {
        /* the screen still stands without it; the format table is static */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Read the capture registry from the shelbynet fullnode once. A dead
  // fullnode only dims this one section; the rest of the screen stands.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rows = await fetchRegistry(DEMO_BLOB.owner);
        if (alive) {
          setRegistry(rows);
          setRegErr(null);
        }
      } catch (e) {
        if (alive) setRegErr(e instanceof Error ? e.message : "fullnode unreachable");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** How long the radio would need for the blob itself versus its pointer. */
  const airtime = useMemo(() => {
    if (!bps || !live) return null;
    return {
      blob: (live.ptr.sizeBytes * 8) / bps,
      pointer: (SHELBY_POINTER_SIZE * 8) / bps,
    };
  }, [bps, live]);

  return (
    <main className="shelby-screen">
      <div className="panel shelby-overview" style={{ flex: 1 }}>
        <div className="panel-title">
          <span className="panel-title-label">SHELBY // CAPTURE STORAGE</span>
          <span className={err ? "warn" : stats ? "ok" : "dim"}>
            {err ? "INDEXER UNREACHABLE" : stats ? "INDEXER LIVE" : "READING…"}
          </span>
        </div>

        <div className="scroll-y">
          <div className="prose shelby-intro">
            <p>
              <strong>{SHELBY_POINTER_SIZE}-byte SHLB receipt over LoRa.</strong>{" "}
              Keep the <code>.lscap</code> on Shelby and fetch it when you have
              internet.
            </p>
          </div>

          <div className="panel-title">FROM RADIO TO STORAGE</div>
          <div className="flow shelby-flow">
            {[
              ["01", "CAPTURE", "Frames and SNR to microSD."],
              ["02", "UPLOAD", "Store the capture on Shelby (internet)."],
              ["03", "ANNOUNCE", `${SHELBY_POINTER_SIZE}-byte receipt over the mesh.`],
              ["04", "RETRIEVE", "Decode offline; fetch the file online."],
            ].map(([n, k, v]) => (
              <div className="flow-step" key={n}>
                <span className="flow-n">{n}</span>
                <span className="flow-k">{k}</span>
                <span className="flow-v">{v}</span>
              </div>
            ))}
          </div>

          <details className="shelby-wire">
            <summary>
              WIRE FORMAT · {SHELBY_POINTER_SIZE} BYTES
            </summary>
            <div className="scroll-x" tabIndex={0} role="region" aria-label="Shelby pointer wire format">
              <table className="grid">
                <thead>
                  <tr>
                    <th>BYTES</th>
                    <th>FIELD</th>
                    <th>MEANING</th>
                  </tr>
                </thead>
                <tbody>
                  {LAYOUT.map(([range, field, meaning]) => (
                    <tr key={range}>
                      <td>{range}</td>
                      <td>{field}</td>
                      <td>{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="panel-foot dim">
              Little-endian integers, version 1. C++, TypeScript, and Python
              implementations share the same byte-exact test vector.
            </div>
          </details>

          <div className="panel-title">
            ON-CHAIN REGISTRY
            {registry ? ` · ${registry.length} ANCHORED` : ""}
          </div>
          {regErr ? (
            <div className="shelby-empty" role="alert">
              <h2>Registry unavailable.</h2>
              <p>{regErr}</p>
            </div>
          ) : registry === null ? (
            <div className="shelby-empty" role="status">
              <h2>Reading the registry…</h2>
              <p>
                Asking the shelbynet fullnode for captures this publisher has
                anchored.
              </p>
            </div>
          ) : registry.length === 0 ? (
            <div className="shelby-empty" role="status">
              <h2>No captures anchored yet.</h2>
              <p>This publisher has not registered a blob on shelbynet.</p>
            </div>
          ) : (
            <div className="scroll-x shelby-registry" tabIndex={0} role="region" aria-label="Anchored captures">
              <table className="grid">
                <thead>
                  <tr>
                    <th>OBJECT</th>
                    <th>SIZE</th>
                    <th>REGISTERED</th>
                    <th>EXPIRES</th>
                    <th>COMMITMENT</th>
                  </tr>
                </thead>
                <tbody>
                  {registry.map((r) => (
                    <tr key={r.commitment}>
                      <td>{r.blobName}</td>
                      <td>{r.sizeBytes.toLocaleString()} B</td>
                      <td>{utcDay(r.registeredAtUnix)}</td>
                      <td>{utcDay(r.expiresAtUnix)}</td>
                      <td>{shortHex(r.commitment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="panel-foot dim">
            <span>MODULE</span>
            <a
              href={`${SHELBY_FULLNODE}/accounts/${DEMO_BLOB.owner}/resource/${CAPTURE_REGISTRY}::Registry`}
              target="_blank"
              rel="noreferrer"
              title={CAPTURE_REGISTRY}
            >
              capture_registry ↗
            </a>
          </div>
        </div>
      </div>

      <div className="panel shelby-evidence">
        <div className="panel-title">AIRTIME MODEL</div>
        <div className="scroll-y">
          <div className="kv">
            <span className="k">RADIO</span>
            <span className="v">{PRESET}</span>
            <span className="k warn">DEMO RATE</span>
            <span className="v">
              {bps ? `${bps.toFixed(0)} bit/s` : "—"}
              <span className="dim"> synthetic sample</span>
            </span>
            {airtime && live && (
              <>
                <span className="k">BLOB</span>
                <span className="v">
                  {live.ptr.sizeBytes.toLocaleString()} B ·{" "}
                  <span className="err">{hhmm(airtime.blob)} of airtime</span>
                </span>
                <span className="k">POINTER</span>
                <span className="v">
                  {SHELBY_POINTER_SIZE} B ·{" "}
                  <span className="ok">{hhmm(airtime.pointer)} of airtime</span>
                </span>
                <span className="k">RATIO</span>
                <span className="v ok">
                  {Math.round(airtime.blob / airtime.pointer).toLocaleString()}× smaller payload
                </span>
              </>
            )}
          </div>

          {live && (
            <details className="shelby-wire">
              <summary>DECODED FROM SYNTHETIC SAMPLE</summary>
              <div className="kv">
                <span className="k">FOUND AT</span>
                <span className="v">byte {live.offset} of the payload</span>
                {live.ptr.commitment === DEMO_BLOB.commitment && (
                  <>
                    <span className="k">SAMPLE</span>
                    <span className="v">
                      <a
                        href={`${SHELBY_RPC_BLOBS}/${DEMO_BLOB.owner}/${DEMO_BLOB.name}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download capture from Shelby
                      </a>
                    </span>
                    <span className="k">OBJECT</span>
                    <span className="v">{DEMO_BLOB.name}</span>
                  </>
                )}
                <span className="k">COMMITMENT</span>
                <span className="v shelby-hex">{live.ptr.commitment}</span>
                <span className="k">OWNER</span>
                <span className="v shelby-hex">{live.ptr.owner}</span>
                <span className="k">SIZE</span>
                <span className="v">{live.ptr.sizeBytes.toLocaleString()} B</span>
                <span className="k">CHUNK</span>
                <span className="v">
                  {live.ptr.chunkIndex + 1} / {live.ptr.chunkCount}
                </span>
                <span className="k">FLAGS</span>
                <span className="v">
                  {[
                    live.ptr.capture && "capture",
                    live.ptr.chunked && "chunked",
                    live.ptr.encrypted && "encrypted",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "none"}
                </span>
              </div>
            </details>
          )}

          <div className="panel-title">NETWORK</div>
          {err ? (
            <div className="shelby-empty" role="alert">
              <h2>Indexer unreachable.</h2>
              <p>{err}</p>
            </div>
          ) : (
            <div className="kv">
              <span className="k">BLOBS</span>
              <span className="v">
                {stats ? stats.totalBlobs.toLocaleString() : "—"}
              </span>
              <span className="k">STORED</span>
              <span className="v">
                {stats ? stats.totalStorageFormatted : "—"}
              </span>
              <span className="k">UPLOAD RATE</span>
              <span className="v">
                {stats ? `${stats.uploadRate.toFixed(0)} /min` : "—"}
              </span>
              <span className="k">NETWORK</span>
              <span className="v">shelbynet</span>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
