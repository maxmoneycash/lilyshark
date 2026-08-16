import { useEffect, useMemo, useState } from "react";
import { backendApi } from "../../api/backend";
import { DEMO_BLOB, SHELBY_RPC_BLOBS } from "../../lib/shelby";
import {
  findShelbyPointer,
  parseLscap,
  SHELBY_POINTER_SIZE,
  type ShelbyPointer,
} from "../../lib/lscap";

/**
 * SHELBY — what the firmware actually does with the storage network, and why.
 *
 * The argument this screen has to land is narrow and physical: a mesh radio
 * cannot carry a capture, but it can carry a receipt for one. Everything here
 * The wire-format table matches the implemented receipt. The rate model uses
 * metadata from the bundled synthetic fixture. Network totals come from the
 * live indexer.
 */

/** Byte layout of the pointer, mirroring include/lilyshark/shelby/shelby_pointer.h. */
const LAYOUT: [string, string, string][] = [
  ["0..3", "magic", '"SHLB" — lets a decoder find one behind any protocol header'],
  ["4", "version", "1"],
  ["5", "flags", "encrypted · chunked · capture"],
  ["6..37", "commitment", "32-byte blob commitment — the content address"],
  ["38..69", "owner", "32-byte Aptos account that paid for the blob"],
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

export function ShelbyScreen() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Pointer coordinates decoded from the bundled synthetic fixture. */
  const [live, setLive] = useState<{ ptr: ShelbyPointer; offset: number; captureBytes: number } | null>(
    null,
  );
  /** Effective demo throughput derived from the synthetic sample metadata. */
  const [bps, setBps] = useState<number | null>(null);

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

  /** How long the radio would need for the blob itself versus its pointer. */
  const airtime = useMemo(() => {
    if (!bps || !live) return null;
    return {
      blob: (live.ptr.sizeBytes * 8) / bps,
      pointer: (SHELBY_POINTER_SIZE * 8) / bps,
    };
  }, [bps, live]);

  return (
    <main>
      <div className="panel" style={{ flex: 1 }}>
        <div className="panel-title">
          PANEL // SHELBY · OFF-GRID STORAGE
          <span className="spacer" />
          <span className={err ? "warn" : stats ? "ok" : "dim"}>
            {err ? "INDEXER UNREACHABLE" : stats ? "LIVE" : "READING…"}
          </span>
        </div>

        <div className="scroll-y">
          <div className="prose">
            <p>
              A LoRa mesh moves on the order of a kilobit per second and is capped
              by duty-cycle rules on top of that. A day of captured traffic will
              never fit down it. So the T-Deck does not send the capture — it
              writes the <code>.lscap</code> to Shelby, and puts an{" "}
              {SHELBY_POINTER_SIZE}-byte receipt on the air instead. The receipt
              fits in a single packet.
            </p>
            <p>
              Every node in radio range decodes that receipt with no internet at
              all. Whoever later has a connection resolves the commitment and
              gets the bytes, content-addressed, exactly as captured.
            </p>
          </div>

          <div className="panel-title">THE PATH A CAPTURE TAKES</div>
          <div className="flow">
            {[
              ["01", "CAPTURE", "T-Deck logs Meshtastic, MeshCore and Reticulum frames with their radio measurements to microSD"],
              ["02", "STORE", "the .lscap blob is written to Shelby and paid for from the device's own Aptos account"],
              ["03", "BROADCAST", `an ${SHELBY_POINTER_SIZE}-byte pointer carrying the commitment goes out over LoRa — one packet, no internet`],
              ["04", "RESOLVE", "any listener decodes it offline; anyone with a connection fetches the blob by commitment"],
            ].map(([n, k, v]) => (
              <div className="flow-step" key={n}>
                <span className="flow-n">{n}</span>
                <span className="flow-k">{k}</span>
                <span className="flow-v">{v}</span>
              </div>
            ))}
          </div>

          <div className="panel-title">
            WIRE FORMAT · {SHELBY_POINTER_SIZE} BYTES
          </div>
          <div className="scroll-x">
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
            The firmware encoder and this decoder are separate implementations of
            the same 82 bytes, and are checked against each other byte for byte.
          </div>
        </div>
      </div>

      <div className="panel" style={{ width: 360, flexShrink: 0 }}>
        <div className="panel-title">WHY A POINTER</div>
        <div className="scroll-y">
          <div className="kv">
            <span className="k">RADIO</span>
            <span className="v">{PRESET}</span>
            <span className="k warn">DEMO RATE</span>
            <span className="v">
              {bps ? `${bps.toFixed(0)} bit/s` : "—"}
              <span className="dim"> from synthetic sample metadata</span>
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
                  {Math.round(airtime.blob / airtime.pointer).toLocaleString()}× less air
                </span>
              </>
            )}
          </div>

          {live && (
            <>
              <div className="panel-title">DECODED FROM SYNTHETIC SAMPLE</div>
              <div className="kv">
                <span className="k">FOUND AT</span>
                <span className="v">byte {live.offset} of the payload</span>
                {live.ptr.commitment === DEMO_BLOB.commitment && (
                  <>
                    <span className="k ok">STATUS</span>
                    <span className="v ok">
                      live on shelbynet —{' '}
                      <a
                        href={`${SHELBY_RPC_BLOBS}/${DEMO_BLOB.owner}/${DEMO_BLOB.name}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        fetch the bytes yourself
                      </a>
                    </span>
                    <span className="k">OBJECT</span>
                    <span className="v">{DEMO_BLOB.name}</span>
                  </>
                )}
                <span className="k">COMMITMENT</span>
                <span className="v">{live.ptr.commitment}</span>
                <span className="k">OWNER</span>
                <span className="v">{live.ptr.owner}</span>
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
            </>
          )}

          <div className="panel-title">NETWORK</div>
          <div className="kv">
            <span className="k">BLOBS</span>
            <span className="v">{stats ? stats.totalBlobs.toLocaleString() : "—"}</span>
            <span className="k">STORED</span>
            <span className="v">{stats ? stats.totalStorageFormatted : "—"}</span>
            <span className="k">UPLOAD RATE</span>
            <span className="v">{stats ? `${stats.uploadRate.toFixed(0)} /min` : "—"}</span>
            <span className="k">NETWORK</span>
            <span className="v">shelbynet</span>
          </div>
        </div>
      </div>
    </main>
  );
}
