/**
 * How the browser reaches a Lilyshark radio, separated from what it says to
 * it. The LSK protocol above this file is the same newline-delimited plain
 * text whether it arrives over a cable or over the air; only the plumbing
 * differs, so the plumbing is the part that gets an interface.
 *
 * A transport is deliberately dumb: it opens, hands complete lines up, takes
 * complete lines down, and says when the link died on its own. Everything
 * that makes the link *Lilyshark* — the HELLO handshake, the reboot
 * tolerance, the retry budget — stays in deviceLink.ts, so both transports
 * get identical connect behaviour instead of two drifting copies.
 */

export type DeviceTransportKind = 'serial' | 'ble';

/** 'busy' means the device is real but unavailable — held by another tab, or
 *  refusing the GATT connect. The caller retries or moves on; it never means
 *  "wrong device". */
export type TransportOpenResult = 'opened' | 'busy';

export interface TransportSink {
  /** One newline-stripped, trimmed line off the device. */
  onLine(line: string): void;
  /** The stream ended without us asking: a reboot, a walk-away, an unplug.
   *  A transport must NOT call this for a close() we requested. */
  onDrop(): void;
}

export interface DeviceTransport {
  readonly kind: DeviceTransportKind;
  /** What to call this link in the UI: "USB", "Bluetooth". */
  readonly label: string;
  /**
   * Open the link and start delivering lines. Calling open() again on the
   * same transport object after close() *is* the reconnect — for serial it
   * reopens the port the browser already granted, for BLE it re-establishes
   * GATT on the device object the user already picked, neither of which
   * needs a second trip through the browser's device picker.
   */
  open(sink: TransportSink): Promise<TransportOpenResult>;
  /** Send one line. The transport adds whatever framing its medium needs. */
  write(line: string): Promise<void>;
  /** Release the device. Never throws, never fires onDrop. */
  close(): Promise<void>;
}

/** A device that never sends a newline must not grow the buffer forever.
 *  The longest real LSK line is an `LSK F` with a full hex payload, well
 *  under a kilobyte. */
export const MAX_PENDING_LINE_BYTES = 8192;

/**
 * Bytes in, whole lines out. Serial hands over arbitrary USB chunks and BLE
 * hands over MTU-sized notifications; both split LSK lines at inconvenient
 * places — including mid-UTF-8 — so both reassemble the same way.
 */
export class LineAssembler {
  private decoder = new TextDecoder();
  private pending = '';

  /** Complete lines contained in everything pushed so far. */
  push(chunk: Uint8Array): string[] {
    this.pending += this.decoder.decode(chunk, { stream: true });
    const lines: string[] = [];
    let nl = this.pending.indexOf('\n');
    while (nl >= 0) {
      lines.push(this.pending.slice(0, nl).trim());
      this.pending = this.pending.slice(nl + 1);
      nl = this.pending.indexOf('\n');
    }
    // Garbage or a wedged device: drop the fragment rather than accumulate.
    if (this.pending.length > MAX_PENDING_LINE_BYTES) this.pending = '';
    return lines;
  }

  /** Bytes held back waiting for a newline. Exposed for tests and for a
   *  reconnect that must not splice the old fragment onto the new stream. */
  get buffered(): string {
    return this.pending;
  }

  reset(): void {
    this.decoder = new TextDecoder();
    this.pending = '';
  }
}

/** The framing every LSK transport writes: one line, one trailing newline. */
export function encodeLine(line: string): Uint8Array {
  return new TextEncoder().encode(`${line}\n`);
}

/**
 * Split a payload into writes that fit one ATT packet. Web Bluetooth does
 * not expose the negotiated MTU, so callers pass what they are willing to
 * assume and the device reassembles on the newline.
 */
export function chunkForMtu(payload: Uint8Array, maxChunkBytes: number): Uint8Array[] {
  if (!Number.isFinite(maxChunkBytes) || maxChunkBytes < 1) {
    throw new Error('chunk size must be at least one byte');
  }
  const size = Math.floor(maxChunkBytes);
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < payload.length; at += size) {
    chunks.push(payload.slice(at, at + size));
  }
  // An empty payload is still one (empty) write rather than none, so a
  // caller cannot silently send nothing and believe it sent something.
  if (chunks.length === 0) chunks.push(payload.slice(0, 0));
  return chunks;
}
