import WebSerialConnection from "@liamcottle/meshcore.js/src/connection/web_serial_connection.js";
import WebBleConnection from "@liamcottle/meshcore.js/src/connection/web_ble_connection.js";
import type Connection from "@liamcottle/meshcore.js/src/connection/connection.js";
import Constants from "@liamcottle/meshcore.js/src/constants.js";
import CayenneLpp from "@liamcottle/meshcore.js/src/cayenne_lpp.js";
import { COOLDOWN_MS, getAlertCfg } from "./alerts";
import { t } from "./i18n";
import {
  addLog,
  ContactType,
  convoKey,
  DeviceStatus,
  getSnapshot,
  markUnread,
  mutate,
  type ChannelEntry,
  type Message,
  type NodeEntry,
  type Traceroute,
  type Waypoint,
} from "./store";
import {
  deleteConvoMessages,
  deleteNodeDb,
  deleteWaypointDb,
  loadMessages,
  loadNodes,
  loadWaypoints,
  marcarEscucha,
  saveHopChange,
  saveMessage,
  saveNeighbors,
  saveNode,
  saveTelemetry,
  saveTraceroute,
  saveWaypoint,
  updateMessageState,
} from "./db";

/** The live companion-radio link (Web Serial or Web Bluetooth). Named `device`
 *  so the screens keep reading naturally: `if (!device) throw …`. */
export let device: Connection | undefined;

// ── helpers ─────────────────────────────────────────────────────────────────

/** First 4 bytes of a public key as uint32 BE: the node number every screen
 *  keys by. The top byte (`num >>> 24`) doubles as MeshCore's 1-byte path hash. */
export function numFromKeyBytes(k: Uint8Array): number {
  return ((k[0] << 24) | (k[1] << 16) | (k[2] << 8) | k[3]) >>> 0;
}

const hexOf = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const bytesOfHex = (s: string) =>
  Uint8Array.from(s.match(/.{2}/g) ?? [], (x) => parseInt(x, 16));
const bytesToB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const b64ToBytes = (s: string) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** 4-char short name from the advert name, hex of the num as fallback. */
function shortNameOf(name: string, num: number): string {
  const clean = name.replace(/[^0-9a-za-z_-]/gi, "");
  return (clean || num.toString(16)).slice(0, 4);
}

/** LiPo voltage → rough % (linear 3.30 V → 4.20 V). MeshCore reports mV
 *  only; the battery forecast and alerts need a percent-like series. */
export function liPoPercent(mv: number): number {
  return Math.min(100, Math.max(0, Math.round(((mv - 3300) / 900) * 100)));
}

function int8(b: number): number {
  return (b << 24) >> 24;
}

// pubkeys by node num, so DMs can address contacts the screens name by num
const pubkeyByNum = new Map<number, Uint8Array>();
// path-hash byte → num, to map out paths and trace results to known nodes
const hashToNum = new Map<number, number>();

function registerKey(publicKey: Uint8Array): number {
  const num = numFromKeyBytes(publicKey);
  pubkeyByNum.set(num, publicKey);
  hashToNum.set(publicKey[0], num);
  return num;
}

/** Path hash → node num; unknown hashes become a ghost num (hash byte in the
 *  top position, zeros below), which renders as plain hex like any unknown. */
function numFromHash(hash: number): number {
  return hashToNum.get(hash) ?? (hash << 24) >>> 0;
}

// ── history ─────────────────────────────────────────────────────────────────

export async function loadHistory(): Promise<void> {
  const msgs = await loadMessages();
  const nodes = await loadNodes();
  const wps = await loadWaypoints();
  for (const n of nodes) {
    if (n.publicKey) registerKey(bytesOfHex(n.publicKey));
  }
  mutate((s) => {
    s.messages = msgs;
    s.waypoints = new Map(wps.map((w) => [w.id, w]));
    // DB first; the radio's dump overwrites field by field what it brings
    // (upsertNode keeps the previous value when the patch says undefined).
    s.nodes = new Map(nodes.map((n) => [n.num, n]));
  });
}

// A failed IndexedDB write must not take down packet reception, but it can't
// vanish either: with no trace it's impossible to tell whether a table is
// empty because the data never arrived or because the write failed.
function dbFail(what: string) {
  return (e: unknown) => addLog("BD: fallo al guardar {0}: {1}", what, String(e));
}

// ── notifications ───────────────────────────────────────────────────────────

// System notification via the Web Notifications API. Permission is requested
// the first time.
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (!("Notification" in window)) return;
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm === "granted") new Notification(title, { body });
  } catch {
    // no notification support: not critical
  }
}

// Incoming messages: only when the tab isn't focused (if you're looking at
// the chat there's no need). Node alerts always notify: they don't depend on
// you looking at the right screen.
async function notifyIncoming(title: string, body: string, isDm: boolean): Promise<void> {
  if (document.hasFocus()) return;
  await notify(title, body);
  if (isDm) beep();
}

// Short beep via Web Audio, no asset. Silently no-ops if audio is unavailable.
function beep(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => ctx.close();
  } catch {
    // no audio: not critical
  }
}

// ── store upserts ───────────────────────────────────────────────────────────

function upsertNode(num: number, patch: Partial<NodeEntry>): void {
  mutate((s) => {
    const prev = s.nodes.get(num) ?? {
      num,
      longName: `!${num.toString(16)}`,
      shortName: num.toString(16).slice(-4),
      lastHeard: 0,
    };
    // ponytail: a patch with undefined must NOT overwrite the default/previous
    // value (e.g. a contact without position must keep the stored one)
    for (const k of Object.keys(patch) as (keyof NodeEntry)[]) {
      if (patch[k] === undefined) delete patch[k];
    }
    const merged = { ...prev, ...patch };
    s.nodes = new Map(s.nodes).set(num, merged);
    // ponytail: one write per event; IndexedDB handles this rate easily
    saveNode(merged).catch(dbFail(t("nodo")));
    // Only counts as a sighting once we're configured: during the initial dump
    // the radio re-sends its whole contact list and we'd mark every contact as
    // "heard now" on every startup. The patch's lastHeard (epoch s) is used
    // so the hour is the real one and not the connection time.
    if (
      patch.lastHeard !== undefined &&
      patch.lastHeard > prev.lastHeard &&
      s.status === DeviceStatus.Configured
    ) {
      marcarEscucha(num, patch.lastHeard * 1000).catch(dbFail(t("escucha")));
    }

    // Distance change: a contact going from direct to 2 hops usually means a
    // repeater down or a moved antenna. Only with the radio already
    // configured, for the same reason as sightings.
    if (
      patch.hopsAway !== undefined &&
      prev.hopsAway !== undefined &&
      patch.hopsAway !== prev.hopsAway &&
      s.status === DeviceStatus.Configured
    ) {
      avisarCambioRuta(merged, prev.hopsAway);
    }
  });
}

// One warning per node every 6 h: the distance can oscillate between two
// values for a while and we don't want a notification per bounce.
const rutaAvisada = new Map<number, number>();

function avisarCambioRuta(n: NodeEntry, antes: number): void {
  const ahora = n.hopsAway as number;
  saveHopChange(n.num, ahora, antes).catch(dbFail(t("cambio de ruta")));
  const quien = n.longName || n.shortName;
  addLog("RUTA: {0} pasa de {1} a {2} saltos", quien, antes, ahora);
  if (!n.fav || !getAlertCfg().on) return;
  if (Date.now() - (rutaAvisada.get(n.num) ?? -Infinity) < COOLDOWN_MS) return;
  rutaAvisada.set(n.num, Date.now());
  void notify(
    t("{0} · ruta {1}", quien, ahora > antes ? t("más larga") : t("más corta")),
    t("Ahora a {0} saltos (antes {1})", ahora, antes),
  );
}

// ── command plumbing ────────────────────────────────────────────────────────

// The companion protocol is strict request/response over one pipe: two
// commands in flight would cross-wire their replies. Everything that expects
// an answer goes through this chain.
let cmdChain: Promise<unknown> = Promise.resolve();
function withCmdLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = () => fn();
  const p = cmdChain.then(run, run);
  cmdChain = p.catch(() => {});
  return p;
}

/** Resolves with the next `code` event, rejects after `ms`. */
function expect<T>(c: Connection, code: number, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    c.once<T>(code, (data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(data);
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(t("{0}: sin respuesta en {1}s", what, ms / 1000)));
    }, ms);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(t("{0} no respondió en {1}s", what, ms / 1000))), ms),
    ),
  ]);
}

function setStatus(st: DeviceStatus): void {
  mutate((s) => {
    s.status = st;
  });
}

// ── contact ingestion ───────────────────────────────────────────────────────

function ingestContact(c: MeshCoreContact): number {
  const num = registerKey(c.publicKey);
  const outPath =
    c.outPathLen > 0 ? Array.from(c.outPath.slice(0, c.outPathLen)) : [];
  const prev = getSnapshot().nodes.get(num);
  upsertNode(num, {
    publicKey: hexOf(c.publicKey),
    type: c.type as ContactType,
    longName: c.advName || undefined,
    shortName: c.advName ? shortNameOf(c.advName, num) : undefined,
    lastAdvert: c.lastAdvert || undefined,
    lastHeard: c.lastAdvert || undefined,
    lat: c.advLat ? c.advLat / 1e6 : undefined,
    lon: c.advLon ? c.advLon / 1e6 : undefined,
    hopsAway: c.outPathLen >= 0 ? c.outPathLen : undefined,
    outPath,
  });
  // A changed out path is topology news: keep it as a route sample so the
  // MESH graph can draw the segments without anyone running traces by hand.
  if (
    outPath.length > 0 &&
    JSON.stringify(prev?.outPath ?? []) !== JSON.stringify(outPath)
  ) {
    saveTraceroute(num, {
      route: outPath.map(numFromHash),
      snrTowards: [],
      routeBack: [],
      snrBack: [],
      ts: Date.now(),
    }).catch(dbFail(t("ruta")));
  }
  return num;
}

let contactsBusy = false;
async function refreshContacts(): Promise<void> {
  const c = device;
  if (!c || contactsBusy) return;
  contactsBusy = true;
  try {
    const contacts = await withCmdLock(() =>
      withTimeout(c.getContacts(), 30_000, t("la lista de contactos")),
    );
    for (const contact of contacts) ingestContact(contact);
    // Direct contacts are our real neighbors: that's what draws solid lines
    // in the MESH graph.
    const { myNodeNum, nodes } = getSnapshot();
    if (myNodeNum !== undefined) {
      const direct = contacts
        .filter((x) => x.outPathLen === 0)
        .map((x) => {
          const num = numFromKeyBytes(x.publicKey);
          return { num, snr: nodes.get(num)?.snr ?? 0 };
        });
      saveNeighbors(myNodeNum, direct, Date.now()).catch(dbFail(t("vecinos")));
    }
  } finally {
    contactsBusy = false;
  }
}

// ── message sync ────────────────────────────────────────────────────────────

// Monotonic local id: the companion protocol has no message id of its own.
let lastMsgId = 0;
function nextMsgId(): number {
  lastMsgId = Math.max(Date.now(), lastMsgId + 1);
  return lastMsgId;
}

/** Sender timestamps come from the other node's clock: trust them when sane,
 *  fall back to our own otherwise. */
function saneTs(senderEpochS: number): number {
  const ms = senderEpochS * 1000;
  const now = Date.now();
  return ms > now - 7 * 86_400_000 && ms < now + 3_600_000 ? ms : now;
}

function ingestMessage(msg: Message): void {
  msg.convo = convoKey(msg);
  mutate((s) => {
    s.messages = [...s.messages, msg];
  });
  markUnread(msg.convo);
  saveMessage(msg).catch(dbFail(t("mensaje")));
  const { nodes, channels } = getSnapshot();
  const who =
    msg.from !== 0
      ? (nodes.get(msg.from)?.longName ?? `!${msg.from.toString(16)}`)
      : t("desconocido");
  const isDm = msg.convo.startsWith("dm:");
  const where = isDm ? "DM" : `#${channels.get(msg.channel)?.name ?? msg.channel}`;
  void notifyIncoming(`${who} · ${where}`, msg.text, isDm);
}

function handleContactMessage(m: MeshCoreContactMessage): void {
  const from = numFromKeyBytes(m.pubKeyPrefix);
  // ignored node: drop its message (no chat, no unread, no notification)
  if (getSnapshot().nodes.get(from)?.ignored) return;
  const { myNodeNum } = getSnapshot();
  const nowS = Math.floor(Date.now() / 1000);
  upsertNode(from, { lastHeard: nowS });
  ingestMessage({
    id: nextMsgId(),
    convo: "",
    from,
    to: myNodeNum ?? 0,
    channel: 0,
    text: m.text,
    ts: saneTs(m.senderTimestamp),
    mine: false,
    state: "delivered",
    hops: m.pathLen === 0xff ? 0 : m.pathLen,
  });
}

function handleChannelMessage(m: MeshCoreChannelMessage): void {
  // Channel messages carry the sender inside the text ("Name: hi"): match the
  // prefix against known contacts so the chat can name and link the sender.
  let from = 0;
  let text = m.text;
  const sep = m.text.indexOf(": ");
  if (sep > 0) {
    const name = m.text.slice(0, sep);
    for (const n of getSnapshot().nodes.values()) {
      if (n.longName === name) {
        from = n.num;
        text = m.text.slice(sep + 2);
        break;
      }
    }
  }
  if (from !== 0 && getSnapshot().nodes.get(from)?.ignored) return;
  if (from !== 0) upsertNode(from, { lastHeard: Math.floor(Date.now() / 1000) });
  ingestMessage({
    id: nextMsgId(),
    convo: "",
    from,
    to: 0xffffffff,
    channel: m.channelIdx,
    text,
    ts: saneTs(m.senderTimestamp),
    mine: false,
    state: "delivered",
    hops: m.pathLen === 0xff ? 0 : m.pathLen,
  });
}

let syncBusy = false;
async function syncMessages(): Promise<void> {
  const c = device;
  if (!c || syncBusy) return;
  syncBusy = true;
  try {
    // bounded loop: a stuck radio must not spin this forever
    for (let i = 0; i < 500; i++) {
      const r = await withCmdLock(() =>
        withTimeout(c.syncNextMessage(), 10_000, t("la cola de mensajes")),
      );
      if (!r) break;
      if (r.contactMessage) handleContactMessage(r.contactMessage);
      else if (r.channelMessage) handleChannelMessage(r.channelMessage);
    }
  } catch (e) {
    addLog("SYNC: {0}", String(e));
  } finally {
    syncBusy = false;
  }
}

// ── delivery tracking ───────────────────────────────────────────────────────

const pendingAcks = new Map<number, { msgId: number; ts: number; timer: number }>();

function setMsgState(id: number, ts: number, state: Message["state"]): void {
  mutate((s) => {
    s.messages = s.messages.map((m) =>
      m.id === id && m.ts === ts ? { ...m, state } : m,
    );
  });
  updateMessageState(id, state).catch(dbFail(t("estado de mensaje")));
}

function onSendConfirmed(p: { ackCode: number; roundTrip: number }): void {
  const pending = pendingAcks.get(p.ackCode);
  if (!pending) return;
  pendingAcks.delete(p.ackCode);
  clearTimeout(pending.timer);
  setMsgState(pending.msgId, pending.ts, "delivered");
  addLog("ACK en {0} ms", p.roundTrip);
}

// ── event wiring ────────────────────────────────────────────────────────────

// Refreshing contacts on every advert would hammer the link in a busy mesh
let advertDebounce: number | undefined;
function scheduleContactRefresh(): void {
  clearTimeout(advertDebounce);
  advertDebounce = setTimeout(() => {
    refreshContacts().catch((e) => addLog("CONTACTOS: {0}", String(e)));
  }, 2_000) as unknown as number;
}

function wireEvents(c: Connection): void {
  c.on("disconnected", () => {
    if (device !== c) return; // manual disconnect or an older link: not ours
    handleLost();
  });

  c.on<{ publicKey: Uint8Array }>(Constants.PushCodes.Advert, (p) => {
    const num = numFromKeyBytes(p.publicKey);
    const name = getSnapshot().nodes.get(num)?.longName ?? `!${num.toString(16)}`;
    addLog("ADVERT de {0}", name);
    upsertNode(num, { lastHeard: Math.floor(Date.now() / 1000) });
    scheduleContactRefresh();
  });

  // Manual-add firmware pushes the full advert instead: accept it explicitly,
  // which is this terminal's job — it records everything the mesh says.
  c.on<MeshCoreContact & { lastMod?: number }>(Constants.PushCodes.NewAdvert, (adv) => {
    addLog("ADVERT nuevo de {0}", adv.advName || "?");
    void withCmdLock(() =>
      c.sendCommandAddUpdateContact(
        adv.publicKey,
        adv.type,
        adv.flags,
        adv.outPathLen,
        adv.outPath,
        adv.advName,
        adv.lastAdvert,
        adv.advLat,
        adv.advLon,
      ),
    ).catch(() => {});
    ingestContact(adv);
  });

  c.on<{ publicKey: Uint8Array }>(Constants.PushCodes.PathUpdated, (p) => {
    const num = numFromKeyBytes(p.publicKey);
    const name = getSnapshot().nodes.get(num)?.longName ?? `!${num.toString(16)}`;
    addLog("RUTA actualizada hacia {0}", name);
    scheduleContactRefresh();
  });

  c.on(Constants.PushCodes.MsgWaiting, () => {
    void syncMessages();
  });

  c.on<{ ackCode: number; roundTrip: number }>(
    Constants.PushCodes.SendConfirmed,
    onSendConfirmed,
  );

  c.on<{ lastSnr: number; lastRssi: number; raw: Uint8Array }>(
    Constants.PushCodes.LogRxData,
    (p) => {
      addLog("RX {0} bytes · SNR {1} dB · RSSI {2} dBm", p.raw.length, p.lastSnr, p.lastRssi);
    },
  );

  c.on<{
    pathLen: number;
    tag: number;
    pathHashes: Uint8Array;
    pathSnrs: Uint8Array;
    lastSnr: number;
  }>(Constants.PushCodes.TraceData, (p) => {
    const dest = pendingTraces.get(p.tag);
    if (dest === undefined) return;
    pendingTraces.delete(p.tag);
    const tr: Traceroute = {
      route: Array.from(p.pathHashes, numFromHash),
      snrTowards: Array.from(p.pathSnrs, int8),
      routeBack: [],
      snrBack: [],
      ts: Date.now(),
    };
    mutate((s) => {
      s.traceroutes = new Map(s.traceroutes).set(dest, tr);
    });
    saveTraceroute(dest, tr).catch(dbFail("traceroute"));
    addLog("Trace hacia !{0}: {1} saltos", dest.toString(16), tr.route.length);
  });

  c.on<{ pubKeyPrefix: Uint8Array; lppSensorData: Uint8Array }>(
    Constants.PushCodes.TelemetryResponse,
    (p) => {
      const from = numFromKeyBytes(p.pubKeyPrefix);
      ingestLpp(from, p.lppSensorData);
    },
  );
}

// ── LPP telemetry ───────────────────────────────────────────────────────────

const LPP_METRICS: Record<number, string> = {
  103: "temperature",
  104: "relativeHumidity",
  115: "pressure",
  116: "voltage",
  117: "current",
  120: "batteryLevel",
  101: "luminosity",
  121: "altitude",
};

function ingestLpp(from: number, lpp: Uint8Array): void {
  const ts = Date.now();
  let n = 0;
  try {
    for (const entry of CayenneLpp.parse(lpp)) {
      if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) continue;
      const base = LPP_METRICS[entry.type] ?? `lpp${entry.type}`;
      // channel 1 is the conventional "the device itself" channel
      const metric = entry.channel <= 1 ? base : `${base}_ch${entry.channel}`;
      saveTelemetry(from, metric, entry.value, ts).catch(dbFail(t("telemetría")));
      if (metric === "voltage") {
        upsertNode(from, {
          voltage: entry.value,
          batteryLevel: liPoPercent(entry.value * 1000),
        });
      }
      n++;
    }
  } catch (e) {
    addLog("LPP: datos ilegibles de !{0}: {1}", from.toString(16), String(e));
  }
  if (n > 0) {
    addLog("TELEMETRÍA de !{0}: {1} métricas", from.toString(16), n);
    mutate((s) => {
      s.posUpdates = new Map(s.posUpdates).set(from, ts);
    });
  }
}

// ── periodic polling ────────────────────────────────────────────────────────

let pollTimer: number | undefined;
let contactsTimer: number | undefined;
let statsSupported = true;
let prevStats: { txAirSecs: number; rxAirSecs: number; recv: number; sent: number; ts: number } | undefined;

async function pollSelfTelemetry(): Promise<void> {
  const c = device;
  const { myNodeNum } = getSnapshot();
  if (!c || myNodeNum === undefined) return;
  const ts = Date.now();
  try {
    const bat = await withCmdLock(async () => {
      const p = expect<{ batteryMilliVolts: number }>(
        c,
        Constants.ResponseCodes.BatteryVoltage,
        5_000,
        t("la batería"),
      );
      await c.sendCommandGetBatteryVoltage();
      return p;
    });
    const volts = bat.batteryMilliVolts / 1000;
    const pct = liPoPercent(bat.batteryMilliVolts);
    saveTelemetry(myNodeNum, "voltage", volts, ts).catch(dbFail(t("telemetría")));
    saveTelemetry(myNodeNum, "batteryLevel", pct, ts).catch(dbFail(t("telemetría")));
    upsertNode(myNodeNum, {
      voltage: volts,
      batteryLevel: pct,
      lastHeard: Math.floor(ts / 1000),
    });
    mutate((s) => {
      if (s.deviceInfo) s.deviceInfo = { ...s.deviceInfo, batteryMv: bat.batteryMilliVolts };
    });
  } catch {
    // battery query unsupported: nothing to chart
  }
  if (!statsSupported) return;
  try {
    const radio = await queryStats(c, Constants.StatsTypes.Radio);
    const core = await queryStats(c, Constants.StatsTypes.Core);
    const pkts = await queryStats(c, Constants.StatsTypes.Packets);
    const r = radio as { noiseFloor: number; lastRssi: number; lastSnr: number; txAirSecs: number; rxAirSecs: number };
    const k = core as { uptimeSecs: number; queueLen: number };
    const q = pkts as { recv: number; sent: number };
    saveTelemetry(myNodeNum, "noiseFloor", r.noiseFloor, ts).catch(dbFail(t("telemetría")));
    if (prevStats) {
      const dt = (ts - prevStats.ts) / 1000;
      if (dt > 0) {
        // air-seconds deltas → duty-cycle %, the closest MeshCore gets to
        // Meshtastic's channel utilization charts
        saveTelemetry(myNodeNum, "airUtilTx", ((r.txAirSecs - prevStats.txAirSecs) / dt) * 100, ts).catch(dbFail(t("telemetría")));
        saveTelemetry(myNodeNum, "channelUtilization", ((r.rxAirSecs - prevStats.rxAirSecs) / dt) * 100, ts).catch(dbFail(t("telemetría")));
        saveTelemetry(myNodeNum, "packetsRx", q.recv - prevStats.recv, ts).catch(dbFail(t("telemetría")));
        saveTelemetry(myNodeNum, "packetsTx", q.sent - prevStats.sent, ts).catch(dbFail(t("telemetría")));
      }
    }
    prevStats = { txAirSecs: r.txAirSecs, rxAirSecs: r.rxAirSecs, recv: q.recv, sent: q.sent, ts };
    saveTelemetry(myNodeNum, "uptime", k.uptimeSecs, ts).catch(dbFail(t("telemetría")));
    saveTelemetry(myNodeNum, "txQueue", k.queueLen, ts).catch(dbFail(t("telemetría")));
  } catch {
    // older firmware without GetStats: stop asking
    statsSupported = false;
    addLog("STATS no soportado por este firmware");
  }
}

function queryStats(c: Connection, type: number): Promise<unknown> {
  return withCmdLock(async () => {
    const p = new Promise((resolve, reject) => {
      let done = false;
      const finish = (v: unknown, err?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(v);
      };
      c.once<{ type: number; data: unknown }>(Constants.ResponseCodes.Stats, (s) =>
        finish(s.data),
      );
      c.once(Constants.ResponseCodes.Err, () => finish(undefined, new Error("ERR")));
      c.once(Constants.ResponseCodes.Disabled, () => finish(undefined, new Error("DISABLED")));
      const timer = setTimeout(() => finish(undefined, new Error("TIMEOUT")), 5_000);
    });
    await c.sendCommandGetStats(type);
    return p;
  });
}

// ── connect / disconnect ────────────────────────────────────────────────────

// Opening the browser device picker + link can hang with no error of its own.
const OPEN_TIMEOUT_MS = 40_000;

type Mode = "serial" | "ble";
let lastMode: Mode | undefined;
// Web Bluetooth can reconnect to the same device object without a new picker
let lastBleDevice: unknown | undefined;

// The app registers here what to do when the link drops on its own (not a
// manual disconnect): it triggers auto-reconnection.
let onConnectionLost: (() => void) | undefined;
export function setConnectionLostHandler(cb: (() => void) | undefined): void {
  onConnectionLost = cb;
}

function handleLost(): void {
  if (!device) return; // already disconnected manually
  device = undefined;
  stopTimers();
  setStatus(DeviceStatus.Disconnected);
  addLog("Enlace perdido");
  if (!onConnectionLost) {
    addLog("RECONEXION: sin manejador registrado, no se reintenta");
    return;
  }
  onConnectionLost();
}

function stopTimers(): void {
  clearInterval(pollTimer);
  clearInterval(contactsTimer);
  pollTimer = undefined;
  contactsTimer = undefined;
}

const pendingTraces = new Map<number, number>();

function waitEvent(c: Connection, event: string, ms: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    c.once(event, () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(t("{0} no respondió en {1}s", what, ms / 1000)));
    }, ms);
  });
}

async function connectWith(make: () => Promise<Connection | null | undefined>): Promise<void> {
  // tear down whatever came before: one link at a time
  const prev = device;
  device = undefined;
  stopTimers();
  if (prev) await prev.close().catch(() => {});

  setStatus(DeviceStatus.Connecting);
  let c: Connection | null | undefined;
  try {
    c = await withTimeout(make(), OPEN_TIMEOUT_MS, t("la conexión"));
  } catch (e) {
    setStatus(DeviceStatus.Disconnected);
    throw e;
  }
  if (!c) {
    setStatus(DeviceStatus.Disconnected);
    throw new Error(t("Conexión cancelada"));
  }

  const ready = waitEvent(c, "connected", 25_000, t("el dispositivo"));
  wireEvents(c);
  device = c;
  try {
    await ready;
    setStatus(DeviceStatus.Configuring);
    await configure(c);
  } catch (e) {
    device = undefined;
    // leave nothing half-open, or the next attempt finds the port busy
    await c.close().catch(() => {});
    setStatus(DeviceStatus.Disconnected);
    throw e;
  }
  setStatus(DeviceStatus.Configured);
}

async function configure(c: Connection): Promise<void> {
  const info = await withCmdLock(() =>
    withTimeout(c.getSelfInfo(15_000), 16_000, t("la identidad de la radio")),
  );
  const myNum = registerKey(info.publicKey);
  mutate((s) => {
    s.myNodeNum = myNum;
    s.selfInfo = {
      num: myNum,
      publicKey: hexOf(info.publicKey),
      name: info.name,
      advLat: info.advLat / 1e6,
      advLon: info.advLon / 1e6,
      txPower: info.txPower,
      maxTxPower: info.maxTxPower,
      radioFreq: info.radioFreq,
      radioBw: info.radioBw,
      radioSf: info.radioSf,
      radioCr: info.radioCr,
      manualAddContacts: info.manualAddContacts !== 0,
    };
  });
  upsertNode(myNum, {
    publicKey: hexOf(info.publicKey),
    type: ContactType.Chat,
    longName: info.name,
    shortName: shortNameOf(info.name, myNum),
    lastHeard: Math.floor(Date.now() / 1000),
    lat: info.advLat ? info.advLat / 1e6 : undefined,
    lon: info.advLon ? info.advLon / 1e6 : undefined,
    hopsAway: 0,
  });
  addLog("Radio: {0}", info.name);

  // A LoRa node in the field has no NTP: our clock is the good one.
  await withCmdLock(() => c.sendCommandSetDeviceTime(Math.floor(Date.now() / 1000))).catch(() => {});

  try {
    const dev = await withCmdLock(async () => {
      const p = expect<{ firmwareVer: number; firmware_build_date: string; manufacturerModel: string }>(
        c,
        Constants.ResponseCodes.DeviceInfo,
        5_000,
        t("la información del equipo"),
      );
      await c.sendCommandDeviceQuery(Constants.SupportedCompanionProtocolVersion);
      return p;
    });
    mutate((s) => {
      s.deviceInfo = {
        firmwareVer: dev.firmwareVer,
        buildDate: dev.firmware_build_date,
        model: dev.manufacturerModel,
      };
    });
    addLog("HW {0} · fw v{1} ({2})", dev.manufacturerModel, dev.firmwareVer, dev.firmware_build_date);
  } catch {
    // device query unsupported on old firmware: not fatal
  }

  await refreshContacts();
  await refreshChannels().catch((e) => addLog("CANALES: {0}", String(e)));
  addLog("Configurado: {0} contactos", getSnapshot().nodes.size);

  // drain queued messages + start the periodic pollers
  void syncMessages();
  void pollSelfTelemetry();
  pollTimer = setInterval(() => void pollSelfTelemetry(), 60_000) as unknown as number;
  contactsTimer = setInterval(() => void refreshContacts().catch(() => {}), 300_000) as unknown as number;
}

/** Fresh connect: always shows the browser's port picker (that IS the port
 *  dropdown of a web app). */
export async function connectSerial(): Promise<void> {
  await connectWith(async () => {
    lastMode = "serial";
    return WebSerialConnection.open();
  });
}

/** Silent reconnect to the port the user already granted. */
export async function reconnectSerial(): Promise<void> {
  await connectWith(async () => {
    const serial = (navigator as { serial?: { getPorts(): Promise<unknown[]> } }).serial;
    if (!serial) throw new Error(t("Web Serial no disponible en este navegador"));
    const ports = await serial.getPorts();
    const port = ports[0] as
      | { open(o: { baudRate: number }): Promise<void>; readable: unknown }
      | undefined;
    if (!port) throw new Error(t("Sin puerto autorizado que reintentar"));
    if (!port.readable) await port.open({ baudRate: 115200 });
    return new WebSerialConnection(port);
  });
}

export async function connectBle(): Promise<void> {
  await connectWith(async () => {
    lastMode = "ble";
    const c = await WebBleConnection.open();
    if (c) lastBleDevice = (c as unknown as { bleDevice: unknown }).bleDevice;
    return c;
  });
}

export async function reconnectBle(): Promise<void> {
  await connectWith(async () => {
    if (!lastBleDevice) throw new Error(t("Sin dispositivo BLE que reintentar"));
    return new WebBleConnection(lastBleDevice);
  });
}

/** Retries the last used transport without user interaction. */
export async function reconnectLast(): Promise<void> {
  if (lastMode === "serial") return reconnectSerial();
  if (lastMode === "ble") return reconnectBle();
  throw new Error(t("Sin conexión previa que reintentar"));
}

export function canReconnect(): boolean {
  return lastMode !== undefined;
}

export async function disconnect(): Promise<void> {
  const prev = device;
  device = undefined; // before close(): the disconnect event must see "manual"
  stopTimers();
  await prev?.close().catch(() => {});
  setStatus(DeviceStatus.Disconnected);
}

// ── channels ────────────────────────────────────────────────────────────────

const MAX_CHANNELS = 8;

function queryChannel(c: Connection, idx: number): Promise<ChannelEntry | undefined> {
  return withCmdLock(async () => {
    const p = new Promise<ChannelEntry | undefined>((resolve) => {
      let done = false;
      const finish = (v: ChannelEntry | undefined) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      };
      c.once<{ channelIdx: number; name: string; secret: Uint8Array }>(
        Constants.ResponseCodes.ChannelInfo,
        (ch) => finish({ index: ch.channelIdx, name: ch.name, secret: ch.secret }),
      );
      c.once(Constants.ResponseCodes.Err, () => finish(undefined));
      const timer = setTimeout(() => finish(undefined), 3_000);
    });
    await c.sendCommandGetChannel(idx);
    return p;
  });
}

export async function refreshChannels(): Promise<void> {
  const c = device;
  if (!c) throw new Error(t("Sin conexión"));
  const found = new Map<number, ChannelEntry>();
  for (let i = 0; i < MAX_CHANNELS; i++) {
    const ch = await queryChannel(c, i);
    if (!ch) continue;
    // an empty name with a zero key is an unused slot, not a channel
    const empty = !ch.name && (ch.secret?.every((b) => b === 0) ?? true);
    if (!empty) found.set(ch.index, ch);
  }
  mutate((s) => {
    s.channels = found;
  });
}

export async function setChannelCfg(
  index: number,
  name: string,
  secret: Uint8Array,
): Promise<void> {
  const c = device;
  if (!c) throw new Error(t("Sin conexión"));
  if (secret.length !== 16) throw new Error(t("La clave debe tener 16 bytes"));
  await withCmdLock(async () => {
    const p = expect(c, Constants.ResponseCodes.Ok, 5_000, t("el canal"));
    await c.sendCommandSetChannel(index, name, secret);
    return p;
  });
  addLog("Canal {0} guardado: {1}", index, name || "—");
  await refreshChannels();
}

/** Random 128-bit channel key (the GEN button). */
export function genChannelSecret(): Uint8Array {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return b;
}

// ── config commands ─────────────────────────────────────────────────────────

async function okCommand(fn: (c: Connection) => Promise<void>, what: string): Promise<void> {
  const c = device;
  if (!c) throw new Error(t("Sin conexión"));
  await withCmdLock(async () => {
    const p = expect(c, Constants.ResponseCodes.Ok, 8_000, what);
    await fn(c);
    return p;
  });
}

export async function setAdvertNameCfg(name: string): Promise<void> {
  await okCommand((c) => c.setAdvertName(name), t("el nombre"));
  mutate((s) => {
    if (s.selfInfo) s.selfInfo = { ...s.selfInfo, name };
  });
  const { myNodeNum } = getSnapshot();
  if (myNodeNum !== undefined) {
    upsertNode(myNodeNum, { longName: name, shortName: shortNameOf(name, myNodeNum) });
  }
  addLog("Nombre cambiado a {0}", name);
}

// Fixed position: MeshCore adverts carry it to the mesh, same purpose as the
// firmware's fixed position in the original.
export async function setFixedPosition(lat: number, lon: number): Promise<void> {
  await okCommand(
    (c) => c.setAdvertLatLong(Math.round(lat * 1e6), Math.round(lon * 1e6)),
    t("la posición"),
  );
  mutate((s) => {
    if (s.selfInfo) s.selfInfo = { ...s.selfInfo, advLat: lat, advLon: lon };
  });
  const { myNodeNum } = getSnapshot();
  if (myNodeNum !== undefined) upsertNode(myNodeNum, { lat, lon });
  addLog("Posición fija: {0}, {1}", lat.toFixed(5), lon.toFixed(5));
}

export async function clearFixedPosition(): Promise<void> {
  await okCommand((c) => c.setAdvertLatLong(0, 0), t("la posición"));
  mutate((s) => {
    if (s.selfInfo) s.selfInfo = { ...s.selfInfo, advLat: 0, advLon: 0 };
  });
  addLog("Posición fija borrada");
}

export async function applyRadioParams(
  freq: number,
  bw: number,
  sf: number,
  cr: number,
): Promise<void> {
  await okCommand((c) => c.setRadioParams(freq, bw, sf, cr), t("los parámetros de radio"));
  mutate((s) => {
    if (s.selfInfo)
      s.selfInfo = { ...s.selfInfo, radioFreq: freq, radioBw: bw, radioSf: sf, radioCr: cr };
  });
  addLog("Radio: {0} kHz · BW {1} · SF{2} · CR{3}", freq, bw, sf, cr);
}

export async function applyTxPower(dbm: number): Promise<void> {
  await okCommand((c) => c.setTxPower(dbm), t("la potencia"));
  mutate((s) => {
    if (s.selfInfo) s.selfInfo = { ...s.selfInfo, txPower: dbm };
  });
  addLog("TX power: {0} dBm", dbm);
}

export async function sendAdvert(flood: boolean): Promise<void> {
  const c = device;
  if (!c) throw new Error(t("Sin conexión"));
  await withCmdLock(() => (flood ? c.sendFloodAdvert() : c.sendZeroHopAdvert()));
  addLog(flood ? "Advert (flood) enviado" : "Advert (zero hop) enviado");
}

export async function rebootRadio(): Promise<void> {
  const c = device;
  if (!c) throw new Error(t("Sin conexión"));
  await c.sendCommandReboot();
  addLog("Reboot enviado a la radio");
}

export async function exportPrivateKeyB64(): Promise<string> {
  const c = device;
  if (!c) throw new Error(t("Sin conexión"));
  const r = await withCmdLock(async () => {
    const p = expect<{ privateKey: Uint8Array }>(
      c,
      Constants.ResponseCodes.PrivateKey,
      5_000,
      t("la clave privada"),
    );
    await c.sendCommandExportPrivateKey();
    return p;
  });
  return bytesToB64(r.privateKey);
}

// ── full config backup/restore ──────────────────────────────────────────────

export function exportConfigJson(): string {
  const { selfInfo, channels } = getSnapshot();
  return JSON.stringify(
    {
      v: 1,
      kind: "meshcore-terminal-backup",
      name: selfInfo?.name,
      advLat: selfInfo?.advLat,
      advLon: selfInfo?.advLon,
      txPower: selfInfo?.txPower,
      radioFreq: selfInfo?.radioFreq,
      radioBw: selfInfo?.radioBw,
      radioSf: selfInfo?.radioSf,
      radioCr: selfInfo?.radioCr,
      channels: [...channels.values()].map((ch) => ({
        index: ch.index,
        name: ch.name,
        secret: ch.secret ? bytesToB64(ch.secret) : undefined,
      })),
    },
    null,
    2,
  );
}

export async function importConfigJson(json: string): Promise<number> {
  if (!device) throw new Error(t("Sin conexión"));
  const data = JSON.parse(json) as {
    v: number;
    name?: string;
    advLat?: number;
    advLon?: number;
    txPower?: number;
    radioFreq?: number;
    radioBw?: number;
    radioSf?: number;
    radioCr?: number;
    channels?: { index: number; name: string; secret?: string }[];
  };
  if (data.v !== 1) throw new Error(t("versión de backup desconocida: {0}", data.v));
  let n = 0;
  if (data.name) {
    await setAdvertNameCfg(data.name);
    n++;
  }
  if (data.advLat !== undefined && data.advLon !== undefined && (data.advLat || data.advLon)) {
    await setFixedPosition(data.advLat, data.advLon);
    n++;
  }
  if (
    data.radioFreq !== undefined &&
    data.radioBw !== undefined &&
    data.radioSf !== undefined &&
    data.radioCr !== undefined
  ) {
    await applyRadioParams(data.radioFreq, data.radioBw, data.radioSf, data.radioCr);
    n++;
  }
  if (data.txPower !== undefined) {
    await applyTxPower(data.txPower);
    n++;
  }
  for (const ch of data.channels ?? []) {
    if (ch.secret === undefined) continue;
    await setChannelCfg(ch.index, ch.name, b64ToBytes(ch.secret));
    n++;
  }
  addLog("Backup restaurado: {0} ajustes aplicados", n);
  return n;
}

// ── contact actions ─────────────────────────────────────────────────────────

export function toggleFav(num: number): void {
  const n = getSnapshot().nodes.get(num);
  if (n) upsertNode(num, { fav: !n.fav });
}

export function toggleIgnored(num: number): void {
  const n = getSnapshot().nodes.get(num);
  if (n) upsertNode(num, { ignored: !n.ignored });
}

// Deletes the contact from the radio (if connected) and from the local DB/state.
export async function deleteNode(num: number): Promise<void> {
  const pk = pubkeyByNum.get(num);
  if (device && pk) {
    await withCmdLock(() => device!.sendCommandRemoveContact(pk)).catch(() => {});
  }
  mutate((s) => {
    const m = new Map(s.nodes);
    m.delete(num);
    s.nodes = m;
  });
  await deleteNodeDb(num).catch(() => {});
  addLog("Nodo !{0} borrado", num.toString(16));
}

// Clears the messages of one conversation from the store and the DB.
export async function clearConvo(convo: string): Promise<void> {
  mutate((s) => {
    s.messages = s.messages.filter((m) => m.convo !== convo);
  });
  const n = await deleteConvoMessages(convo).catch(() => 0);
  addLog("Conversación {0} limpiada: {1} mensajes borrados", convo, n);
}

/** Trace the stored out path towards a contact: each hop answers with its SNR.
 *  The reply arrives via the TraceData push, which stores and logs it. */
export async function runTraceroute(dest: number): Promise<void> {
  const c = device;
  if (!c) throw new Error(t("Sin conexión"));
  const node = getSnapshot().nodes.get(dest);
  const path = node?.outPath ?? [];
  if (path.length === 0) {
    throw new Error(t("Contacto directo o sin ruta conocida: nada que trazar"));
  }
  mutate((s) => {
    const m = new Map(s.traceroutes);
    m.delete(dest);
    s.traceroutes = m;
  });
  const tag = Math.floor(Math.random() * 0xffffffff) >>> 0;
  pendingTraces.set(tag, dest);
  await withCmdLock(() => c.sendCommandSendTracePath(tag, 0, Uint8Array.from(path)));
  addLog("Trace lanzado hacia !{0} ({1} saltos)", dest.toString(16), path.length);
}

/** Drops the stored out path so the next exchange floods and re-learns it. */
export async function resetPath(num: number): Promise<void> {
  const c = device;
  const pk = pubkeyByNum.get(num);
  if (!c || !pk) throw new Error(t("Sin conexión"));
  await withCmdLock(async () => {
    const p = expect(c, Constants.ResponseCodes.Ok, 5_000, t("la ruta"));
    await c.sendCommandResetPath(pk);
    return p;
  });
  upsertNode(num, { hopsAway: undefined, outPath: [] });
  addLog("Ruta hacia !{0} reiniciada", num.toString(16));
}

/** Asks the radio to broadcast this contact's card to the mesh. */
export async function shareContact(num: number): Promise<void> {
  const c = device;
  const pk = pubkeyByNum.get(num);
  if (!c || !pk) throw new Error(t("Sin conexión"));
  await withCmdLock(() => c.sendCommandShareContact(pk));
  addLog("Contacto !{0} compartido en la malla", num.toString(16));
}

/** Requests sensor telemetry (Cayenne LPP) from a contact. The reply arrives
 *  via the TelemetryResponse push and lands in the TELEMETRY tables. */
export async function requestTelemetry(num: number): Promise<void> {
  const c = device;
  const pk = pubkeyByNum.get(num);
  if (!c || !pk) throw new Error(t("Sin conexión"));
  await withCmdLock(() => c.sendCommandSendTelemetryReq(pk));
  addLog("Telemetría pedida a !{0}", num.toString(16));
}

// ── local waypoints ─────────────────────────────────────────────────────────

// MeshCore has no waypoint packet: these are local map notes, never transmitted.
export async function sendWaypoint(
  w: Omit<Waypoint, "from" | "id"> & { id?: number },
): Promise<void> {
  const wp: Waypoint = {
    ...w,
    id: w.id || Math.floor(Math.random() * 0x7fffffff) + 1,
    from: getSnapshot().myNodeNum ?? 0,
  };
  mutate((s) => {
    s.waypoints = new Map(s.waypoints).set(wp.id, wp);
  });
  await saveWaypoint(wp).catch(dbFail("waypoint"));
}

export async function deleteWaypoint(id: number): Promise<void> {
  mutate((s) => {
    const m = new Map(s.waypoints);
    m.delete(id);
    s.waypoints = m;
  });
  await deleteWaypointDb(id).catch(() => {});
}

// ── sending messages ────────────────────────────────────────────────────────

const ACK_TIMEOUT_MIN_MS = 12_000;

async function transmit(msg: Message): Promise<void> {
  const c = device;
  if (!c) throw new Error(t("Sin conexión"));
  const isDm = msg.convo.startsWith("dm:");
  if (isDm) {
    const dest = Number(msg.convo.slice(3));
    const pk = pubkeyByNum.get(dest);
    if (!pk) throw new Error(t("Contacto desconocido"));
    const sent = await withCmdLock(() =>
      withTimeout(c.sendTextMessage(pk, msg.text), 15_000, t("el envío")),
    );
    if (sent.expectedAckCrc) {
      setMsgState(msg.id, msg.ts, "sent");
      const wait = Math.max(ACK_TIMEOUT_MIN_MS, (sent.estTimeout || 0) * 1.5);
      const timer = setTimeout(() => {
        if (pendingAcks.delete(sent.expectedAckCrc)) {
          setMsgState(msg.id, msg.ts, "failed");
          addLog("Sin ACK de !{0}: mensaje fallido", dest.toString(16));
        }
      }, wait) as unknown as number;
      pendingAcks.set(sent.expectedAckCrc, { msgId: msg.id, ts: msg.ts, timer });
    } else {
      // flood send without ack expectation: "sent" is all we will ever know
      setMsgState(msg.id, msg.ts, "sent");
    }
  } else {
    const channel = Number(msg.convo.slice(3));
    await withCmdLock(() =>
      withTimeout(c.sendChannelTextMessage(channel, msg.text), 15_000, t("el envío")),
    );
    // broadcast: the radio accepted it; there is no ack to wait for
    setMsgState(msg.id, msg.ts, "sent");
  }
}

// Retries a failed message reusing the same entry (id/ts untouched).
export async function retryMessage(msg: Message): Promise<void> {
  if (!device) throw new Error(t("Sin conexión"));
  setMsgState(msg.id, msg.ts, "queued");
  try {
    await transmit(msg);
  } catch (e) {
    setMsgState(msg.id, msg.ts, "failed");
    throw e;
  }
}

export async function sendText(
  text: string,
  convo: string,
  replyId?: number,
): Promise<void> {
  if (!device) throw new Error(t("Sin conexión"));
  const isDm = convo.startsWith("dm:");
  const destination = isDm ? Number(convo.slice(3)) : 0xffffffff;
  const channel = isDm ? 0 : Number(convo.slice(3));

  const msg: Message = {
    id: nextMsgId(),
    convo,
    from: 0,
    to: destination,
    channel,
    text,
    ts: Date.now(),
    mine: true,
    state: "queued",
    replyId,
  };
  mutate((s) => {
    msg.from = s.myNodeNum ?? 0;
    s.messages = [...s.messages, msg];
  });
  saveMessage(msg).catch(dbFail(t("mensaje")));

  try {
    await transmit(msg);
  } catch (e) {
    setMsgState(msg.id, msg.ts, "failed");
    throw e;
  }
}
