/**
 * Pure view logic for the dissection tree pane (UI-004).
 *
 * The tree itself comes from dissectFrame; this module turns it into what a
 * UI actually renders and drives: the profile→hint mapping that picks the
 * dissector, a flattening of the tree into visible rows (stable paths,
 * depth, expanded state) for rendering and roving keyboard navigation, the
 * WAI-ARIA tree keyboard transitions, and the byte→row lookup that lets a
 * hex-dump hover light up the deepest node covering that byte. The labelling
 * helpers at the end are the words the pane puts on a row and on its caption.
 *
 * Everything here is pure so it can be covered by node:test without a DOM.
 */

import { profileProtocol } from "../profileProtocol";
import type { ProtocolHint } from "./registry";
import type { Dissection, DissectNode } from "./types";

/**
 * Protocol hint for a frame's capture profile ID. The table itself lives in
 * lib/profileProtocol.ts, which names src/core/builtin_profiles.cpp as its
 * authority; this is only the dissector's name for the same answer. It used
 * to be a second copy of that table, and the copy said profile 4 was
 * Reticulum long after the firmware had made it MESHTASTIC BAY MF — a wrong
 * fact with its own passing test. Pass null for a frame that never reported
 * a profile; the dissector then never guesses, matching the firmware's
 * unknown fallback.
 */
export function profileProtocolHint(profileId: number | null): ProtocolHint {
	return profileProtocol(profileId);
}

/**
 * Protocol hint for a live frame off the device link, which reports both a
 * capture profile and the protocol name its own decoder settled on
 * (protocolName in include/lilyshark/core/protocol.h).
 *
 * The profile is the firmware's own answer and wins whenever it named one.
 * Profile 0 is the firmware's unknown profile, and is also what an older
 * link's missing field parses as; there the protocol name is the only answer
 * the device gave, and repeating it is not a guess about the bytes — the
 * device's decoder was profile-gated too. A name nothing recognises still
 * falls through to "unknown", so an unidentified frame is never decoded on
 * spec.
 */
export function frameProtocolHint(
	profileId: number | null,
	protocolName: string,
): ProtocolHint {
	if (profileId !== null && profileId !== 0) {
		return profileProtocolHint(profileId);
	}
	switch (protocolName.trim().toLowerCase()) {
		case "meshtastic":
			return "meshtastic";
		case "meshcore":
			return "meshcore";
		case "reticulum":
			return "reticulum";
		case "custom":
			return "custom";
		default:
			return "unknown";
	}
}

/**
 * A node's byte range the way a reader counts it: first and last byte
 * inclusive. A zero-length node is a marker rather than a range — the
 * truncation notice sits at the end of the frame and covers no byte at all —
 * so it reads as a position instead.
 */
export function byteRangeLabel(node: DissectNode): string {
	if (node.byteLength === 0) return `@${node.byteOffset}`;
	if (node.byteLength === 1) return String(node.byteOffset);
	return `${node.byteOffset}–${node.byteOffset + node.byteLength - 1}`;
}

/**
 * How far the decode got, in words rather than in the firmware's enum names.
 * "no-match" outranks the state because a frame nothing claimed has no
 * meaningful decode state to report.
 */
export function decodeSummary(dissection: Dissection): string {
	if (dissection.result === "no-match") return "nothing decoded it";
	if (dissection.result === "malformed") {
		return "malformed — the tree says where";
	}
	return dissection.state === "payload-decoded" ? "payload read" : "header only";
}

/**
 * A row's ancestry as one line, so a caption can say where in the frame the
 * highlighted bytes sit. Walks parentPath rather than the node tree, so a row
 * whose ancestors are hidden cannot appear — but flattenTree never emits one.
 */
export function rowTrail(rows: readonly FlatTreeRow[], row: FlatTreeRow): string {
	const byPath = new Map(rows.map((r) => [r.path, r]));
	const parts: string[] = [];
	let at: FlatTreeRow | undefined = row;
	while (at) {
		parts.unshift(at.node.label);
		at = at.parentPath !== null ? byPath.get(at.parentPath) : undefined;
	}
	return parts.join(" › ");
}

/** One visible row of the flattened tree. */
export interface FlatTreeRow {
	node: DissectNode;
	/** Stable identity: child indices from the root, joined with '.'. */
	path: string;
	/** Root is depth 0. */
	depth: number;
	hasChildren: boolean;
	/** True only for a parent whose children are currently shown. */
	expanded: boolean;
	/** Path of the parent row, null for the root. */
	parentPath: string | null;
}

/**
 * Flatten the tree into the rows a UI shows, depth-first, skipping the
 * subtrees of any path in `collapsed`. Paths are index-based ("0", "0.2",
 * "0.2.1", …) so they are stable for a given dissection.
 */
export function flattenTree(
	root: DissectNode,
	collapsed: ReadonlySet<string>,
): FlatTreeRow[] {
	const rows: FlatTreeRow[] = [];
	const walk = (
		node: DissectNode,
		path: string,
		depth: number,
		parentPath: string | null,
	): void => {
		const hasChildren = node.children.length > 0;
		const expanded = hasChildren && !collapsed.has(path);
		rows.push({ node, path, depth, hasChildren, expanded, parentPath });
		if (expanded) {
			node.children.forEach((child, i) =>
				walk(child, `${path}.${i}`, depth + 1, path),
			);
		}
	};
	walk(root, "0", 0, null);
	return rows;
}

/** What a key press does to the tree: move focus, and/or toggle a branch. */
export interface TreeNavResult {
	path: string;
	toggle?: "expand" | "collapse";
}

/**
 * WAI-ARIA tree keyboard model over the flattened rows. Returns null when
 * the key is not handled or is a no-op at this position:
 * - ArrowUp/ArrowDown walk the visible rows;
 * - ArrowRight expands a collapsed parent, then steps into the first child;
 * - ArrowLeft collapses an expanded parent, otherwise jumps to the parent;
 * - Home/End jump to the first/last visible row;
 * - Enter and Space toggle the branch under focus.
 */
export function treeKeyNav(
	rows: FlatTreeRow[],
	path: string,
	key: string,
): TreeNavResult | null {
	const at = rows.findIndex((r) => r.path === path);
	if (at < 0 || rows.length === 0) return null;
	const row = rows[at];
	switch (key) {
		case "ArrowDown":
			return at + 1 < rows.length ? { path: rows[at + 1].path } : null;
		case "ArrowUp":
			return at > 0 ? { path: rows[at - 1].path } : null;
		case "ArrowRight":
			if (!row.hasChildren) return null;
			if (!row.expanded) return { path, toggle: "expand" };
			return { path: `${path}.0` };
		case "ArrowLeft":
			if (row.expanded) return { path, toggle: "collapse" };
			return row.parentPath !== null ? { path: row.parentPath } : null;
		case "Home":
			return at > 0 ? { path: rows[0].path } : null;
		case "End":
			return at + 1 < rows.length ? { path: rows[rows.length - 1].path } : null;
		case "Enter":
		case " ":
			if (!row.hasChildren) return null;
			return { path, toggle: row.expanded ? "collapse" : "expand" };
		default:
			return null;
	}
}

/**
 * The deepest visible row whose byte range covers `byteIndex` — what a hex
 * hover should light up. Zero-length nodes never cover anything; among
 * sibling rows with identical ranges (packed bit-fields) the first at the
 * greatest depth wins.
 */
export function deepestRowAt(
	rows: FlatTreeRow[],
	byteIndex: number,
): FlatTreeRow | null {
	let best: FlatTreeRow | null = null;
	for (const row of rows) {
		const { byteOffset, byteLength } = row.node;
		if (byteLength <= 0) continue;
		if (byteIndex < byteOffset || byteIndex >= byteOffset + byteLength)
			continue;
		if (best === null || row.depth > best.depth) best = row;
	}
	return best;
}
