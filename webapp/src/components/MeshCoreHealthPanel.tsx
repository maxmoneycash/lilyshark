import { useMemo, useState } from "react";
import type {
	MeshCoreDiscoveredNode,
	MeshCoreOverview,
} from "../lib/meshcoreView";

export interface MeshCoreHealthPanelProps {
	overview: MeshCoreOverview;
	selectedNodeId: string | null;
	onSelectNode: (nodeIdHex: string) => void;
	onFilterNode: (nodeIdHex: string) => void;
	onFilterHop: (hops: number) => void;
	onSelectFrame: (frameIndex: number) => void;
	onClose: () => void;
}

type PanelTab = "nodes" | "hops" | "topology";

export function MeshCoreHealthPanel({
	overview,
	selectedNodeId,
	onSelectNode,
	onFilterNode,
	onFilterHop,
	onSelectFrame,
	onClose,
}: MeshCoreHealthPanelProps) {
	const [activeTab, setActiveTab] = useState<PanelTab>("nodes");
	const [copied, setCopied] = useState(false);

	const nodes = overview.nodes;

	// Active node defaults to selected or first
	const activeNode: MeshCoreDiscoveredNode | null = useMemo(() => {
		if (nodes.length === 0) return null;
		if (selectedNodeId) {
			const found = nodes.find(
				(n) => n.nodeIdHex.toLowerCase() === selectedNodeId.toLowerCase(),
			);
			if (found) return found;
		}
		return nodes[0];
	}, [nodes, selectedNodeId]);

	const handleCopyMermaid = async () => {
		if (!overview.topologyMermaid) return;
		try {
			await navigator.clipboard.writeText(overview.topologyMermaid);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Fallback if clipboard API unavailable
		}
	};

	if (overview.meshcoreFrameCount === 0) {
		return (
			<div
				className="panel traffic-meshcore"
				role="region"
				aria-label="MeshCore network health"
			>
				<div className="panel-title">
					<span>MESHCORE // NETWORK HEALTH & TOPOLOGY</span>
					<span className="spacer" />
					<button
						type="button"
						onClick={onClose}
						aria-label="Close MeshCore health"
					>
						✕
					</button>
				</div>
				<div className="traffic-empty" style={{ padding: "24px 16px" }}>
					<h2>No MeshCore traffic in this capture.</h2>
					<p className="dim">
						Current capture profile was not set to MeshCore (US 915 MHz /
						906.875 MHz) or no valid MeshCore frames were heard by the radio.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div
			className="panel traffic-meshcore"
			role="region"
			aria-label="MeshCore network health"
		>
			<div className="panel-title">
				<span>MESHCORE // NETWORK HEALTH & TOPOLOGY</span>
				<span className="spacer" />
				<button
					type="button"
					onClick={onClose}
					aria-label="Close MeshCore health"
				>
					✕
				</button>
			</div>

			<div className="scroll-y" style={{ padding: "12px" }}>
				{/* Top metrics summary cards */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
						gap: "8px",
						marginBottom: "12px",
					}}
				>
					<div
						style={{
							background: "var(--card-bg, #161616)",
							border: "1px solid var(--border, #333)",
							padding: "8px",
						}}
					>
						<div
							className="k"
							style={{ fontSize: "11px", marginBottom: "4px" }}
						>
							INFRASTRUCTURE
						</div>
						<div
							style={{
								fontSize: "18px",
								fontWeight: "bold",
								color: "var(--ok, #4ade80)",
							}}
						>
							{overview.infrastructureCount}
						</div>
						<div className="dim" style={{ fontSize: "11px" }}>
							{overview.roleCounts.repeater} rep · {overview.roleCounts.room}{" "}
							room
						</div>
					</div>

					<div
						style={{
							background: "var(--card-bg, #161616)",
							border: "1px solid var(--border, #333)",
							padding: "8px",
						}}
					>
						<div
							className="k"
							style={{ fontSize: "11px", marginBottom: "4px" }}
						>
							CLIENTS & SENSORS
						</div>
						<div
							style={{
								fontSize: "18px",
								fontWeight: "bold",
								color: "var(--accent, #60a5fa)",
							}}
						>
							{overview.clientCount}
						</div>
						<div className="dim" style={{ fontSize: "11px" }}>
							{overview.roleCounts.chat} chat · {overview.roleCounts.sensor}{" "}
							sens
						</div>
					</div>

					<div
						style={{
							background: "var(--card-bg, #161616)",
							border: "1px solid var(--border, #333)",
							padding: "8px",
						}}
					>
						<div
							className="k"
							style={{ fontSize: "11px", marginBottom: "4px" }}
						>
							HOP HEALTH
						</div>
						<div style={{ fontSize: "18px", fontWeight: "bold" }}>
							{overview.meanHops.toFixed(1)}{" "}
							<span style={{ fontSize: "12px", fontWeight: "normal" }}>
								avg
							</span>
						</div>
						<div className="dim" style={{ fontSize: "11px" }}>
							{overview.directFramePercent.toFixed(0)}% direct · max{" "}
							{overview.maxObservedHops}h
						</div>
					</div>

					<div
						style={{
							background: "var(--card-bg, #161616)",
							border: "1px solid var(--border, #333)",
							padding: "8px",
						}}
					>
						<div
							className="k"
							style={{ fontSize: "11px", marginBottom: "4px" }}
						>
							DISCOVERED
						</div>
						<div style={{ fontSize: "18px", fontWeight: "bold" }}>
							{overview.nodes.length}{" "}
							<span style={{ fontSize: "12px", fontWeight: "normal" }}>
								nodes
							</span>
						</div>
						<div className="dim" style={{ fontSize: "11px" }}>
							{overview.advertCount} adverts · {overview.meshcoreFrameCount}{" "}
							frames
						</div>
					</div>
				</div>

				{/* Tab selector */}
				<div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
					<button
						type="button"
						className={activeTab === "nodes" ? "primary" : ""}
						onClick={() => setActiveTab("nodes")}
					>
						NODES ({overview.nodes.length})
					</button>
					<button
						type="button"
						className={activeTab === "hops" ? "primary" : ""}
						onClick={() => setActiveTab("hops")}
					>
						HOPS & ROUTES
					</button>
					<button
						type="button"
						className={activeTab === "topology" ? "primary" : ""}
						onClick={() => setActiveTab("topology")}
					>
						TOPOLOGY ({overview.topologyEdges.length})
					</button>
				</div>

				{/* Tab 1: Nodes Directory */}
				{activeTab === "nodes" && (
					<div>
						{activeNode ? (
							<div
								style={{
									border: "1px solid var(--border, #333)",
									padding: "10px",
									marginBottom: "12px",
									background: "var(--card-bg, #141414)",
								}}
							>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										marginBottom: "8px",
										flexWrap: "wrap",
										gap: "6px",
									}}
								>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "8px",
										}}
									>
										<span
											style={{
												background: activeNode.isInfrastructure
													? "rgba(34, 197, 94, 0.2)"
													: "rgba(59, 130, 246, 0.2)",
												color: activeNode.isInfrastructure
													? "#4ade80"
													: "#60a5fa",
												border: "1px solid currentColor",
												padding: "2px 6px",
												fontSize: "11px",
												fontWeight: "bold",
											}}
										>
											{activeNode.nodeTypeLabel.toUpperCase()}
										</span>
										<span style={{ fontWeight: "bold", fontSize: "14px" }}>
											{activeNode.name ?? `Node 0x${activeNode.nodeIdHex}`}
										</span>
									</div>
									<button
										type="button"
										className="primary"
										onClick={() => onFilterNode(activeNode.nodeIdHex)}
										title={`Filter traffic table to frames from ${activeNode.nodeIdHex}`}
									>
										FILTER NODE
									</button>
								</div>

								<div className="kv" style={{ margin: 0 }}>
									<span className="k">NODE ID</span>
									<span className="v">{activeNode.nodeIdHex}</span>

									<span className="k">HEARD</span>
									<span className="v">
										{activeNode.advertCount} adverts (
										{activeNode.directHearCount} direct,{" "}
										{activeNode.relayedHearCount} relayed)
									</span>

									{activeNode.meanIntervalS !== null && (
										<>
											<span className="k">CADENCE</span>
											<span className="v">
												Every {Math.round(activeNode.meanIntervalS)}s (mean
												interval)
											</span>
										</>
									)}

									{activeNode.hasLocation &&
										activeNode.latitude !== null &&
										activeNode.longitude !== null && (
											<>
												<span className="k">POSITION</span>
												<span className="v">
													{activeNode.latitude.toFixed(6)}°,{" "}
													{activeNode.longitude.toFixed(6)}°
													{activeNode.geohash &&
														` · cell ${activeNode.geohash}`}
												</span>
											</>
										)}

									<span className="k">HOPS SPAN</span>
									<span className="v">
										{activeNode.minHops === activeNode.maxHops
											? `${activeNode.minHops} hop${activeNode.minHops === 1 ? "" : "s"}`
											: `${activeNode.minHops} – ${activeNode.maxHops} hops`}
										{activeNode.lastPathHopHashes.length > 0 &&
											` (last via 0x${activeNode.lastPathHopHashes.join(" → 0x")})`}
									</span>

									<span className="k">PUBLIC KEY</span>
									<span
										className="v"
										style={{ overflowWrap: "anywhere", fontSize: "11px" }}
									>
										{activeNode.publicKeyHex}
									</span>
								</div>

								{/* Frame jump pills */}
								{activeNode.frameIndices.length > 0 && (
									<div style={{ marginTop: "8px", fontSize: "11px" }}>
										<span className="dim">Jump to frame: </span>
										{activeNode.frameIndices.slice(0, 8).map((fIdx) => (
											<button
												key={fIdx}
												type="button"
												style={{
													padding: "1px 5px",
													marginRight: "4px",
													fontSize: "10px",
												}}
												onClick={() => onSelectFrame(fIdx)}
											>
												#{fIdx + 1}
											</button>
										))}
										{activeNode.frameIndices.length > 8 && (
											<span className="dim">
												+{activeNode.frameIndices.length - 8} more
											</span>
										)}
									</div>
								)}
							</div>
						) : (
							<div className="traffic-empty" style={{ padding: "16px 0" }}>
								<p className="dim">
									No node identity advertisements heard yet in this capture.
								</p>
							</div>
						)}

						{/* Nodes table */}
						{nodes.length > 0 && (
							<div style={{ overflowX: "auto" }}>
								<table
									style={{
										width: "100%",
										borderCollapse: "collapse",
										fontSize: "12px",
									}}
								>
									<thead>
										<tr
											style={{ borderBottom: "1px solid var(--border, #333)" }}
										>
											<th style={{ textAlign: "left", padding: "6px 4px" }}>
												TYPE
											</th>
											<th style={{ textAlign: "left", padding: "6px 4px" }}>
												NAME / ID
											</th>
											<th style={{ textAlign: "right", padding: "6px 4px" }}>
												HEARD
											</th>
											<th style={{ textAlign: "right", padding: "6px 4px" }}>
												HOPS
											</th>
											<th style={{ textAlign: "right", padding: "6px 4px" }}>
												CADENCE
											</th>
											<th style={{ textAlign: "center", padding: "6px 4px" }}>
												ACTION
											</th>
										</tr>
									</thead>
									<tbody>
										{nodes.map((n) => {
											const isSelected =
												activeNode &&
												activeNode.nodeIdHex.toLowerCase() ===
													n.nodeIdHex.toLowerCase();
											return (
												<tr
													key={n.nodeIdHex}
													onClick={() => onSelectNode(n.nodeIdHex)}
													style={{
														borderBottom:
															"1px solid var(--border-subtle, #222)",
														cursor: "pointer",
														background: isSelected
															? "var(--highlight, rgba(255,255,255,0.06))"
															: "transparent",
													}}
												>
													<td style={{ padding: "6px 4px" }}>
														<span
															style={{
																fontSize: "10px",
																padding: "1px 4px",
																border: "1px solid currentColor",
																color: n.isInfrastructure
																	? "#4ade80"
																	: "#60a5fa",
															}}
														>
															{n.nodeTypeLabel.slice(0, 4).toUpperCase()}
														</span>
													</td>
													<td style={{ padding: "6px 4px" }}>
														<div
															style={{ fontWeight: n.name ? "bold" : "normal" }}
														>
															{n.name ?? n.nodeIdHex}
														</div>
														{n.name && (
															<div className="dim" style={{ fontSize: "10px" }}>
																{n.nodeIdHex}
															</div>
														)}
													</td>
													<td
														style={{ textAlign: "right", padding: "6px 4px" }}
													>
														{n.advertCount}
													</td>
													<td
														style={{ textAlign: "right", padding: "6px 4px" }}
													>
														{n.minHops === n.maxHops
															? n.minHops
															: `${n.minHops}-${n.maxHops}`}
													</td>
													<td
														style={{ textAlign: "right", padding: "6px 4px" }}
													>
														{n.meanIntervalS !== null
															? `${Math.round(n.meanIntervalS)}s`
															: "—"}
													</td>
													<td
														style={{ textAlign: "center", padding: "6px 4px" }}
													>
														<button
															type="button"
															style={{ padding: "1px 6px", fontSize: "11px" }}
															onClick={(e) => {
																e.stopPropagation();
																onFilterNode(n.nodeIdHex);
															}}
															title={`Filter to node ${n.nodeIdHex}`}
														>
															FILTER
														</button>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
					</div>
				)}

				{/* Tab 2: Hops & Routes */}
				{activeTab === "hops" && (
					<div>
						<div
							className="panel-title"
							style={{ marginTop: "4px", marginBottom: "8px" }}
						>
							HOP COUNT DISTRIBUTION
						</div>
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: "6px",
								marginBottom: "16px",
							}}
						>
							{Object.entries(overview.hopDistribution)
								.map(([hopStr, count]) => ({
									hops: Number(hopStr),
									count,
									percent:
										overview.meshcoreFrameCount > 0
											? (count / overview.meshcoreFrameCount) * 100
											: 0,
								}))
								.sort((a, b) => a.hops - b.hops)
								.map(({ hops, count, percent }) => (
									<div
										key={hops}
										style={{
											display: "flex",
											alignItems: "center",
											gap: "8px",
											fontSize: "12px",
										}}
									>
										<button
											type="button"
											onClick={() => onFilterHop(hops)}
											style={{
												width: "80px",
												textAlign: "left",
												padding: "2px 6px",
											}}
											title={`Filter traffic to frames with ${hops} hops`}
										>
											{hops === 0
												? "0 (direct)"
												: `${hops} hop${hops === 1 ? "" : "s"}`}
										</button>
										<div
											style={{
												flex: 1,
												background: "#222",
												height: "16px",
												position: "relative",
												overflow: "hidden",
											}}
										>
											<div
												style={{
													width: `${percent}%`,
													height: "100%",
													background:
														hops === 0
															? "var(--ok, #4ade80)"
															: "var(--accent, #60a5fa)",
												}}
											/>
										</div>
										<span
											style={{
												minWidth: "75px",
												textAlign: "right",
												fontSize: "11px",
											}}
										>
											{count} ({percent.toFixed(0)}%)
										</span>
									</div>
								))}
						</div>

						<div className="panel-title" style={{ marginBottom: "8px" }}>
							ROUTE TYPES
						</div>
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
								gap: "6px",
								marginBottom: "16px",
							}}
						>
							<div
								style={{
									border: "1px solid var(--border, #333)",
									padding: "6px",
								}}
							>
								<div className="k" style={{ fontSize: "10px" }}>
									FLOOD
								</div>
								<div style={{ fontSize: "16px", fontWeight: "bold" }}>
									{overview.routeTypeCounts.flood}
								</div>
							</div>
							<div
								style={{
									border: "1px solid var(--border, #333)",
									padding: "6px",
								}}
							>
								<div className="k" style={{ fontSize: "10px" }}>
									DIRECT
								</div>
								<div style={{ fontSize: "16px", fontWeight: "bold" }}>
									{overview.routeTypeCounts.direct}
								</div>
							</div>
							<div
								style={{
									border: "1px solid var(--border, #333)",
									padding: "6px",
								}}
							>
								<div className="k" style={{ fontSize: "10px" }}>
									TRANSPORT FLOOD
								</div>
								<div style={{ fontSize: "16px", fontWeight: "bold" }}>
									{overview.routeTypeCounts.transportFlood}
								</div>
							</div>
							<div
								style={{
									border: "1px solid var(--border, #333)",
									padding: "6px",
								}}
							>
								<div className="k" style={{ fontSize: "10px" }}>
									TRANSPORT DIRECT
								</div>
								<div style={{ fontSize: "16px", fontWeight: "bold" }}>
									{overview.routeTypeCounts.transportDirect}
								</div>
							</div>
						</div>

						<div className="panel-title" style={{ marginBottom: "8px" }}>
							PAYLOAD MIX
						</div>
						<div className="kv" style={{ margin: 0, marginBottom: "16px" }}>
							{Object.entries(overview.payloadTypeCounts).map(
								([label, count]) => (
									<div key={label} style={{ display: "contents" }}>
										<span className="k">{label}</span>
										<span className="v">{count}</span>
									</div>
								),
							)}
						</div>

						{overview.channelActivity.length > 0 && (
							<>
								<div className="panel-title" style={{ marginBottom: "8px" }}>
									ACTIVE GROUP CHANNELS
								</div>
								<div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
									{overview.channelActivity.map((c) => (
										<span
											key={c.channelHash}
											style={{
												border: "1px solid var(--border, #333)",
												padding: "3px 8px",
												fontSize: "11px",
											}}
										>
											Channel 0x{c.channelHash.toString(16).padStart(2, "0")} ·{" "}
											{c.count} pkts
										</span>
									))}
								</div>
							</>
						)}
					</div>
				)}

				{/* Tab 3: Topology & Repeater Utilization */}
				{activeTab === "topology" && (
					<div>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								marginBottom: "8px",
							}}
						>
							<div className="panel-title" style={{ margin: 0 }}>
								REPEATER RELAY UTILIZATION
							</div>
							<button
								type="button"
								onClick={() => void handleCopyMermaid()}
								title="Copy Mermaid topology flowchart diagram code"
							>
								{copied ? "COPIED!" : "COPY MERMAID"}
							</button>
						</div>

						{overview.repeaterHopUtilization.length > 0 ? (
							<table
								style={{
									width: "100%",
									borderCollapse: "collapse",
									fontSize: "12px",
									marginBottom: "16px",
								}}
							>
								<thead>
									<tr style={{ borderBottom: "1px solid var(--border, #333)" }}>
										<th style={{ textAlign: "left", padding: "6px 4px" }}>
											HOP HASH
										</th>
										<th style={{ textAlign: "left", padding: "6px 4px" }}>
											MATCHED REPEATER
										</th>
										<th style={{ textAlign: "right", padding: "6px 4px" }}>
											RELAY COUNT
										</th>
									</tr>
								</thead>
								<tbody>
									{overview.repeaterHopUtilization.map((h) => (
										<tr
											key={h.hopHashHex}
											style={{
												borderBottom: "1px solid var(--border-subtle, #222)",
											}}
										>
											<td
												style={{ padding: "6px 4px", fontFamily: "monospace" }}
											>
												0x{h.hopHashHex}
											</td>
											<td style={{ padding: "6px 4px" }}>
												{h.matchedNodeName ? (
													<span style={{ fontWeight: "bold" }}>
														{h.matchedNodeName}
													</span>
												) : h.matchedNodeIdHex ? (
													<span className="dim">
														Node 0x{h.matchedNodeIdHex}
													</span>
												) : (
													<span className="dim">Unknown Repeater</span>
												)}
											</td>
											<td
												style={{
													textAlign: "right",
													padding: "6px 4px",
													fontWeight: "bold",
												}}
											>
												{h.count} pkts
											</td>
										</tr>
									))}
								</tbody>
							</table>
						) : (
							<p
								className="dim"
								style={{ fontSize: "12px", marginBottom: "16px" }}
							>
								No routed multi-hop paths observed. All traffic heard directly
								by local receiver.
							</p>
						)}

						<div className="panel-title" style={{ marginBottom: "8px" }}>
							MERMAID TOPOLOGY FLOWCHART
						</div>
						<pre
							style={{
								background: "var(--code-bg, #0d0d0d)",
								border: "1px solid var(--border, #222)",
								padding: "10px",
								fontSize: "11px",
								overflowX: "auto",
								margin: 0,
								whiteSpace: "pre-wrap",
							}}
						>
							{overview.topologyMermaid}
						</pre>
					</div>
				)}

				<div
					className="dim"
					style={{
						marginTop: "16px",
						paddingTop: "10px",
						borderTop: "1px solid var(--border-subtle, #222)",
						fontSize: "11px",
						lineHeight: 1.5,
					}}
				>
					Derived from cleartext headers, path hop hashes, and signed ADVERT
					identity frames. End-to-end payload cryptography is never broken.
				</div>
			</div>
		</div>
	);
}
