/**
 * Directed node-to-transport transition graph for Reticulum destination announces (UI-020).
 *
 * Derives topology shifts across consecutive announces for a destination:
 * when a destination moves from a direct link to an intermediary transport
 * (or shifts between different transport instances or hop counts), this module
 * computes the transition events, directed edges, and Mermaid diagram.
 */

import type { AnnounceDestination } from "./announceView";
import { reticulumPathKey, reticulumPathLabel } from "./dissect/rnode";

/** One distinct path a destination was observed arriving on. */
export interface PathNode {
	key: string;
	label: string;
	hops: number;
	transportIdHex: string | null;
	count: number;
	firstSeenS: number;
	lastSeenS: number;
}

/** One chronological transition event where consecutive announces differed in path. */
export interface PathTransition {
	fromKey: string;
	toKey: string;
	fromLabel: string;
	toLabel: string;
	fromHops: number;
	toHops: number;
	hopsDelta: number;
	fromTransportIdHex: string | null;
	toTransportIdHex: string | null;
	atTimeS: number;
	deltaS: number;
	frameIndex: number;
}

/** An aggregated directed edge between two distinct observed paths. */
export interface PathTransitionEdge {
	fromKey: string;
	toKey: string;
	fromLabel: string;
	toLabel: string;
	count: number;
	hopsDelta: number;
	transitions: PathTransition[];
}

/** Complete transition graph for a destination's announce history. */
export interface AnnounceTransitionGraph {
	destinationHashHex: string;
	nodes: PathNode[];
	edges: PathTransitionEdge[];
	transitions: PathTransition[];
	totalTransitions: number;
	mermaid: string;
}

function sanitizeLabel(text: string): string {
	return text.replace(/["\\]/g, "");
}

/**
 * Builds the directed path transition graph from a destination's chronological
 * announce observations.
 */
export function buildTransitionGraph(
	destination: AnnounceDestination,
): AnnounceTransitionGraph {
	const nodeMap = new Map<string, PathNode>();
	for (const p of destination.paths) {
		nodeMap.set(p.key, {
			key: p.key,
			label: p.label,
			hops: p.path.hops,
			transportIdHex: p.path.transportIdHex,
			count: p.count,
			firstSeenS: p.firstSeenS,
			lastSeenS: p.lastSeenS,
		});
	}

	const sorted = [...destination.observations].sort((a, b) => a.timeS - b.timeS);
	const transitions: PathTransition[] = [];

	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		const curr = sorted[i];
		const fromKey = reticulumPathKey(prev.path);
		const toKey = reticulumPathKey(curr.path);
		if (fromKey !== toKey) {
			transitions.push({
				fromKey,
				toKey,
				fromLabel: reticulumPathLabel(prev.path),
				toLabel: reticulumPathLabel(curr.path),
				fromHops: prev.path.hops,
				toHops: curr.path.hops,
				hopsDelta: curr.path.hops - prev.path.hops,
				fromTransportIdHex: prev.path.transportIdHex,
				toTransportIdHex: curr.path.transportIdHex,
				atTimeS: curr.timeS,
				deltaS: Math.max(0, curr.timeS - prev.timeS),
				frameIndex: curr.frameIndex,
			});
		}
	}

	const edgeMap = new Map<string, PathTransitionEdge>();
	for (const t of transitions) {
		const edgeKey = `${t.fromKey}->${t.toKey}`;
		const existing = edgeMap.get(edgeKey);
		if (existing) {
			existing.count++;
			existing.transitions.push(t);
		} else {
			edgeMap.set(edgeKey, {
				fromKey: t.fromKey,
				toKey: t.toKey,
				fromLabel: t.fromLabel,
				toLabel: t.toLabel,
				count: 1,
				hopsDelta: t.hopsDelta,
				transitions: [t],
			});
		}
	}

	const nodes = [...nodeMap.values()];
	const edges = [...edgeMap.values()];

	// Generate clean Mermaid flowchart syntax
	const nodeKeyIndex = new Map<string, string>();
	nodes.forEach((n, idx) => {
		nodeKeyIndex.set(n.key, `P${idx}`);
	});

	const mermaidLines: string[] = ["flowchart TD"];
	for (const n of nodes) {
		const id = nodeKeyIndex.get(n.key) ?? "P";
		const hopsDesc = `${n.hops} hop${n.hops === 1 ? "" : "s"}`;
		const viaDesc = n.transportIdHex ? ` via ${n.transportIdHex.slice(0, 8)}…` : " (direct)";
		const title = sanitizeLabel(`${hopsDesc}${viaDesc} [${n.count}×]`);
		mermaidLines.push(`  ${id}["${title}"]`);
	}

	for (const e of edges) {
		const fromId = nodeKeyIndex.get(e.fromKey);
		const toId = nodeKeyIndex.get(e.toKey);
		if (fromId && toId) {
			const deltaPrefix = e.hopsDelta > 0 ? `+${e.hopsDelta}` : String(e.hopsDelta);
			const label = `${deltaPrefix} hops (${e.count}×)`;
			mermaidLines.push(`  ${fromId} -->|"${label}"| ${toId}`);
		}
	}

	const mermaid = mermaidLines.join("\n");

	return {
		destinationHashHex: destination.destinationHashHex,
		nodes,
		edges,
		transitions,
		totalTransitions: transitions.length,
		mermaid,
	};
}
