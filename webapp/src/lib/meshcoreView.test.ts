import assert from "node:assert/strict";
import test from "node:test";
import {
	buildMeshCoreTopologyMermaid,
	EMPTY_MESHCORE_OVERVIEW,
	type MeshCoreSourceFrame,
	summarizeMeshCore,
} from "./meshcoreView";

function makeAdvertFrame(opts: {
	timestampUs: bigint;
	profileId?: number;
	nodeId: number; // 4-byte LE
	pubKeyByte?: number;
	nodeType?: number; // 1: Chat, 2: Repeater, 3: Room, 4: Sensor
	name?: string;
	lat?: number;
	lon?: number;
	hops?: number;
	hopHashes?: number[]; // 1-byte hashes
	route?: number;
}): MeshCoreSourceFrame {
	const route = opts.route ?? 1; // Flood
	const payloadType = 4; // ADVERT
	const version = 0;
	const header = (version << 6) | (payloadType << 2) | route;

	const hops = opts.hops ?? (opts.hopHashes ? opts.hopHashes.length : 0);
	const hopHashes = opts.hopHashes ?? [];
	// path len: hash count in bits 0-5, hash size - 1 in bits 6-7.
	// size = 1 byte -> (0 << 6) | hops
	const pathLenByte = hops & 0x3f;

	const pubKey = new Uint8Array(32).fill(opts.pubKeyByte ?? 0xaa);
	pubKey[0] = opts.nodeId & 0xff;
	pubKey[1] = (opts.nodeId >>> 8) & 0xff;
	pubKey[2] = (opts.nodeId >>> 16) & 0xff;
	pubKey[3] = (opts.nodeId >>> 24) & 0xff;

	const timestampBytes = [0x00, 0x10, 0x20, 0x30];
	const sigBytes = new Uint8Array(64).fill(0xcc);

	const parts: number[] = [
		header,
		pathLenByte,
		...hopHashes,
		...pubKey,
		...timestampBytes,
		...sigBytes,
	];

	if (
		opts.nodeType !== undefined ||
		opts.name ||
		(opts.lat !== undefined && opts.lon !== undefined)
	) {
		let flags = (opts.nodeType ?? 1) & 0x0f;
		if (opts.lat !== undefined && opts.lon !== undefined) flags |= 0x10;
		if (opts.name) flags |= 0x80;

		parts.push(flags);

		if (opts.lat !== undefined && opts.lon !== undefined) {
			const latMicro = Math.round(opts.lat * 1e6);
			const lonMicro = Math.round(opts.lon * 1e6);
			parts.push(
				latMicro & 0xff,
				(latMicro >>> 8) & 0xff,
				(latMicro >>> 16) & 0xff,
				(latMicro >>> 24) & 0xff,
				lonMicro & 0xff,
				(lonMicro >>> 8) & 0xff,
				(lonMicro >>> 16) & 0xff,
				(lonMicro >>> 24) & 0xff,
			);
		}

		if (opts.name) {
			const encName = new TextEncoder().encode(opts.name);
			for (const b of encName) parts.push(b);
		}
	}

	return {
		timestampUs: opts.timestampUs,
		bytes: new Uint8Array(parts),
		truncated: false,
		profileId: opts.profileId ?? 2, // 2 = MeshCore US
		airtimeUs: 15000,
	};
}

test("empty capture returns empty overview", () => {
	const overview = summarizeMeshCore([], 0n);
	assert.deepEqual(overview, EMPTY_MESHCORE_OVERVIEW);
});

test("non-meshcore frames are ignored", () => {
	const nonMeshFrames: MeshCoreSourceFrame[] = [
		{
			timestampUs: 1000000n,
			bytes: new Uint8Array([0x01, 0x02, 0x03]),
			truncated: false,
			profileId: 1, // Meshtastic
			airtimeUs: 10000,
		},
		{
			timestampUs: 2000000n,
			bytes: new Uint8Array([0x00, 0x00, 0x10]),
			truncated: false,
			profileId: 5, // Reticulum
			airtimeUs: 10000,
		},
	];
	const overview = summarizeMeshCore(nonMeshFrames, 1000000n);
	assert.equal(overview.meshcoreFrameCount, 0);
	assert.equal(overview.totalCaptureFrames, 2);
	assert.equal(overview.nodes.length, 0);
});

test("structural MeshCore frames without adverts populate hop distributions and route mixes", () => {
	// ACK frame (payloadType = 3, route = 2 direct, 0 hops)
	const ackFrame: MeshCoreSourceFrame = {
		timestampUs: 1000000n,
		bytes: new Uint8Array([
			(0 << 6) | (3 << 2) | 2, // header: direct, ACK
			0x00, // 0 hops
			0x12,
			0x34,
			0x56,
			0x78, // checksum
		]),
		truncated: false,
		profileId: 2, // MeshCore US
		airtimeUs: 10000,
	};

	// Group text frame with 2 hops (payloadType = 5, route = 1 flood, 2 hops, 19B payload)
	const groupTextPayload = new Uint8Array(19);
	groupTextPayload[0] = 0x99; // channel hash
	groupTextPayload[1] = 0x12; // mac LE16
	groupTextPayload[2] = 0x34;

	const groupTextFrame: MeshCoreSourceFrame = {
		timestampUs: 2000000n,
		bytes: new Uint8Array([
			(0 << 6) | (5 << 2) | 1, // header: flood, groupText
			0x02, // 2 hops of 1-byte hashes
			0xaa,
			0xbb, // hop hashes
			...groupTextPayload,
		]),
		truncated: false,
		profileId: 2,
		airtimeUs: 20000,
	};

	const overview = summarizeMeshCore([ackFrame, groupTextFrame], 1000000n);
	assert.equal(overview.meshcoreFrameCount, 2);
	assert.equal(overview.advertCount, 0);
	assert.equal(overview.nodes.length, 0);

	// Route types
	assert.equal(overview.routeTypeCounts.direct, 1);
	assert.equal(overview.routeTypeCounts.flood, 1);

	// Payload types
	assert.equal(overview.payloadTypeCounts.ACKNOWLEDGEMENT, 1);
	assert.equal(overview.payloadTypeCounts["GROUP TEXT"], 1);

	// Hops
	assert.equal(overview.hopDistribution[0], 1);
	assert.equal(overview.hopDistribution[2], 1);
	assert.equal(overview.maxObservedHops, 2);
	assert.equal(overview.meanHops, 1.0);
	assert.equal(overview.directFramePercent, 50);

	// Channel activity
	assert.equal(overview.channelActivity.length, 1);
	assert.equal(overview.channelActivity[0].channelHash, 0x99);
	assert.equal(overview.channelActivity[0].count, 1);

	// Repeater hop utilization
	assert.equal(overview.repeaterHopUtilization.length, 2);
	assert.ok(overview.repeaterHopUtilization.some((h) => h.hopHashHex === "aa"));
	assert.ok(overview.repeaterHopUtilization.some((h) => h.hopHashHex === "bb"));
});

test("advertisements aggregate node identities, types, positions, and cadence", () => {
	const t0 = 10000000n; // 10s

	// Node 1: Repeater on Mt Diablo (heard twice, 60s apart)
	const repeaterAdv1 = makeAdvertFrame({
		timestampUs: t0,
		nodeId: 0x11223344,
		nodeType: 2, // Repeater
		name: "Mt Diablo Repeater",
		lat: 37.8816,
		lon: -121.9142,
		hops: 0,
	});
	const repeaterAdv2 = makeAdvertFrame({
		timestampUs: t0 + 60000000n, // +60s
		nodeId: 0x11223344,
		nodeType: 2,
		name: "Mt Diablo Repeater",
		lat: 37.8816,
		lon: -121.9142,
		hops: 0,
	});

	// Node 2: Room
	const roomAdv = makeAdvertFrame({
		timestampUs: t0 + 10000000n,
		nodeId: 0x55667788,
		nodeType: 3, // Room
		name: "East Bay Mesh Room",
		hops: 1,
		hopHashes: [0x44], // relayed via repeater 0x44 (ends with 44)
	});

	// Node 3: Chat client
	const chatAdv = makeAdvertFrame({
		timestampUs: t0 + 20000000n,
		nodeId: 0x99aabbcc,
		nodeType: 1, // Chat
		name: "Alice LilyDeck",
		lat: 37.7749,
		lon: -122.4194,
		hops: 1,
		hopHashes: [0x44],
	});

	// Node 4: Sensor
	const sensorAdv = makeAdvertFrame({
		timestampUs: t0 + 30000000n,
		nodeId: 0xaabbccdd,
		nodeType: 4, // Sensor
		name: "Weather Hill 1",
		hops: 0,
	});

	const frames = [repeaterAdv1, roomAdv, chatAdv, sensorAdv, repeaterAdv2];
	const overview = summarizeMeshCore(frames, t0);

	assert.equal(overview.meshcoreFrameCount, 5);
	assert.equal(overview.advertCount, 5);
	assert.equal(overview.nodes.length, 4);

	// Infrastructure counts
	assert.equal(overview.roleCounts.repeater, 1);
	assert.equal(overview.roleCounts.room, 1);
	assert.equal(overview.roleCounts.chat, 1);
	assert.equal(overview.roleCounts.sensor, 1);
	assert.equal(overview.infrastructureCount, 2);
	assert.equal(overview.clientCount, 2);

	// Check Repeater node details
	const repeaterNode = overview.nodes.find((n) => n.nodeIdHex === "11223344");
	assert.ok(repeaterNode);
	assert.equal(repeaterNode.name, "Mt Diablo Repeater");
	assert.equal(repeaterNode.nodeTypeLabel, "Repeater");
	assert.equal(repeaterNode.isInfrastructure, true);
	assert.equal(repeaterNode.advertCount, 2);
	assert.equal(repeaterNode.firstSeenS, 0);
	assert.equal(repeaterNode.lastSeenS, 60);
	assert.equal(repeaterNode.meanIntervalS, 60);
	assert.equal(repeaterNode.directHearCount, 2);
	assert.equal(repeaterNode.relayedHearCount, 0);
	assert.ok(repeaterNode.geohash);

	// Check Chat client details
	const chatNode = overview.nodes.find((n) => n.nodeIdHex === "99aabbcc");
	assert.ok(chatNode);
	assert.equal(chatNode.name, "Alice LilyDeck");
	assert.equal(chatNode.nodeTypeLabel, "Chat");
	assert.equal(chatNode.isInfrastructure, false);
	assert.equal(chatNode.advertCount, 1);
	assert.equal(chatNode.meanIntervalS, null); // 1 advert has no cadence
	assert.equal(chatNode.relayedHearCount, 1);
	assert.equal(chatNode.minHops, 1);

	// Check repeater hop utilization matching
	const hop44 = overview.repeaterHopUtilization.find(
		(h) => h.hopHashHex === "44",
	);
	assert.ok(hop44);
	assert.equal(hop44.count, 2); // Room + Chat
	assert.equal(hop44.matchedNodeName, "Mt Diablo Repeater"); // Matched 44 to 11223344

	// Mermaid diagram validation
	assert.ok(overview.topologyMermaid.includes("subgraph Infrastructure"));
	assert.ok(overview.topologyMermaid.includes("subgraph Clients"));
	assert.ok(overview.topologyMermaid.includes("Mt Diablo Repeater"));
	assert.ok(overview.topologyMermaid.includes("Lilyshark (Local Receiver)"));
});

test("topology builder generates valid Mermaid syntax", () => {
	const mermaid = buildMeshCoreTopologyMermaid(
		[
			{
				nodeIdHex: "11223344",
				publicKeyHex: "aa",
				name: "Summit Repeater",
				nodeType: 2,
				nodeTypeLabel: "Repeater",
				isInfrastructure: true,
				hasLocation: false,
				latitude: null,
				longitude: null,
				geohash: null,
				featureOne: null,
				featureTwo: null,
				advertCount: 1,
				firstSeenS: 0,
				lastSeenS: 0,
				meanIntervalS: null,
				directHearCount: 1,
				relayedHearCount: 0,
				minHops: 0,
				maxHops: 0,
				lastHops: 0,
				lastPathHopHashes: [],
				frameIndices: [0],
			},
		],
		[
			{
				fromKey: "node_11223344",
				toKey: "rx",
				fromLabel: "Summit Repeater",
				toLabel: "Lilyshark RX",
				count: 5,
			},
		],
	);

	assert.ok(mermaid.startsWith("flowchart TD"));
	assert.ok(mermaid.includes("Summit Repeater (Repeater)"));
	assert.ok(mermaid.includes("node_11223344 -->|5 pkts| rx"));
});
