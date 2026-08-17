import type { Message, NodeEntry, Traceroute, Waypoint } from "./store";

/** Same API as the original SQLite layer, on IndexedDB: the browser has no
 *  SQLite, and everything the app persists is key/range lookups anyway. */

const DB_NAME = "lilyshark";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | undefined;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const messages = db.createObjectStore("messages", { keyPath: ["id", "ts"] });
      messages.createIndex("convo", "convo");
      messages.createIndex("ts", "ts");
      messages.createIndex("id", "id");
      const telemetry = db.createObjectStore("telemetry", { autoIncrement: true });
      telemetry.createIndex("nmt", ["node", "metric", "ts"]);
      telemetry.createIndex("nm", ["node", "metric"]);
      telemetry.createIndex("node", "node");
      telemetry.createIndex("ts", "ts");
      db.createObjectStore("nodes", { keyPath: "num" });
      const traceroutes = db.createObjectStore("traceroutes", { keyPath: ["node", "ts"] });
      traceroutes.createIndex("node", "node");
      traceroutes.createIndex("ts", "ts");
      const hops = db.createObjectStore("hops", { keyPath: ["node", "ts"] });
      hops.createIndex("node", "node");
      hops.createIndex("ts", "ts");
      const sightings = db.createObjectStore("sightings", { keyPath: ["node", "hourBucket"] });
      sightings.createIndex("hourBucket", "hourBucket");
      const neighbors = db.createObjectStore("neighbors", { keyPath: ["node", "neighbor"] });
      neighbors.createIndex("node", "node");
      neighbors.createIndex("ts", "ts");
      db.createObjectStore("waypoints", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("tx aborted"));
  });
}

async function store(
  name: string,
  mode: IDBTransactionMode = "readonly",
): Promise<{ os: IDBObjectStore; tx: IDBTransaction }> {
  const db = await openDb();
  const tx = db.transaction(name, mode);
  return { os: tx.objectStore(name), tx };
}

/** Collects up to `limit` cursor rows (default: all). */
function collect<T>(
  source: IDBObjectStore | IDBIndex,
  range?: IDBKeyRange,
  direction: IDBCursorDirection = "next",
  limit = Infinity,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const out: T[] = [];
    const req = source.openCursor(range, direction);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || out.length >= limit) return resolve(out);
      out.push(cur.value as T);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Deletes every row whose `index` key falls in `range`; returns the count. */
function deleteRange(
  os: IDBObjectStore,
  indexName: string,
  range: IDBKeyRange,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let n = 0;
    const req = os.index(indexName).openCursor(range);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve(n);
      cur.delete();
      n++;
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

// ── messages ────────────────────────────────────────────────────────────────

interface MessageRow {
  id: number;
  convo: string;
  from: number;
  to: number;
  channel: number;
  text: string;
  ts: number;
  mine: 0 | 1;
  state: string;
  replyId: number | null;
}

export async function saveMessage(m: Message): Promise<void> {
  const { os, tx } = await store("messages", "readwrite");
  os.put({
    id: m.id,
    convo: m.convo,
    from: m.from,
    to: m.to,
    channel: m.channel,
    text: m.text,
    ts: m.ts,
    mine: m.mine ? 1 : 0,
    state: m.state,
    replyId: m.replyId ?? null,
  } satisfies MessageRow);
  await txDone(tx);
}

export async function updateMessageState(
  id: number,
  stateVal: Message["state"],
): Promise<void> {
  const { os, tx } = await store("messages", "readwrite");
  const rows = await collect<MessageRow>(os.index("id"), IDBKeyRange.only(id));
  for (const r of rows) os.put({ ...r, state: stateVal });
  await txDone(tx);
}

// Deletes every message of one conversation. Nodes/telemetry untouched.
export async function deleteConvoMessages(convo: string): Promise<number> {
  const { os, tx } = await store("messages", "readwrite");
  const n = await deleteRange(os, "convo", IDBKeyRange.only(convo));
  await txDone(tx);
  return n;
}

export async function loadMessages(limit = 2000): Promise<Message[]> {
  const { os } = await store("messages");
  // newest `limit` rows, then chronological like the SQL double-order did
  const rows = await collect<MessageRow>(os.index("ts"), undefined, "prev", limit);
  rows.reverse();
  return rows.map((r) => ({
    id: r.id,
    convo: r.convo,
    from: r.from,
    to: r.to,
    channel: r.channel,
    text: r.text,
    ts: r.ts,
    mine: r.mine === 1,
    state: r.state as Message["state"],
    replyId: r.replyId ?? undefined,
  }));
}

// ── nodes ───────────────────────────────────────────────────────────────────

// We persist what's stable about a node (identity + last known position).
// snr/battery are volatile: they're worthless after reopening.
export async function saveNode(n: NodeEntry): Promise<void> {
  const { os, tx } = await store("nodes", "readwrite");
  os.put({
    num: n.num,
    publicKey: n.publicKey ?? null,
    type: n.type ?? null,
    longName: n.longName,
    shortName: n.shortName,
    lastHeard: n.lastHeard,
    lat: n.lat ?? null,
    lon: n.lon ?? null,
    hopsAway: n.hopsAway ?? null,
    fav: n.fav ? 1 : 0,
    ignored: n.ignored ? 1 : 0,
  });
  await txDone(tx);
}

export async function deleteNodeDb(num: number): Promise<void> {
  const { os, tx } = await store("nodes", "readwrite");
  os.delete(num);
  await txDone(tx);
}

export async function loadNodes(): Promise<NodeEntry[]> {
  const { os } = await store("nodes");
  const rows = await collect<{
    num: number;
    publicKey: string | null;
    type: number | null;
    longName: string;
    shortName: string;
    lastHeard: number;
    lat: number | null;
    lon: number | null;
    hopsAway: number | null;
    fav: number;
    ignored: number;
  }>(os);
  return rows.map((r) => ({
    num: r.num,
    publicKey: r.publicKey ?? undefined,
    type: r.type ?? undefined,
    longName: r.longName,
    shortName: r.shortName,
    lastHeard: r.lastHeard,
    lat: r.lat ?? undefined,
    lon: r.lon ?? undefined,
    hopsAway: r.hopsAway ?? undefined,
    fav: !!r.fav,
    ignored: !!r.ignored,
  }));
}

// ── traceroutes ─────────────────────────────────────────────────────────────

interface TracerouteRow {
  node: number;
  ts: number;
  route: number[];
  snrTowards: number[];
  routeBack: number[];
  snrBack: number[];
}

export async function saveTraceroute(node: number, t: Traceroute): Promise<void> {
  const { os, tx } = await store("traceroutes", "readwrite");
  os.put({
    node,
    ts: t.ts,
    route: t.route,
    snrTowards: t.snrTowards,
    routeBack: t.routeBack,
    snrBack: t.snrBack,
  } satisfies TracerouteRow);
  await txDone(tx);
}

export async function loadTraceroutes(node: number, limit = 20): Promise<Traceroute[]> {
  const { os } = await store("traceroutes");
  const rows = await collect<TracerouteRow>(
    os,
    IDBKeyRange.bound([node, -Infinity], [node, Infinity]),
    "prev",
    limit,
  );
  return rows.map((r) => ({
    ts: r.ts,
    route: r.route,
    snrTowards: r.snrTowards,
    routeBack: r.routeBack,
    snrBack: r.snrBack,
  }));
}

/** Recent traceroutes from every node, to draw the graph. */
export async function loadAllTraceroutes(
  limit = 200,
): Promise<{ node: number; ts: number; route: number[]; snr: number[] }[]> {
  const { os } = await store("traceroutes");
  const rows = await collect<TracerouteRow>(os.index("ts"), undefined, "prev", limit);
  return rows.map((r) => ({
    node: r.node,
    ts: r.ts,
    route: r.route,
    snr: r.snrTowards,
  }));
}

// ── neighbors ───────────────────────────────────────────────────────────────

/** Direct links seen by/through a node. The whole set is replaced: each
 *  update is the complete picture of its neighbors. */
export async function saveNeighbors(
  node: number,
  neighbors: { num: number; snr: number }[],
  ts: number,
): Promise<void> {
  const { os, tx } = await store("neighbors", "readwrite");
  await deleteRange(os, "node", IDBKeyRange.only(node));
  for (const n of neighbors) {
    os.put({ node, neighbor: n.num, snr: n.snr, ts });
  }
  await txDone(tx);
}

/** Neighbors seen in the last N days. A link nobody refreshes stops existing
 *  in the mesh; without this cutoff the graph would pile up ghost edges even
 *  if the database is never purged. */
export async function loadNeighbors(
  maxAgeDays = 7,
): Promise<{ node: number; neighbor: number; snr: number; ts: number }[]> {
  const { os } = await store("neighbors");
  return collect(
    os.index("ts"),
    IDBKeyRange.lowerBound(Date.now() - maxAgeDays * 86_400_000),
  );
}

// ── hops ────────────────────────────────────────────────────────────────────

/** Only distance changes are stored, not the value in every packet: what
 *  matters is when the route grew or shrank, and this keeps the table tiny
 *  even though the mesh transmits non-stop. */
export async function saveHopChange(
  node: number,
  hops: number,
  antes: number | undefined,
  ts = Date.now(),
): Promise<void> {
  const { os, tx } = await store("hops", "readwrite");
  os.put({ node, ts, hops, antes: antes ?? null });
  await txDone(tx);
}

export async function loadHopChanges(
  node: number,
  limit = 10,
): Promise<{ ts: number; hops: number; antes?: number }[]> {
  const { os } = await store("hops");
  const rows = await collect<{ ts: number; hops: number; antes: number | null }>(
    os,
    IDBKeyRange.bound([node, -Infinity], [node, Infinity]),
    "prev",
    limit,
  );
  return rows.map((r) => ({ ts: r.ts, hops: r.hops, antes: r.antes ?? undefined }));
}

// ── sightings ───────────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;

/** Marks that a node was heard during the current hour. A counter per node
 *  and hour instead of a row per packet: the mesh transmits non-stop and
 *  second-level detail isn't needed to know who was alive and when. */
export async function markHeard(node: number, ts = Date.now()): Promise<void> {
  const { os, tx } = await store("sightings", "readwrite");
  const hourBucket = Math.floor(ts / HOUR_MS);
  const prev = await reqAsPromise(os.get([node, hourBucket])) as
    | { node: number; hourBucket: number; n: number }
    | undefined;
  os.put({ node, hourBucket, n: (prev?.n ?? 0) + 1 });
  await txDone(tx);
}

/** Activity per node and hour since a given date. */
export async function loadActividad(
  sinceMs: number,
): Promise<{ node: number; hourBucket: number; n: number }[]> {
  const { os } = await store("sightings");
  return collect(
    os.index("hourBucket"),
    IDBKeyRange.lowerBound(Math.floor(sinceMs / HOUR_MS)),
  );
}

// ── waypoints ───────────────────────────────────────────────────────────────

export async function saveWaypoint(w: Waypoint): Promise<void> {
  const { os, tx } = await store("waypoints", "readwrite");
  os.put({ ...w });
  await txDone(tx);
}

export async function deleteWaypointDb(id: number): Promise<void> {
  const { os, tx } = await store("waypoints", "readwrite");
  os.delete(id);
  await txDone(tx);
}

export async function loadWaypoints(): Promise<Waypoint[]> {
  const { os, tx } = await store("waypoints", "readwrite");
  const now = Math.floor(Date.now() / 1000);
  const rows = await collect<Waypoint>(os);
  // expired ones don't come back: they're cleaned on startup
  const live: Waypoint[] = [];
  for (const w of rows) {
    if (w.expire > 0 && w.expire < now) os.delete(w.id);
    else live.push(w);
  }
  await txDone(tx);
  return live;
}

// ── stats / purge ───────────────────────────────────────────────────────────

export async function dbStats(): Promise<{
  messages: number;
  telemetry: number;
  nodes: number;
}> {
  const db = await openDb();
  const tx = db.transaction(["messages", "telemetry", "nodes"]);
  const [messages, telemetry, nodes] = await Promise.all([
    reqAsPromise(tx.objectStore("messages").count()),
    reqAsPromise(tx.objectStore("telemetry").count()),
    reqAsPromise(tx.objectStore("nodes").count()),
  ]);
  return { messages, telemetry, nodes };
}

const AUTO_PURGE_KEY = "autoPurgeDays";

/** Retention days for the purge on startup. 0 = disabled (by default:
 *  deleting data unasked is the last thing that should happen on its own). */
export function getAutoPurgeDays(): number {
  const n = Number(localStorage.getItem(AUTO_PURGE_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function setAutoPurgeDays(days: number): void {
  localStorage.setItem(AUTO_PURGE_KEY, String(days > 0 ? Math.floor(days) : 0));
}

// Deletes messages, telemetry, traceroutes and neighbors older than N days.
// Nodes are left alone: there are few of them and their identity is what makes
// the remaining history readable. Neighbors do expire: if they aren't renewed
// the link no longer exists and keeping it would draw ghost edges in the graph.
export async function purgeOlderThan(days: number): Promise<number> {
  const cut = Date.now() - days * 86_400_000;
  const db = await openDb();
  const names = ["messages", "telemetry", "traceroutes", "neighbors", "hops"];
  const tx = db.transaction([...names, "sightings"], "readwrite");
  let total = 0;
  for (const name of names) {
    total += await deleteRange(
      tx.objectStore(name),
      "ts",
      IDBKeyRange.upperBound(cut, true),
    );
  }
  // sightings stores the hour, not the ms
  total += await deleteRange(
    tx.objectStore("sightings"),
    "hourBucket",
    IDBKeyRange.upperBound(Math.floor(cut / HOUR_MS), true),
  );
  await txDone(tx);
  return total;
}

// ── telemetry ───────────────────────────────────────────────────────────────

export async function saveTelemetry(
  node: number,
  metric: string,
  value: number,
  ts: number,
): Promise<void> {
  const { os, tx } = await store("telemetry", "readwrite");
  os.put({ node, metric, value, ts });
  await txDone(tx);
}

export async function listTelemetryNodes(): Promise<number[]> {
  const { os } = await store("telemetry");
  return new Promise((resolve, reject) => {
    const out: number[] = [];
    const req = os.index("node").openKeyCursor(undefined, "nextunique");
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve(out);
      out.push(cur.key as number);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function listMetrics(node: number): Promise<string[]> {
  const { os } = await store("telemetry");
  return new Promise((resolve, reject) => {
    const out: string[] = [];
    const req = os
      .index("nm")
      .openKeyCursor(IDBKeyRange.bound([node, ""], [node, "￿"]), "nextunique");
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve(out);
      out.push((cur.key as [number, string])[1]);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function loadTelemetry(
  node: number,
  metric: string,
  sinceTs: number,
): Promise<{ ts: number; value: number }[]> {
  const { os } = await store("telemetry");
  const rows = await collect<{ node: number; metric: string; value: number; ts: number }>(
    os.index("nmt"),
    IDBKeyRange.bound([node, metric, sinceTs], [node, metric, Infinity]),
  );
  return rows.map((r) => ({ ts: r.ts, value: r.value }));
}
