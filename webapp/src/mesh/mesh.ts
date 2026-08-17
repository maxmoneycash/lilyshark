import type { NodeEntry } from "./store";

// MeshCore advert type 2 = repeater (protocol constant; store.ts ContactType).
// A literal keeps this module pure: the self-checks load it without the app.
const TYPE_REPEATER = 2;

export interface MeshSummary {
  total: number;
  activos1h: number;
  active24h: number;
  nuncaOidos: number; // lastHeard 0: they come from the contact list, we never heard them
  withPosition: number;
  repetidores: number;
  conPki: number;
  bateriaBaja: number; // <= 20 % (>100 is external power, doesn't count)
  saltos: Map<number | "?", number>; // hopsAway → number of nodes
  mudos: NodeEntry[]; // silent favorites, the quietest first
}

/** Snapshot of the mesh from the node list. Pure: the screen only paints. */
export function summarize(
  nodes: Iterable<NodeEntry>,
  now = Date.now(),
  mudoDesdeH = 24,
): MeshSummary {
  const r: MeshSummary = {
    total: 0,
    activos1h: 0,
    active24h: 0,
    nuncaOidos: 0,
    withPosition: 0,
    repetidores: 0,
    conPki: 0,
    bateriaBaja: 0,
    saltos: new Map(),
    mudos: [],
  };
  for (const n of nodes) {
    r.total++;
    if (!n.lastHeard) r.nuncaOidos++;
    else {
      const h = (now - n.lastHeard * 1000) / 3_600_000;
      if (h < 1) r.activos1h++;
      if (h < 24) r.active24h++;
      if (n.fav && h >= mudoDesdeH) r.mudos.push(n);
    }
    // (0,0) is junk GPS, the same criterion the map uses
    if (
      n.lat !== undefined &&
      n.lon !== undefined &&
      (Math.abs(n.lat) > 0.1 || Math.abs(n.lon) > 0.1)
    ) {
      r.withPosition++;
    }
    if (n.type === TYPE_REPEATER) r.repetidores++;
    if (n.publicKey) r.conPki++;
    if (n.batteryLevel !== undefined && n.batteryLevel <= 20) r.bateriaBaja++;
    const k = n.hopsAway ?? "?";
    r.saltos.set(k, (r.saltos.get(k) ?? 0) + 1);
  }
  r.mudos.sort((a, b) => a.lastHeard - b.lastHeard);
  return r;
}

export interface Edge {
  a: number;
  b: number;
  snr?: number; // dB
  src: "vecinos" | "traceroute";
}

export const edgeKey = (a: number, b: number) =>
  a < b ? `${a}-${b}` : `${b}-${a}`;

/** Mesh links: NeighborInfo (direct) + traceroutes (route segments).
 *  When a pair shows up through both, NeighborInfo wins: it measures the real link. */
export function buildEdges(
  neighbors: { node: number; neighbor: number; snr: number }[],
  traces: { node: number; route: number[]; snr: number[] }[],
  me?: number,
): Edge[] {
  const out = new Map<string, Edge>();
  for (const tr of traces) {
    // the route doesn't include the endpoints: me → hop… → destination
    const chain = [...(me !== undefined ? [me] : []), ...tr.route, tr.node];
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      if (a === b) continue;
      const k = edgeKey(a, b);
      if (out.has(k)) continue;
      const snr = tr.snr[i];
      out.set(k, {
        a,
        b,
        snr: snr !== undefined ? snr / 4 : undefined, // the firmware sends dB×4
        src: "traceroute",
      });
    }
  }
  for (const n of neighbors) {
    if (n.node === n.neighbor) continue;
    out.set(edgeKey(n.node, n.neighbor), {
      a: n.node,
      b: n.neighbor,
      snr: n.snr,
      src: "vecinos",
    });
  }
  return [...out.values()];
}
