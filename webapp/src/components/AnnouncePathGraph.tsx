import { useMemo, useState } from "react";
import {
	buildTransitionGraph,
	type AnnounceTransitionGraph,
} from "../lib/announceGraph";
import type {
	AnnounceDestination,
	AnnounceOverview,
} from "../lib/announceView";
import type { LscapFrame } from "../lib/lscap";

export interface AnnouncePathGraphProps {
	overview: AnnounceOverview;
	frames: readonly LscapFrame[];
	selectedDestHex: string | null;
	onSelectDest: (destHex: string) => void;
	onFilterDest: (destHex: string) => void;
	onSelectFrame: (frameIndex: number) => void;
	onClose: () => void;
}

export function AnnouncePathGraph({
	overview,
	frames,
	selectedDestHex,
	onSelectDest,
	onFilterDest,
	onSelectFrame,
	onClose,
}: AnnouncePathGraphProps) {
	const destinations = overview.destinations;

	// Active destination defaults to the requested one, or the first destination
	const activeDest: AnnounceDestination | null = useMemo(() => {
		if (destinations.length === 0) return null;
		if (selectedDestHex) {
			const found = destinations.find(
				(d) =>
					d.destinationHashHex.toLowerCase() === selectedDestHex.toLowerCase(),
			);
			if (found) return found;
		}
		return destinations[0];
	}, [destinations, selectedDestHex]);

	const graph: AnnounceTransitionGraph | null = useMemo(() => {
		if (!activeDest) return null;
		return buildTransitionGraph(activeDest);
	}, [activeDest]);

	const [copied, setCopied] = useState(false);

	const handleCopyMermaid = async () => {
		if (!graph) return;
		try {
			await navigator.clipboard.writeText(graph.mermaid);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Fallback if clipboard API is unavailable
		}
	};

	if (destinations.length === 0) {
		return (
			<div
				className="panel traffic-paths"
				role="region"
				aria-label="Reticulum announce path transitions"
			>
				<div className="panel-title">
					<span>RETICULUM // PATH TRANSITIONS</span>
					<span className="spacer" />
					<button
						type="button"
						onClick={onClose}
						aria-label="Close path transitions"
					>
						✕
					</button>
				</div>
				<div className="traffic-empty" style={{ padding: "24px 16px" }}>
					<h2>No Reticulum announces in this capture.</h2>
					<p className="dim">
						Path transitions track route shifts across observed announce
						packets.
					</p>
				</div>
			</div>
		);
	}

	const minHops = activeDest
		? Math.min(...activeDest.paths.map((p) => p.path.hops))
		: 0;
	const maxHops = activeDest
		? Math.max(...activeDest.paths.map((p) => p.path.hops))
		: 0;
	const hopRangeLabel =
		minHops === maxHops
			? `${minHops} hop${minHops === 1 ? "" : "s"}`
			: `${minHops} – ${maxHops} hops`;

	return (
		<div
			className="panel traffic-paths"
			role="region"
			aria-label="Reticulum announce path transitions"
		>
			<div className="panel-title">
				<span>RETICULUM // PATH TRANSITIONS</span>
				<span className="spacer" />
				<button
					type="button"
					onClick={onClose}
					aria-label="Close path transitions"
				>
					✕
				</button>
			</div>

			<div className="scroll-y" style={{ padding: "12px" }}>
				{/* Destination selector */}
				<div style={{ marginBottom: "12px" }}>
					<label
						htmlFor="rns-dest-select"
						className="k"
						style={{ display: "block", marginBottom: "4px" }}
					>
						DESTINATION ({destinations.length})
					</label>
					<select
						id="rns-dest-select"
						value={activeDest?.destinationHashHex ?? ""}
						onChange={(e) => onSelectDest(e.target.value)}
						style={{
							width: "100%",
							background: "var(--bg, #111)",
							color: "var(--fg, #eee)",
							padding: "6px 8px",
						}}
					>
						{destinations.map((d) => (
							<option key={d.destinationHashHex} value={d.destinationHashHex}>
								{d.destinationHashHex.slice(0, 12)}… ({d.count} announce
								{d.count === 1 ? "" : "s"}, {d.paths.length} path
								{d.paths.length === 1 ? "" : "s"})
							</option>
						))}
					</select>
				</div>

				{activeDest && graph && (
					<>
						{/* Quick action bar */}
						<div
							style={{
								display: "flex",
								gap: "8px",
								marginBottom: "12px",
								alignItems: "center",
							}}
						>
							<button
								type="button"
								className="primary"
								onClick={() => onFilterDest(activeDest.destinationHashHex)}
								title="Filter traffic table to frames addressing this destination"
							>
								FILTER DESTINATION
							</button>
							<button
								type="button"
								onClick={() => void handleCopyMermaid()}
								title="Copy Mermaid diagram flowchart syntax"
							>
								{copied ? "COPIED!" : "COPY MERMAID"}
							</button>
						</div>

						{/* Destination summary kv */}
						<div className="kv" style={{ marginBottom: "16px" }}>
							<span className="k">DEST HASH</span>
							<span className="v" style={{ overflowWrap: "anywhere" }}>
								{activeDest.destinationHashHex}
							</span>
							<span className="k">ANNOUNCES</span>
							<span className="v">{activeDest.count}</span>
							<span className="k">DISTINCT PATHS</span>
							<span className="v">{graph.nodes.length}</span>
							<span className="k">PATH SHIFTS</span>
							<span
								className={`v ${graph.totalTransitions > 0 ? "warn" : "ok"}`}
							>
								{graph.totalTransitions} transition
								{graph.totalTransitions === 1 ? "" : "s"}
							</span>
							<span className="k">HOP SPAN</span>
							<span className="v">{hopRangeLabel}</span>
						</div>

						{/* Directed topology edges */}
						<div style={{ marginBottom: "16px" }}>
							<div
								className="panel-title"
								style={{ padding: "4px 0", fontSize: "11px" }}
							>
								DIRECTED TRANSITION EDGES ({graph.edges.length})
							</div>
							{graph.edges.length === 0 ? (
								<div
									className="dim"
									style={{ padding: "8px 0", fontSize: "12px" }}
								>
									No path migrations. Destination stayed on a single path across
									all announces.
								</div>
							) : (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: "6px",
										marginTop: "6px",
									}}
								>
									{graph.edges.map((e, idx) => (
										<div
											key={idx}
											style={{
												padding: "6px 8px",
												background:
													"var(--panel-item-bg, rgba(255,255,255,0.04))",
												borderLeft:
													e.hopsDelta > 0
														? "3px solid var(--warn, #f39c12)"
														: e.hopsDelta < 0
															? "3px solid var(--ok, #2ecc71)"
															: "3px solid var(--dim, #888)",
												fontSize: "12px",
											}}
										>
											<div
												style={{
													display: "flex",
													justifyContent: "space-between",
													marginBottom: "2px",
												}}
											>
												<span style={{ fontWeight: "bold" }}>
													{e.fromLabel} → {e.toLabel}
												</span>
												<span className="ok">{e.count}×</span>
											</div>
											<div className="dim" style={{ fontSize: "11px" }}>
												Hop shift:{" "}
												{e.hopsDelta > 0 ? `+${e.hopsDelta}` : e.hopsDelta}{" "}
												{Math.abs(e.hopsDelta) === 1 ? "hop" : "hops"}
											</div>
										</div>
									))}
								</div>
							)}
						</div>

						{/* Chronological transition history */}
						<div style={{ marginBottom: "16px" }}>
							<div
								className="panel-title"
								style={{ padding: "4px 0", fontSize: "11px" }}
							>
								TRANSITION TIMELINE ({graph.transitions.length})
							</div>
							{graph.transitions.length === 0 ? (
								<div
									className="dim"
									style={{ padding: "8px 0", fontSize: "12px" }}
								>
									Single steady path across all {activeDest.count} announce
									frames.
								</div>
							) : (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: "6px",
										marginTop: "6px",
									}}
								>
									{graph.transitions.map((t, idx) => {
										const seq = frames[t.frameIndex]
											? Number(frames[t.frameIndex].sequence)
											: t.frameIndex;
										return (
											<div
												key={idx}
												onClick={() => onSelectFrame(t.frameIndex)}
												style={{
													padding: "6px 8px",
													cursor: "pointer",
													background:
														"var(--panel-item-bg, rgba(255,255,255,0.03))",
													fontSize: "12px",
												}}
												title={`Click to inspect frame ${seq} in capture`}
											>
												<div
													style={{
														display: "flex",
														justifyContent: "space-between",
														marginBottom: "2px",
													}}
												>
													<span style={{ color: "var(--accent, #64b5f6)" }}>
														Frame {seq}
													</span>
													<span className="dim">+{t.deltaS.toFixed(1)}s</span>
												</div>
												<div>
													{t.fromLabel} →{" "}
													<span style={{ fontWeight: "bold" }}>
														{t.toLabel}
													</span>
												</div>
												<div className="dim" style={{ fontSize: "11px" }}>
													Δhops:{" "}
													{t.hopsDelta > 0 ? `+${t.hopsDelta}` : t.hopsDelta}
												</div>
											</div>
										);
									})}
								</div>
							)}
						</div>

						{/* Mermaid flowchart */}
						<div style={{ marginBottom: "16px" }}>
							<div
								className="panel-title"
								style={{ padding: "4px 0", fontSize: "11px" }}
							>
								MERMAID TOPOLOGY FLOW
							</div>
							<pre
								style={{
									background: "var(--bg-code, #0a0a0a)",
									padding: "8px",
									borderRadius: "4px",
									fontSize: "11px",
									overflowX: "auto",
									margin: "6px 0 0 0",
								}}
							>
								{graph.mermaid}
							</pre>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
