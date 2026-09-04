import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
import { isDemo } from '../mesh/demo';
import { simLiveTick, startTrafficDemoInterval } from './trafficDemo';
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
import {
  conversationCoverage,
  conversationExpression,
  conversationLabel,
  coverageNote,
  frameAddressing,
  isAddressable,
  parseConversationExpression,
  reticulumDestinationHashHex,
} from '../lib/conversation';
import { FILTER_FIELDS, parseFrameFilter, protoOfProfile } from '../lib/frameFilter';
import {
  activeSlot,
  type CaptureSlot,
  emptySlots,
  type SlotOrigin,
  slotsReducer,
} from '../lib/captureSlots';
import { buildIoGraph, type IoSplit } from '../lib/ioGraph';
import { applyBrush, type BrushRange, brushLabel } from '../lib/trafficView';
import { CaptureDiffPanel } from './CaptureDiffPanel';
import { CaptureSlotBar, type SlotTab } from './CaptureSlotBar';
import { IoGraphPanel } from './IoGraphPanel';
import { TrafficFrameTable } from './TrafficFrameTable';
import { crcClass, fmtFreq } from './trafficFormat';


/**
 * TRAFFIC — the analyzer. Opens a .lscap capture written by the T-Deck
 * firmware, either from disk or by Shelby blob name.
 *
 * Laid out the way the rest of the terminal is: a `main` holding a list pane
 * and a detail pane, each scrolling inside itself on desktop and stacking into
 * one scrolling column on a phone. `main` is the element the shell gives its
 * spare height to, so it has to be the root here.
 *
 * Several captures are open at once. All the state that belongs to ONE of them
 * — the parsed capture, the selected frame, the display filter, the parse note
 * — lives in that capture's slot (lib/captureSlots.ts) and is swapped as a
 * whole when tabs change, which is what stops two captures bleeding into each
 * other. State that belongs to the SCREEN and not to any one capture (the
 * Shelby resolve trace, the blob-name box, whether DIFF is open) stays here.
 */

interface TrafficTabProps {
  /** True only while TerminalApp is showing its synthetic demo state. */
  demoActive: boolean;
}

/** Everything about the view that belongs to one open capture. */
interface TrafficSlotView {
  capture: LscapCapture;
  /** Index into the capture's frames. */
  selected: number;
  /**
   * The display filter, plain text, kept as the operator typed it: a followed
   * conversation is nothing but one particular expression in this box, so
   * following, editing and clearing are all the same control.
   */
  filterText: string;
  /** What the parse had to say about this file, e.g. a short final record. */
  note: string | null;
  /**
   * True when any frame in this capture was generated rather than heard over
   * the air. Read once when the capture is opened and OR-ed in as synthetic
   * frames are appended, so the slot tab can state it without walking a
   * 128,000-frame list on every render.
   */
  containsSynthetic: boolean;
  /**
   * The IO graph's time brush, a second predicate over the same frames,
   * independent of the text filter — narrowing the text inside a time range
   * is exactly what the two are for together.
   *
   * It belongs to the SLOT and not to the screen because a brush is a range
   * on one capture's clock. Held on the screen it would follow a tab change
   * and silently hide most of a 3 s capture because the operator had brushed
   * seconds 40-50 of a different one. Per slot, opening a capture starts with
   * no brush and switching back finds the brush that was set here.
   */
  brush: BrushRange | null;
}

/** Stable empty, so a render with no capture open does not churn identities. */
const NO_FRAMES: LscapFrame[] = [];

export function TrafficTab({ demoActive }: TrafficTabProps) {
  const [slots, dispatchSlots] = useReducer(
    slotsReducer<TrafficSlotView>,
    undefined,
    emptySlots<TrafficSlotView>,
  );
  const slot = activeSlot(slots);
  const capture = slot?.view.capture ?? null;
  const name = slot?.name ?? '';
  const selected = slot?.view.selected ?? 0;
  const filterText = slot?.view.filterText ?? '';
  const brush = slot?.view.brush ?? null;
  const setBrush = useCallback((next: BrushRange | null) => {
    dispatchSlots({ type: 'patch', view: { brush: next } });
  }, []);
  // A failed open belongs to the attempt, not to any capture; a parse note
  // belongs to the capture and travels with its tab.
  const [openError, setOpenError] = useState<string | null>(null);
  const error = openError ?? slot?.view.note ?? null;

  const [blob, setBlob] = useState('');
  const [busy, setBusy] = useState(false);
  // How the IO graph groups its bars. A way of looking, not a property of any
  // one capture, so it stays on the screen and survives a tab change.
  const [split, setSplit] = useState<IoSplit>('protocol');
  const [diffOpen, setDiffOpen] = useState(false);
  /** Which other open capture DIFF is comparing against, "" for none. */
  const [diffBId, setDiffBId] = useState('');
  // Live demo mode adds synthetic frames at a configured cadence. It is
  // available only while TerminalApp is showing the demo mesh. Opening a file
  // pauses it.
  const [live, setLive] = useState(() => demoActive && isDemo());
  const liveSeq = useRef(1000);
  const fileRef = useRef<HTMLInputElement>(null);
  const demoActiveRef = useRef(demoActive);
  demoActiveRef.current = demoActive;
  const simulatedLive = live && demoActive;

  const setSelected = useCallback((index: number) => {
    dispatchSlots({ type: 'patch', view: { selected: index } });
  }, []);
  const setFilterText = useCallback((text: string) => {
    dispatchSlots({ type: 'patch', view: { filterText: text } });
  }, []);

  useEffect(() => {
    if (!demoActive) setLive(false);
  }, [demoActive]);

  /**
   * Open a capture into its own slot. `key` is the slot's identity: opening
   * the same source twice refreshes one tab instead of stacking duplicates,
   * and a file pick is always a fresh key because the bytes on disk may have
   * changed since the last look.
   *
   * A failed parse leaves every open capture alone — losing what you were
   * reading because the NEXT file was unreadable is not a thing this should
   * ever do.
   */
  const load = (buf: ArrayBuffer, from: string, origin: SlotOrigin, key: string) => {
    try {
      const c = parseLscap(buf);

      // Land on the most interesting frame: the first one carrying a Shelby
      // pointer, so the decoded pointer detail is on screen from the start.
      const ptrIdx = c.frames.findIndex((fr) => findShelbyPointer(fr.bytes));
      // Live frames continue the capture's own numbering; a jump from 23 to
      // 1000 read as a glitch, not a stream.
      liveSeq.current = Number(c.frames[c.frames.length - 1]?.sequence ?? -1n) + 1;
      dispatchSlots({
        type: 'open',
        key,
        origin,
        name: from,
        view: {
          capture: c,
          selected: ptrIdx >= 0 ? ptrIdx : 0,
          filterText: '',
          note:
            c.trailingBytes > 0
              ? `${c.trailingBytes} trailing byte(s) were not a complete record`
              : null,
          containsSynthetic: c.frames.some((fr) => fr.synthetic),
          brush: null,
        },
      });
      setOpenError(null);
    } catch (e) {
      setOpenError(e instanceof LscapParseError ? e.message : 'not a .lscap capture');
    }
  };

  /** A file pick never reuses a tab: the same name may hold different bytes. */
  const fileOpens = useRef(0);

  const openFile = async (f: File) => {
    setBusy(true);
    setLive(false); // the user's own capture is a document, not a stream
    try {
      fileOpens.current += 1;
      load(await f.arrayBuffer(), f.name, 'file', `file:${f.name}:${fileOpens.current}`);
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

  /**
   * The slot the CURRENT recording was opened into, "" until STOP has opened
   * one. A session that ran into the frame limit stops itself without going
   * through onStopCapture, so this has to be cleared when a recording starts:
   * otherwise PUBLISH would hang a PUB badge on the slot the PREVIOUS
   * recording made, which is a claim about a capture nobody uploaded.
   */
  const recordedSlotKey = useRef('');

  const onStopCapture = () => {
    const done = stopCapture();
    setLive(false);
    if (done.frames.length === 0) {
      setOpenError('capture stopped with no frames — nothing was heard on this channel');
      return;
    }
    const bytes = captureToLscap(done);
    recordedSlotKey.current = `live:${done.startedAtMs ?? Date.now()}`;
    // Copied into a standalone buffer: load() keeps views onto it for the
    // lifetime of the capture.
    load(bytes.slice().buffer, captureFileName(done), 'live', recordedSlotKey.current);
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

  /**
   * The slot key of the one capture this tab has actually put on Shelby.
   *
   * A PUB badge is a claim that a permalink exists, so it may only be shown
   * for the capture that was really uploaded — never for its neighbours in
   * the bar, and never for a recording that was merely made.
   */
  const [publishedSlotKey, setPublishedSlotKey] = useState('');

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
      // Only when this session's own capture has a slot: an empty key would
      // match a slot that was never published.
      if (recordedSlotKey.current !== '') setPublishedSlotKey(recordedSlotKey.current);
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
    setOpenError(null);
    setLive(false);
    try {
      const [owner, name] = n.startsWith('0x')
        ? [n.slice(0, n.indexOf('/')), n.slice(n.indexOf('/') + 1)]
        : [DEMO_BLOB.owner, n];
      load(await fetchBlobBytes(owner, name), name, 'shelby', `shelby:${owner}/${name}`);
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : 'fetch failed');
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
      load(bytes, found.name, 'shelby', `shelby:${p.owner}/${found.name}`);
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
    setOpenError(null);
    try {
      const res = await fetch('/sample-mesh-traffic.lscap');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load(await res.arrayBuffer(), 'sample-mesh-traffic.lscap', 'sample', 'sample');
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : 'sample unavailable');
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

  // Synthetic demo traffic: a frame lands every few seconds, appended to
  // whichever capture is on screen. Keeping the newest frame in view is the
  // table's own job now (TrafficFrameTable's `follow`), because only the
  // table knows which rows are mounted.
  //
  // The stream gets its OWN slot and never writes into anybody else's. It
  // used to pin to whichever capture happened to be open at the first tick,
  // which was meant to stop generated frames wandering into a file — but the
  // capture open at the first tick IS the operator's file. Pressing SIM LIVE
  // over a 20,000-frame .lscap rewrote that slot's frames as
  // `[...frames.slice(-(LIVE_CAP - 1)), f]`, and 19,750 frames off a microSD
  // card were gone in about nine seconds, with the tab still showing the
  // file's name. The cap is right for a live stream and ruinous applied to a
  // file, so the stream owns a slot where the cap is the truth: opening it
  // under the fixed key 'sim-live' means toggling SIM LIVE off and on reuses
  // that slot rather than piling up tabs, origin 'live' keeps the LRU from
  // evicting a running stream, and the operator's captures are untouched.
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const slotRef = useRef<CaptureSlot<TrafficSlotView> | null>(slot);
  slotRef.current = slot;
  // State, because the table has to know whether the capture it is showing is
  // the one being appended to; the ref beside it is only how the interval
  // reads the latest value, the same way demoActiveRef does.
  const [demoSlotId, setDemoSlotId] = useState('');
  const demoSlotIdRef = useRef(demoSlotId);
  demoSlotIdRef.current = demoSlotId;
  useEffect(() => {
    // Claimed at the first tick, not here: the reducer assigns the slot id, so
    // there is nothing to record until the open has actually gone through.
    setDemoSlotId('');
    return startTrafficDemoInterval(
      simulatedLive,
      () => demoActiveRef.current,
      () => {
        const claimed = simLiveTick(
          slotsRef.current,
          demoSlotIdRef.current,
          liveSeq.current++,
          dispatchSlots,
        );
        if (claimed !== demoSlotIdRef.current) {
          demoSlotIdRef.current = claimed;
          setDemoSlotId(claimed);
        }
      },
    );
  }, [simulatedLive]);

  const frames = capture?.frames ?? NO_FRAMES;
  const stats = useMemo(() => summarize(frames), [frames]);
  // A pointer rides behind whatever protocol header enclosed it, so every
  // payload is scanned once rather than only at a fixed offset.
  const pointers = useMemo(() => frames.map((f) => findShelbyPointer(f.bytes)), [frames]);
  const t0 = frames.length ? frames[0].timestampUs : 0n;
  const f = frames[selected];
  const ptr = f ? pointers[selected] : null;

  // ── display filter ────────────────────────────────────────────────────
  // Every frame's addressing and Reticulum destination hash are read once
  // per capture and handed to the predicate, so typing into the filter box
  // re-runs comparisons rather than header arithmetic.
  const addressings = useMemo(
    () => frames.map((fr) => frameAddressing(fr.bytes, fr.profileId)),
    [frames],
  );
  const destHashes = useMemo(
    () =>
      frames.map((fr) =>
        protoOfProfile(fr.profileId) === 'rnode'
          ? reticulumDestinationHashHex(fr.bytes)
          : null,
      ),
    [frames],
  );
  const filter = useMemo(() => parseFrameFilter(filterText), [filterText]);
  // Indices into `frames`, not a new frame list: the selection, the pointer
  // scan and the diff all address frames by their position in the capture,
  // and a filtered view must not renumber them.
  const filtered = useMemo(() => {
    if (!filter.ok || filter.empty) return frames.map((_, i) => i);
    const predicate = filter.predicate;
    const kept: number[] = [];
    frames.forEach((fr, i) => {
      if (predicate(fr, pointers[i] !== null, destHashes[i], addressings[i]))
        kept.push(i);
    });
    return kept;
  }, [filter, frames, pointers, destHashes, addressings]);
  // What the table shows: the text filter, then the IO graph's time brush.
  // Two predicates over one index set, each reporting its own effect, so an
  // operator can always tell which of the two is hiding a frame.
  const shown = useMemo(
    () => applyBrush(filtered, frames, t0, brush),
    [filtered, frames, t0, brush],
  );

  // ── IO graph ──────────────────────────────────────────────────────────
  // Built from the WHOLE capture, not from `shown`: the strip's job is to
  // show the bursts and silences the current view sits inside, and one that
  // shrank with the filter could not.
  //
  // A frame is attributed to a node only where its own protocol named a
  // SOURCE. Meshtastic's outer header does; Reticulum names a destination
  // and no sender; MeshCore names neither. `frameAddressing` has already
  // decided that per frame, and a null src stays null here — the node graph
  // must never invent a talker the wire did not prove.
  const sources = useMemo(() => addressings.map((a) => a.src), [addressings]);
  const graph = useMemo(
    () => buildIoGraph({ frames, t0Us: t0, sources }),
    [frames, t0, sources],
  );

  // A conversation is an ordinary filter expression, so "am I following one"
  // is a question about the text in the box — edit it and it stops being a
  // conversation, which is exactly what the operator did.
  const following = useMemo(() => parseConversationExpression(filterText), [filterText]);
  const coverage = useMemo(() => conversationCoverage(addressings), [addressings]);
  const selectedAddress = f ? addressings[selected] : null;
  const followExpression =
    selectedAddress && isAddressable(selectedAddress)
      ? conversationExpression(selectedAddress)
      : null;

  // Counted once per capture rather than on every keystroke: at 128,000
  // frames a pass over the list is not free, and the footer used to make
  // three of them per render.
  const pointerCount = useMemo(() => pointers.filter(Boolean).length, [pointers]);
  const syntheticCount = useMemo(
    () => frames.reduce((n, fr) => n + (fr.synthetic ? 1 : 0), 0),
    [frames],
  );
  // Counted rather than `frames.some(...)`: on a 128,000-frame capture the
  // footer would otherwise walk the whole list twice on every render.
  const truncatedCount = useMemo(
    () => frames.reduce((n, fr) => n + (fr.truncated ? 1 : 0), 0),
    [frames],
  );
  const anyTruncated = useMemo(() => frames.some((fr) => fr.truncated), [frames]);

  // ── the open captures ─────────────────────────────────────────────────
  // What each tab is allowed to say about its capture, from facts this tab
  // actually holds. `published` is true only where a permalink really exists:
  // a capture fetched FROM Shelby has an address there by definition, and a
  // recording has one only once this tab has uploaded it.
  const slotTabs = useMemo<SlotTab[]>(
    () =>
      slots.slots.map((s) => ({
        id: s.id,
        name: s.name,
        facts: {
          origin: s.origin,
          // A slot is only ever opened from a FINISHED recording, so no slot
          // is one the device is recording into at this moment.
          recording: false,
          synthetic: s.view.containsSynthetic,
          published:
            s.origin === 'shelby' ||
            (publishedSlotKey !== '' && s.key === publishedSlotKey),
          frameCount: s.view.capture.frames.length,
        },
      })),
    [slots.slots, publishedSlotKey],
  );

  // DIFF's B side is another open capture. Picking the tab that is already on
  // screen would compare a capture with itself, so that choice is not offered
  // and a stale one stops counting the moment its tab becomes A.
  const diffCandidates = useMemo(
    () =>
      slots.slots
        .filter((s) => s.id !== slots.activeId)
        .map((s) => ({
          id: s.id,
          name: s.name,
          frameCount: s.view.capture.frames.length,
        })),
    [slots.slots, slots.activeId],
  );
  const diffB =
    diffBId === slots.activeId
      ? null
      : (slots.slots.find((s) => s.id === diffBId) ?? null);

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
            className={diffOpen ? 'primary' : ''}
            disabled={!capture}
            title="Compare this capture against another open one — what only one of the two heard"
            onClick={() => setDiffOpen((v) => !v)}
          >
            ⇄ DIFF
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
                recordedSlotKey.current = '';
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

        {/* Which captures are open, and which of them this panel is showing. */}
        <CaptureSlotBar
          tabs={slotTabs}
          activeId={slots.activeId}
          onActivate={(id) => dispatchSlots({ type: 'activate', id })}
          onClose={(id) => dispatchSlots({ type: 'close', id })}
        />

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
                    <span className={pointerCount > 0 ? 'ok' : 'dim'}>{pointerCount}</span>,
                  ],
                ] as [string, ReactNode][]
              ).map(([k, v]) => (
                <span className="stat" key={k}>
                  <span className="k">{k}</span>
                  <span className="v">{v}</span>
                </span>
              ))}
            </div>

            {/* The whole capture on one clock, above the controls that narrow
                it: bursts, silences, and who was talking when. Brushing it
                filters the table below to a time range. */}
            <IoGraphPanel
              graph={graph}
              split={split}
              onSplitChange={setSplit}
              brush={brush}
              onBrush={setBrush}
              shownFrames={shown.length}
              filteredFrames={filtered.length}
            />

            {/* The display filter. A conversation is one expression in this
                same box, so following one and typing one are the same act —
                and CLEAR is the single way back to the whole capture. */}
            <div
              className="panel-foot"
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
            >
              <span className="k">FILTER</span>
              <input
                value={filterText}
                spellCheck={false}
                placeholder="proto == meshtastic && snr > -5_"
                title={`Fields: ${FILTER_FIELDS.join(', ')}. Comparisons == != < <= > >= with k/M/G suffixes on numbers; combine with && || ! (or the words and / or / not).`}
                style={{
                  flex: '1 1 260px',
                  minWidth: 160,
                  color: filter.ok ? undefined : 'var(--err, #ff6b6b)',
                }}
                onChange={(e) => setFilterText(e.target.value)}
              />
              <button disabled={filterText === ''} onClick={() => setFilterText('')}>
                {following ? 'SHOW ALL FRAMES' : 'CLEAR'}
              </button>
              {!filter.ok ? (
                <span className="err">
                  {filter.error.message} · column {filter.error.start + 1}
                </span>
              ) : following ? (
                <span className="ok">
                  FOLLOWING {conversationLabel(following)} · {filtered.length} OF{' '}
                  {frames.length} FRAMES
                </span>
              ) : filter.empty ? (
                <span className="dim">no filter — every frame in the capture</span>
              ) : (
                <span>
                  {filtered.length} OF {frames.length} FRAMES MATCH
                </span>
              )}
              {/* Each control reports its own effect: this line counts what
                  the expression leaves, the graph's line counts what the
                  brush leaves of that. */}
              {brush && (
                <span className="dim">
                  · a time range is also brushed on the IO graph
                </span>
              )}
            </div>

            {following && coverage.undecodable > 0 && (
              <div className="panel-foot dim" style={{ display: 'block' }}>
                {coverageNote(coverage)}
              </div>
            )}

            {/* The table mounts a screenful of rows, not the capture. */}
            <TrafficFrameTable
              frames={frames}
              shown={shown}
              pointers={pointers}
              t0Us={t0}
              selected={selected}
              onSelect={setSelected}
              /* Only the capture the demo stream is actually feeding gets
                 pulled to its newest row. */
              follow={simulatedLive && slot !== null && slot.id === demoSlotId}
            />

            {filtered.length === 0 && filter.ok && !filter.empty && (
              <div className="panel-foot dim" style={{ display: 'block' }}>
                No frame in this capture matches the filter. The expression is
                valid — these {frames.length} frames simply do not satisfy it.
              </div>
            )}

            {/* Which of the two narrowed the table to nothing, said plainly:
                an empty table with two controls above it explains nothing. */}
            {shown.length === 0 && filtered.length > 0 && brush && (
              <div className="panel-foot dim" style={{ display: 'block' }}>
                Nothing was heard in {brushLabel(brush)}. That silence is the
                reading — {filtered.length} frame(s) match the filter outside this
                range.{' '}
                <button onClick={() => setBrush(null)}>⟲ WHOLE CAPTURE</button>
              </div>
            )}

            <div className="panel-foot">
              {shown.length === frames.length
                ? `${frames.length.toLocaleString()} FRAMES`
                : `${shown.length.toLocaleString()} OF ${frames.length.toLocaleString()} FRAMES SHOWN`}
              {brush && <span className="ok"> · BRUSHED {brushLabel(brush)}</span>}{' '}
              · {pointerCount} SHELBY POINTER(S)
              {syntheticCount > 0 && (
                <span className="warn">{syntheticCount} SYNTHETIC · NOT OTA</span>
              )}
              {truncatedCount > 0 && (
                <span className="dim">* = FRAME TRUNCATED AT CAPTURE</span>
              )}
              {anyTruncated && <span className="dim">* = FRAME TRUNCATED AT CAPTURE</span>}
            </div>
          </>
        )}
      </div>

      {f && (
        <div className="panel" style={{ width: 360, flexShrink: 0 }}>
          <div className="panel-title">
            FRAME {Number(f.sequence)}
            <span className="spacer" />
            {followExpression && (
              <button
                className={filterText === followExpression ? 'primary' : ''}
                title={`Filter the capture to everything these endpoints exchanged: ${followExpression}`}
                onClick={() => setFilterText(followExpression)}
              >
                ⇄ FOLLOW
              </button>
            )}
          </div>

          <div className="scroll-y">
            <div className="kv">
              {/* What the frame's own protocol proves about who was talking —
                  and, when it proves nothing, why, so an absent FOLLOW button
                  is explained rather than merely missing. */}
              <span className="k">CONVERSATION</span>
              {selectedAddress && isAddressable(selectedAddress) ? (
                <span className="v">
                  {conversationLabel(selectedAddress)}
                  {selectedAddress.reason && (
                    <span className="dim"> · {selectedAddress.reason}</span>
                  )}
                </span>
              ) : (
                <span className="v dim">
                  not addressable — {selectedAddress?.reason ?? 'no addressing decoded'}
                </span>
              )}
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

      {diffOpen && capture && (
        <CaptureDiffPanel
          aName={name}
          aFrames={frames}
          bName={diffB?.name ?? ''}
          bFrames={diffB?.view.capture.frames ?? null}
          candidates={diffCandidates}
          bId={diffB?.id ?? ''}
          onPickB={setDiffBId}
          onSelectA={setSelected}
          onClose={() => setDiffOpen(false)}
        />
      )}
    </main>
  );
}
