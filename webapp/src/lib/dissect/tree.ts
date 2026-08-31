/**
 * Pure view logic for the dissection tree pane (UI-004).
 *
 * The tree itself comes from dissectFrame; this module turns it into what a
 * UI actually renders and drives: the profile→hint mapping that picks the
 * dissector, a flattening of the tree into visible rows (stable paths,
 * depth, expanded state) for rendering and roving keyboard navigation, the
 * WAI-ARIA tree keyboard transitions, and the byte→row lookup that lets a
 * hex-dump hover light up the deepest node covering that byte.
 *
 * Everything here is pure so it can be covered by node:test without a DOM.
 */

import type { ProtocolHint } from "./registry";
import type { DissectNode } from "./types";

/**
 * Protocol hint for a frame's capture profile ID — the same builtin table
 * protocolLabel in lib/export/rows.ts mirrors (src/core/builtin_profiles.cpp:
 * IDs 1–5 are the shipped profiles, anything else user-defined). Pass null
 * for a frame that never reported its profile; the dissector then never
 * guesses, matching the firmware's unknown fallback.
 */
export function profileProtocolHint(profileId: number | null): ProtocolHint {
	if (profileId === null) return "unknown";
	switch (profileId) {
		case 0:
			return "unknown";
		case 1:
			return "meshtastic";
		case 2:
		case 3:
			return "meshcore";
		case 4:
		case 5:
			return "reticulum";
		default:
			return "custom";
	}
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
