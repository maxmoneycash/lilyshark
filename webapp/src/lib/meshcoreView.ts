/**
 * Reading MeshCore frames off a capture and aggregating network health,
 * repeater topology, and node directory (UI-022).
 *
 * Derives:
 * 1. Discovered node directory from signed ADVERT frames: node ID, role
 *    (Chat, Repeater, Room, Sensor), public key, coordinates, geohash,
 *    and broadcast cadence.
 * 2. Network health metrics: infrastructure vs client ratio, hop count
 *    distribution (direct vs 1-hop vs multi-hop), route type mix, and
 *    channel activity.
 * 3. Repeater hop utilization and directed traversal topology graph
 *    with Mermaid diagram export.
 *
 * Derived exclusively from cleartext headers, path bytes, and signed ADVERT
 * payloads in dissect/meshcore.ts. No crypto keys held, no payload decryption
 * claimed.
 *
 * Pure arithmetic over plain data, so it runs under node:test with no DOM
 * (meshcoreView.test.ts).
 */

import {
	MESHCORE_PAYLOAD_TYPE,
	MESHCORE_ROUTE,
	dissectMeshCore,
} from "./dissect/meshcore";
import { encodeGeohash } from "./geohash";
import { profileProtocol } from "./profileProtocol";
import { frameTimeS } from "./trafficView";

/** The slice of an LscapFrame required for MeshCore health reading. */
export interface MeshCoreSourceFrame {
	timestampUs: bigint;
	bytes: Uint8Array;
	truncated: boolean;
	profileId: number | null;
	airtimeUs: number | null;
	rssiDbm?: number | null;
	snrDb?: number | null;
}

/** One discovered MeshCore node from advertisement frames. */
export interface MeshCoreDiscoveredNode {
	nodeIdHex: string;
	publicKeyHex: string;
	name: string | null;
	nodeType: number;
	nodeTypeLabel: string;
	isInfrastructure: boolean;
	hasLocation: boolean;
	latitude: number | null;
	longitude: number | null;
	geohash: string | null;
	featureOne: number | null;
	featureTwo: number | null;
	advertCount: number;
	firstSeenS: number;
	lastSeenS: number;
	meanIntervalS: number | null;
	directHearCount: number;
	relayedHearCount: number;
	minHops: number;
	maxHops: number;
	lastHops: number;
	lastPathHopHashes: string[];
	frameIndices: number[];
}

/** Relay hop hash utilization across observed routed frames. */
export interface MeshCoreRepeaterHop {
	hopHashHex: string;
	count: number;
	matchedNodeIdHex: string | null;
	matchedNodeName: string | null;
}

/** Directed edge in the repeater traversal topology. */
export interface MeshCoreTopologyEdge {
	fromKey: string;
	toKey: string;
	fromLabel: string;
	toLabel: string;
	count: number;
}

/** Network health and repeater topology overview for a capture. */
export interface MeshCoreOverview {
	meshcoreFrameCount: number;
	totalCaptureFrames: number;
	advertCount: number;
	nodes: MeshCoreDiscoveredNode[];
	roleCounts: {
		repeater: number;
		room: number;
		sensor: number;
		chat: number;
		other: number;
	};
	infrastructureCount: number;
	clientCount: number;
	hopDistribution: Record<number, number>;
	meanHops: number;
	maxObservedHops: number;
	directFramePercent: number;
	routeTypeCounts: {
		flood: number;
		direct: number;
		transportFlood: number;
		transportDirect: number;
	};
	payloadTypeCounts: Record<string, number>;
	channelActivity: { channelHash: number; count: number }[];
	repeaterHopUtilization: MeshCoreRepeaterHop[];
	topologyEdges: MeshCoreTopologyEdge[];
	topologyMermaid: string;
	firstSeenS: number;
	lastSeenS: number;
}

const ROUTE_TYPE_NAMES: Record<
	number,
	"transportFlood" | "flood" | "direct" | "transportDirect"
> = {
	[MESHCORE_ROUTE.transportFlood]: "transportFlood",
	[MESHCORE_ROUTE.flood]: "flood",
	[MESHCORE_ROUTE.direct]: "direct",
	[MESHCORE_ROUTE.transportDirect]: "transportDirect",
};

const PAYLOAD_TYPE_LABELS: Record<number, string> = {
	[MESHCORE_PAYLOAD_TYPE.request]: "REQUEST",
	[MESHCORE_PAYLOAD_TYPE.response]: "RESPONSE",
	[MESHCORE_PAYLOAD_TYPE.textMessage]: "TEXT MESSAGE",
	[MESHCORE_PAYLOAD_TYPE.acknowledgement]: "ACKNOWLEDGEMENT",
	[MESHCORE_PAYLOAD_TYPE.advertisement]: "ADVERTISEMENT",
	[MESHCORE_PAYLOAD_TYPE.groupText]: "GROUP TEXT",
	[MESHCORE_PAYLOAD_TYPE.groupData]: "GROUP DATA",
	[MESHCORE_PAYLOAD_TYPE.anonymousRequest]: "ANONYMOUS REQUEST",
	[MESHCORE_PAYLOAD_TYPE.returnedPath]: "RETURNED PATH",
	[MESHCORE_PAYLOAD_TYPE.trace]: "TRACE",
	[MESHCORE_PAYLOAD_TYPE.multipart]: "MULTIPART",
	[MESHCORE_PAYLOAD_TYPE.control]: "CONTROL",
	[MESHCORE_PAYLOAD_TYPE.rawCustom]: "RAW CUSTOM",
};

/** Empty overview when no MeshCore frames exist. */
export const EMPTY_MESHCORE_OVERVIEW: MeshCoreOverview = {
	meshcoreFrameCount: 0,
	totalCaptureFrames: 0,
	advertCount: 0,
	nodes: [],
	roleCounts: { repeater: 0, room: 0, sensor: 0, chat: 0, other: 0 },
	infrastructureCount: 0,
	clientCount: 0,
	hopDistribution: {},
	meanHops: 0,
	maxObservedHops: 0,
	directFramePercent: 0,
	routeTypeCounts: {
		flood: 0,
		direct: 0,
		transportFlood: 0,
		transportDirect: 0,
	},
	payloadTypeCounts: {},
	channelActivity: [],
	repeaterHopUtilization: [],
	topologyEdges: [],
	topologyMermaid: 'flowchart TD\n  empty["No MeshCore traffic in capture"]',
	firstSeenS: 0,
	lastSeenS: 0,
};

function sanitizeMermaidText(str: string): string {
	return str.replace(/["\\]/g, "").trim();
}

/**
 * Builds a Mermaid flowchart representing observed MeshCore node
 * and repeater topology.
 */
export function buildMeshCoreTopologyMermaid(
	nodes: readonly MeshCoreDiscoveredNode[],
	edges: readonly MeshCoreTopologyEdge[],
): string {
	if (nodes.length === 0 && edges.length === 0) {
		return 'flowchart TD\n  empty["No MeshCore nodes or routed paths observed"]';
	}

	const lines: string[] = ["flowchart TD"];

	// Group infrastructure vs client nodes
	const infraNodes = nodes.filter((n) => n.isInfrastructure);
	const clientNodes = nodes.filter((n) => !n.isInfrastructure);

	if (infraNodes.length > 0) {
		lines.push(
			'  subgraph Infrastructure["Infrastructure (Repeaters & Rooms)"]',
		);
		for (const n of infraNodes) {
			const label = sanitizeMermaidText(
				n.name
					? `${n.name} (${n.nodeTypeLabel})`
					: `${n.nodeIdHex} (${n.nodeTypeLabel})`,
			);
			lines.push(`    node_${n.nodeIdHex}[\"${label}\"]`);
		}
		lines.push("  end");
	}

	if (clientNodes.length > 0) {
		lines.push('  subgraph Clients["Clients & Sensors"]');
		for (const n of clientNodes) {
			const label = sanitizeMermaidText(
				n.name
					? `${n.name} (${n.nodeTypeLabel})`
					: `${n.nodeIdHex} (${n.nodeTypeLabel})`,
			);
			lines.push(`    node_${n.nodeIdHex}[\"${label}\"]`);
		}
		lines.push("  end");
	}

	// Always define the local capture receiver
	lines.push('  rx["Lilyshark (Local Receiver)"]');

	// Draw directed edges
	for (const e of edges) {
		const safeFrom =
			e.fromKey.startsWith("node_") ||
			e.fromKey === "rx" ||
			e.fromKey.startsWith("hop_")
				? e.fromKey
				: `hop_${e.fromKey}`;
		const safeTo =
			e.toKey.startsWith("node_") ||
			e.toKey === "rx" ||
			e.toKey.startsWith("hop_")
				? e.toKey
				: `hop_${e.toKey}`;

		const countBadge = e.count > 1 ? `|${e.count} pkts|` : "";
		lines.push(`  ${safeFrom} -->${countBadge} ${safeTo}`);
	}

	return lines.join("\n");
}

interface IntermediateNode {
	nodeIdHex: string;
	publicKeyHex: string;
	name: string | null;
	nodeType: number;
	nodeTypeLabel: string;
	hasLocation: boolean;
	latitude: number | null;
	longitude: number | null;
	featureOne: number | null;
	featureTwo: number | null;
	advertCount: number;
	firstSeenS: number;
	lastSeenS: number;
	timestamps: number[];
	directHearCount: number;
	relayedHearCount: number;
	minHops: number;
	maxHops: number;
	lastHops: number;
	lastPathHopHashes: string[];
	frameIndices: number[];
}

/**
 * Summarize all MeshCore traffic in a capture, aggregating node
 * identities, hop counts, and repeater topology.
 */
export function summarizeMeshCore(
	frames: readonly MeshCoreSourceFrame[],
	t0Us: bigint,
): MeshCoreOverview {
	if (frames.length === 0) {
		return EMPTY_MESHCORE_OVERVIEW;
	}

	let meshcoreFrameCount = 0;
	let advertCount = 0;
	let totalHopsSum = 0;
	let maxObservedHops = 0;
	let directFrameCount = 0;
	let firstSeenS = Number.POSITIVE_INFINITY;
	let lastSeenS = 0;

	const routeTypeCounts = {
		flood: 0,
		direct: 0,
		transportFlood: 0,
		transportDirect: 0,
	};
	const payloadTypeCounts: Record<string, number> = {};
	const hopDistribution: Record<number, number> = {};
	const channelActivityMap = new Map<number, number>();
	const hopHashCountMap = new Map<string, number>();
	const nodeMap = new Map<string, IntermediateNode>();
	const edgeMap = new Map<string, MeshCoreTopologyEdge>();

	for (let i = 0; i < frames.length; i++) {
		const frame = frames[i];
		const proto = profileProtocol(frame.profileId);
		if (proto !== "meshcore") {
			// Profile is not MeshCore; ignore
			continue;
		}

		const dissection = dissectMeshCore(frame.bytes, {
			truncated: frame.truncated,
		});
		if (dissection.result !== "matched" || !dissection.fields) {
			continue;
		}

		meshcoreFrameCount++;
		const timeS = frameTimeS(frame, t0Us);
		if (timeS < firstSeenS) firstSeenS = timeS;
		if (timeS > lastSeenS) lastSeenS = timeS;

		const f = dissection.fields;

		// Route type
		const routeKey = ROUTE_TYPE_NAMES[f.routeType];
		if (routeKey) {
			routeTypeCounts[routeKey]++;
		}

		// Payload type
		const payloadLabel =
			PAYLOAD_TYPE_LABELS[f.payloadType] ?? `TYPE_${f.payloadType}`;
		payloadTypeCounts[payloadLabel] =
			(payloadTypeCounts[payloadLabel] ?? 0) + 1;

		// Channel activity
		if (f.channelHash !== null) {
			channelActivityMap.set(
				f.channelHash,
				(channelActivityMap.get(f.channelHash) ?? 0) + 1,
			);
		}

		// Hops
		const hops = f.pathHashCount ?? 0;
		hopDistribution[hops] = (hopDistribution[hops] ?? 0) + 1;
		totalHopsSum += hops;
		if (hops > maxObservedHops) maxObservedHops = hops;
		if (hops === 0) directFrameCount++;

		const hopHashes = f.pathHopHashes ?? [];
		for (const h of hopHashes) {
			const norm = h.toLowerCase();
			hopHashCountMap.set(norm, (hopHashCountMap.get(norm) ?? 0) + 1);
		}

		// Link edges between consecutive hops in path
		for (let hIdx = 0; hIdx < hopHashes.length - 1; hIdx++) {
			const fromH = `hop_${hopHashes[hIdx].toLowerCase()}`;
			const toH = `hop_${hopHashes[hIdx + 1].toLowerCase()}`;
			const key = `${fromH}->${toH}`;
			const existing = edgeMap.get(key);
			if (existing) {
				existing.count++;
			} else {
				edgeMap.set(key, {
					fromKey: fromH,
					toKey: toH,
					fromLabel: `0x${hopHashes[hIdx]}`,
					toLabel: `0x${hopHashes[hIdx + 1]}`,
					count: 1,
				});
			}
		}

		// Connect last hop in path to local receiver
		if (hopHashes.length > 0) {
			const lastH = `hop_${hopHashes[hopHashes.length - 1].toLowerCase()}`;
			const toKey = "rx";
			const key = `${lastH}->${toKey}`;
			const existing = edgeMap.get(key);
			if (existing) {
				existing.count++;
			} else {
				edgeMap.set(key, {
					fromKey: lastH,
					toKey,
					fromLabel: `0x${hopHashes[hopHashes.length - 1]}`,
					toLabel: "Lilyshark RX",
					count: 1,
				});
			}
		}

		// Advertisement dissection
		if (
			f.payloadType === MESHCORE_PAYLOAD_TYPE.advertisement &&
			f.advertisement
		) {
			advertCount++;
			const ad = f.advertisement;
			const nodeId = ad.nodeIdHex.toLowerCase();
			const existingNode = nodeMap.get(nodeId);

			if (existingNode) {
				existingNode.advertCount++;
				if (timeS < existingNode.firstSeenS) existingNode.firstSeenS = timeS;
				if (timeS > existingNode.lastSeenS) existingNode.lastSeenS = timeS;
				existingNode.timestamps.push(timeS);
				if (hops === 0) existingNode.directHearCount++;
				else existingNode.relayedHearCount++;
				existingNode.minHops = Math.min(existingNode.minHops, hops);
				existingNode.maxHops = Math.max(existingNode.maxHops, hops);
				existingNode.lastHops = hops;
				existingNode.lastPathHopHashes = hopHashes;
				existingNode.frameIndices.push(i);

				// Upgrade metadata if newer advert contains name/location
				if (!existingNode.name && ad.name) existingNode.name = ad.name;
				if (!existingNode.hasLocation && ad.hasLocation) {
					existingNode.hasLocation = true;
					existingNode.latitude = ad.latitude ?? null;
					existingNode.longitude = ad.longitude ?? null;
				}
			} else {
				nodeMap.set(nodeId, {
					nodeIdHex: nodeId,
					publicKeyHex: ad.publicKeyHex,
					name: ad.name ?? null,
					nodeType: ad.nodeType,
					nodeTypeLabel: ad.nodeTypeLabel,
					hasLocation: ad.hasLocation,
					latitude: ad.latitude ?? null,
					longitude: ad.longitude ?? null,
					featureOne: ad.featureOne ?? null,
					featureTwo: ad.featureTwo ?? null,
					advertCount: 1,
					firstSeenS: timeS,
					lastSeenS: timeS,
					timestamps: [timeS],
					directHearCount: hops === 0 ? 1 : 0,
					relayedHearCount: hops > 0 ? 1 : 0,
					minHops: hops,
					maxHops: hops,
					lastHops: hops,
					lastPathHopHashes: hopHashes,
					frameIndices: [i],
				});
			}

			// Add topology edge from advertising node
			const nodeKey = `node_${nodeId}`;
			if (hopHashes.length > 0) {
				const firstHopKey = `hop_${hopHashes[0].toLowerCase()}`;
				const edgeKey = `${nodeKey}->${firstHopKey}`;
				const existing = edgeMap.get(edgeKey);
				if (existing) {
					existing.count++;
				} else {
					edgeMap.set(edgeKey, {
						fromKey: nodeKey,
						toKey: firstHopKey,
						fromLabel: ad.name ?? nodeId,
						toLabel: `0x${hopHashes[0]}`,
						count: 1,
					});
				}
			} else {
				// Direct hear from node to local receiver
				const edgeKey = `${nodeKey}->rx`;
				const existing = edgeMap.get(edgeKey);
				if (existing) {
					existing.count++;
				} else {
					edgeMap.set(edgeKey, {
						fromKey: nodeKey,
						toKey: "rx",
						fromLabel: ad.name ?? nodeId,
						toLabel: "Lilyshark RX",
						count: 1,
					});
				}
			}
		}
	}

	if (meshcoreFrameCount === 0) {
		return {
			...EMPTY_MESHCORE_OVERVIEW,
			totalCaptureFrames: frames.length,
		};
	}

	// Post-process discovered nodes
	const roleCounts = { repeater: 0, room: 0, sensor: 0, chat: 0, other: 0 };
	const nodes: MeshCoreDiscoveredNode[] = [];

	for (const n of nodeMap.values()) {
		let meanIntervalS: number | null = null;
		if (n.timestamps.length >= 2) {
			meanIntervalS = (n.lastSeenS - n.firstSeenS) / (n.timestamps.length - 1);
		}

		let geohash: string | null = null;
		if (n.hasLocation && n.latitude !== null && n.longitude !== null) {
			try {
				geohash = encodeGeohash(n.latitude, n.longitude, 6);
			} catch {
				geohash = null;
			}
		}

		const isInfrastructure = n.nodeType === 2 || n.nodeType === 3;
		if (n.nodeType === 2) roleCounts.repeater++;
		else if (n.nodeType === 3) roleCounts.room++;
		else if (n.nodeType === 4) roleCounts.sensor++;
		else if (n.nodeType === 1) roleCounts.chat++;
		else roleCounts.other++;

		nodes.push({
			nodeIdHex: n.nodeIdHex,
			publicKeyHex: n.publicKeyHex,
			name: n.name,
			nodeType: n.nodeType,
			nodeTypeLabel: n.nodeTypeLabel,
			isInfrastructure,
			hasLocation: n.hasLocation,
			latitude: n.latitude,
			longitude: n.longitude,
			geohash,
			featureOne: n.featureOne,
			featureTwo: n.featureTwo,
			advertCount: n.advertCount,
			firstSeenS: n.firstSeenS,
			lastSeenS: n.lastSeenS,
			meanIntervalS,
			directHearCount: n.directHearCount,
			relayedHearCount: n.relayedHearCount,
			minHops: n.minHops,
			maxHops: n.maxHops,
			lastHops: n.lastHops,
			lastPathHopHashes: n.lastPathHopHashes,
			frameIndices: n.frameIndices,
		});
	}

	// Sort nodes: infrastructure first (Repeaters then Rooms), then Sensors, then Chat; then by advertCount desc
	nodes.sort((a, b) => {
		if (a.isInfrastructure !== b.isInfrastructure) {
			return a.isInfrastructure ? -1 : 1;
		}
		if (a.nodeType !== b.nodeType) {
			return b.nodeType - a.nodeType;
		}
		if (b.advertCount !== a.advertCount) {
			return b.advertCount - a.advertCount;
		}
		return a.nodeIdHex.localeCompare(b.nodeIdHex);
	});

	// Repeater hop utilization: map known nodes to hop hashes where possible
	const repeaterHopUtilization: MeshCoreRepeaterHop[] = [];
	for (const [hopHex, count] of hopHashCountMap.entries()) {
		// Try to match hop hash against discovered nodes
		// MeshCore hop hashes are 1, 2, or 3 bytes (2, 4, 6 hex chars)
		const matched = nodes.find(
			(node) =>
				node.nodeIdHex.startsWith(hopHex) ||
				node.nodeIdHex.endsWith(hopHex) ||
				node.publicKeyHex.startsWith(hopHex),
		);

		repeaterHopUtilization.push({
			hopHashHex: hopHex,
			count,
			matchedNodeIdHex: matched ? matched.nodeIdHex : null,
			matchedNodeName: matched ? matched.name : null,
		});
	}
	repeaterHopUtilization.sort((a, b) => b.count - a.count);

	// Channel activity sorted by count desc
	const channelActivity = Array.from(channelActivityMap.entries())
		.map(([channelHash, count]) => ({ channelHash, count }))
		.sort((a, b) => b.count - a.count);

	const topologyEdges = Array.from(edgeMap.values()).sort(
		(a, b) => b.count - a.count,
	);
	const topologyMermaid = buildMeshCoreTopologyMermaid(nodes, topologyEdges);

	const meanHops =
		meshcoreFrameCount > 0 ? totalHopsSum / meshcoreFrameCount : 0;
	const directFramePercent =
		meshcoreFrameCount > 0 ? (directFrameCount / meshcoreFrameCount) * 100 : 0;

	return {
		meshcoreFrameCount,
		totalCaptureFrames: frames.length,
		advertCount,
		nodes,
		roleCounts,
		infrastructureCount: roleCounts.repeater + roleCounts.room,
		clientCount: roleCounts.chat + roleCounts.sensor + roleCounts.other,
		hopDistribution,
		meanHops,
		maxObservedHops,
		directFramePercent,
		routeTypeCounts,
		payloadTypeCounts,
		channelActivity,
		repeaterHopUtilization,
		topologyEdges,
		topologyMermaid,
		firstSeenS: Number.isFinite(firstSeenS) ? firstSeenS : 0,
		lastSeenS,
	};
}
