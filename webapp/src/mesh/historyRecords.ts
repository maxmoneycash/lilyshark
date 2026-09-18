import type { Message, NodeEntry, Waypoint } from './store';
import { mergeNodeUpdate } from './nodeUpdates';

/** IndexedDB records retain the evidence behind a label, including older rows
 * whose optional evidence fields are absent. No database migration is needed. */
export interface MessageRow {
  id: number;
  convo: string;
  from: number;
  to: number;
  channel: number;
  text: string;
  ts: number;
  mine: 0 | 1;
  state: Message['state'];
  replyId: number | null;
  failureReason?: string;
  awaitingEcho?: boolean;
  hops?: number;
  snr?: number;
  rssi?: number;
}

export function messageToRow(m: Message): MessageRow {
  return {
    id: m.id, convo: m.convo, from: m.from, to: m.to, channel: m.channel,
    text: m.text, ts: m.ts, mine: m.mine ? 1 : 0, state: m.state,
    replyId: m.replyId ?? null, failureReason: m.failureReason,
    awaitingEcho: m.awaitingEcho, hops: m.hops, snr: m.snr, rssi: m.rssi,
  };
}

export function messageFromRow(r: MessageRow): Message {
  const interrupted = r.mine === 1 && r.state === 'queued';
  return {
    ...r, mine: r.mine === 1, replyId: r.replyId ?? undefined,
    state: interrupted ? 'failed' : r.state,
    failureReason: interrupted
      ? 'Delivery unknown: this browser session ended before the radio confirmed the send. Check the conversation before retrying.'
      : r.failureReason,
    awaitingEcho: undefined,
  };
}

export interface NodeRow {
  num: number;
  publicKey: string | null;
  type: number | null;
  longName: string;
  shortName: string;
  lastHeard: number;
  lastAdvert?: number;
  lat: number | null;
  lon: number | null;
  hopsAway: number | null;
  outPath?: number[];
  fav: number;
  ignored: number;
  viaNet?: boolean;
  viaSim?: boolean;
}

export function nodeToRow(n: NodeEntry): NodeRow {
  return {
    num: n.num, publicKey: n.publicKey ?? null, type: n.type ?? null,
    longName: n.longName, shortName: n.shortName, lastHeard: n.lastHeard,
    lastAdvert: n.lastAdvert, lat: n.lat ?? null, lon: n.lon ?? null,
    hopsAway: n.hopsAway ?? null, outPath: n.outPath,
    fav: n.fav ? 1 : 0, ignored: n.ignored ? 1 : 0,
    viaNet: n.viaNet, viaSim: n.viaSim,
  };
}

export function nodeFromRow(r: NodeRow): NodeEntry {
  return {
    ...r, publicKey: r.publicKey ?? undefined, type: r.type ?? undefined,
    lat: r.lat ?? undefined, lon: r.lon ?? undefined,
    hopsAway: r.hopsAway ?? undefined, fav: !!r.fav, ignored: !!r.ignored,
  };
}

interface History {
  messages: Message[];
  nodes: Map<number, NodeEntry>;
  waypoints: Map<number, Waypoint>;
}

/** A radio can deliver events while IndexedDB is reading. Apply saved rows
 * underneath those events so an older snapshot cannot replace live evidence. */
export function mergeLoadedHistory(saved: History, current: History): History {
  const nodes = new Map(saved.nodes);
  for (const [num, live] of current.nodes) {
    const previous = nodes.get(num);
    const fromRadio = live.viaNet === false && live.viaSim === false;
    const merged = previous ? mergeNodeUpdate(previous, live, fromRadio) : live;
    const replacesExternal = fromRadio && (previous?.viaNet || previous?.viaSim || previous?.viaDemo);
    nodes.set(num, { ...merged, lastHeard: Math.max(replacesExternal ? 0 : previous?.lastHeard ?? 0, live.lastHeard) });
  }
  const messages = new Map(saved.messages.map(message => [JSON.stringify([message.id, message.ts]), message]));
  for (const message of current.messages) messages.set(JSON.stringify([message.id, message.ts]), message);
  return {
    nodes,
    messages: [...messages.values()].sort((a, b) => a.ts - b.ts),
    waypoints: new Map([...saved.waypoints, ...current.waypoints]),
  };
}
