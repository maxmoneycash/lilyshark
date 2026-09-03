import { useState } from "react";
import { useDeviceLink, type HeardFrame } from "../../lib/deviceLink";
import { hexDump } from "../../lib/hexdump";
import { buildLscap } from "../../lib/lscapWrite";
import {
	clearSnifferSession,
	setSnifferPaused,
	useSnifferSession,
} from "../../lib/snifferSession";
import { fmtMHz } from "../../lib/spectrum";
import { stamp } from "../export";
import { hhmm, snrClass } from "../fmt";

const BROADCAST = 0xffffffff;

function nodeId(num: number): string {
	return `!${num.toString(16).padStart(8, "0")}`;
}

export default function Sniffer() {
	const link = useDeviceLink();
	const session = useSnifferSession();
	// The selected frame is held by reference, not by index: the ring shifts
	// under the table, and the detail pane should keep showing the frame that
	// was clicked even after it scrolls off the list.
	const [sel, setSel] = useState<HeardFrame | undefined>();
	const [exportMsg, setExportMsg] = useState("");

	const linked = link.status === "linked";
	const frames = session.frames;
	const rawRecords = frames.flatMap((f) => (f.raw ? [f.raw] : []));

	// Same download shape as the TRAFFIC capture: a .lscap assembled in the
	// browser, holding only the frames that carry their full record.
	const onSave = () => {
		const bytes = buildLscap(rawRecords);
		const url = URL.createObjectURL(
			new Blob([bytes.slice().buffer as ArrayBuffer], {
				type: "application/octet-stream",
			}),
		);
		const a = document.createElement("a");
		a.href = url;
		a.download = `lilyshark-sniffer-${stamp()}.lscap`;
		a.click();
		URL.revokeObjectURL(url);
		setExportMsg(`SAVED ${rawRecords.length} FRAMES`);
	};

	return (
		<main style={{ flexDirection: "column" }}>
			<div
				style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}
			>
				<span className="dim" style={{ fontSize: 10, letterSpacing: 2 }}>
					SNIFFER // EVERY FRAME THE RADIO HEARS
				</span>
				<button
					disabled={frames.length === 0 && !session.paused}
					title={
						session.paused
							? "Let new frames flow into the list again"
							: "Freeze the list — the radio keeps listening, and the counter says what arrived meanwhile"
					}
					onClick={() => setSnifferPaused(!session.paused)}
				>
					{session.paused ? "RESUME" : "PAUSE"}
				</button>
				<button
					disabled={frames.length === 0}
					title="Empty the list and start the session over"
					onClick={() => {
						clearSnifferSession();
						setSel(undefined);
						setExportMsg("");
					}}
				>
					CLEAR
				</button>
				<button
					disabled={rawRecords.length === 0}
					title="Save the listed frames as a .lscap capture — the TRAFFIC screen opens it, and only frames that carry their raw bytes can be written"
					onClick={onSave}
				>
					⭳ SAVE CAPTURE
				</button>
				{session.paused && (
					<span className="warn" style={{ fontSize: 11 }}>
						PAUSED
						{session.missedWhilePaused > 0 &&
							` · ${session.missedWhilePaused} FRAMES HEARD MEANWHILE`}
					</span>
				)}
				{!linked && frames.length > 0 && (
					<span className="dim" style={{ fontSize: 11 }}>
						T-Deck not linked — this is what was heard before the link closed.
					</span>
				)}
				{exportMsg && (
					<span className="dim" style={{ fontSize: 11 }}>
						{exportMsg}
					</span>
				)}
				<span className="spacer" />
				<span className="dim" style={{ fontSize: 11 }}>
					{`${frames.length} LISTED · ${session.totalHeard} HEARD`}
				</span>
			</div>

			<div
				style={{ flex: 1, display: "flex", gap: 12, minHeight: 0, flexWrap: "wrap" }}
			>
				<div className="panel" style={{ flex: "999 1 420px", minWidth: 0 }}>
					<div className="panel-title">
						<span>CAPTURE // LIVE TABLE</span>
						<span>CLICK A ROW FOR ITS BYTES</span>
					</div>
					{frames.length === 0 ? (
						<p className="dim" style={{ padding: 16, fontSize: 12 }}>
							{linked
								? "Listening — the next frame the radio hears lands here_"
								: "Nothing captured yet — connect a T-Deck over USB with the CONNECT button, and every frame its radio hears lands here_"}
						</p>
					) : (
						<div className="scroll-y">
							<table className="grid">
								<thead>
									<tr>
										<th>TIME</th>
										<th>FROM</th>
										<th>TO</th>
										<th>PROTOCOL</th>
										<th>TYPE</th>
										<th>RSSI</th>
										<th>SNR</th>
										<th>BYTES</th>
									</tr>
								</thead>
								<tbody>
									{/* Newest first: a sniffer is read from the top. */}
									{frames
										.slice()
										.reverse()
										.map((f, i) => (
											<tr
												key={`${f.atMs}:${f.src}:${i}`}
												className={f === sel ? "sel" : ""}
												onClick={() => setSel(f === sel ? undefined : f)}
											>
												<td>{hhmm(f.atMs)}</td>
												<td title={nodeId(f.src)}>{f.short ?? nodeId(f.src)}</td>
												<td>{f.dst === BROADCAST ? "ALL" : nodeId(f.dst)}</td>
												<td>{f.proto}</td>
												<td
													className={f.sim ? "warn" : ""}
													title={
														f.sim
															? "Synthetic frame from the device's simulate mode — not heard over the air"
															: undefined
													}
												>
													{f.kind}
													{f.sim && " · SYNTHETIC"}
												</td>
												<td>{(f.rssiX10 / 10).toFixed(1)}</td>
												<td className={snrClass(f.snrX10 / 10)}>
													{(f.snrX10 / 10).toFixed(1)}
												</td>
												<td className={f.raw ? "" : "dim"}>
													{f.raw ? f.raw.bytes.length : "—"}
												</td>
											</tr>
										))}
								</tbody>
							</table>
						</div>
					)}
					<div className="panel-foot">
						<span>RSSI IN dBm · SNR IN dB</span>
						<span className="spacer" />
						{rawRecords.length < frames.length && (
							<span>
								{rawRecords.length} OF {frames.length} FRAMES CARRY THE RAW
								BYTES A CAPTURE NEEDS
							</span>
						)}
					</div>
				</div>

				{sel && (
					<div
						className="panel hot"
						style={{ flex: "1 1 300px", minWidth: 280, fontSize: 12 }}
					>
						<div className="panel-title">
							<span>FRAME // {sel.short ?? nodeId(sel.src)}</span>
							<button
								onClick={() => setSel(undefined)}
								style={{ width: 22, height: 22, padding: 0, fontSize: 12, minWidth: 22 }}
							>
								✕
							</button>
						</div>
						<div className="scroll-y" style={{ padding: "10px 12px" }}>
							{(
								[
									["FROM", `${sel.name ?? ""} ${nodeId(sel.src)}`.trim()],
									["TO", sel.dst === BROADCAST ? "ALL" : nodeId(sel.dst)],
									["PROTOCOL", `${sel.proto} · PORT ${sel.port}`],
									["TYPE", sel.kind + (sel.sim ? " · SYNTHETIC" : "")],
									[
										"SIGNAL",
										`${(sel.rssiX10 / 10).toFixed(1)} dBm · SNR ${(sel.snrX10 / 10).toFixed(1)} dB`,
									],
									["HEARD AT", hhmm(sel.atMs)],
									...(sel.hops !== undefined
										? ([["HOPS", String(sel.hops)]] as [string, string][])
										: []),
									...(sel.raw && sel.raw.centerFrequencyHz > 0
										? ([["FREQUENCY", fmtMHz(sel.raw.centerFrequencyHz)]] as [
												string,
												string,
											][])
										: []),
									...(sel.raw
										? ([
												[
													"LENGTH",
													sel.raw.originalLength > sel.raw.bytes.length
														? `${sel.raw.bytes.length} OF ${sel.raw.originalLength} BYTES KEPT`
														: `${sel.raw.bytes.length} BYTES`,
												],
											] as [string, string][])
										: []),
								] as [string, string][]
							).map(([label, value]) => (
								<div key={label} style={{ display: "flex", gap: 10, lineHeight: 1.8 }}>
									<span className="dim" style={{ width: 92, flexShrink: 0, fontSize: 10, letterSpacing: 1 }}>
										{label}
									</span>
									<span style={{ wordBreak: "break-all" }}>{value}</span>
								</div>
							))}
							{sel.text && (
								<div style={{ margin: "8px 0" }}>
									<span className="dim" style={{ fontSize: 10, letterSpacing: 1 }}>
										TEXT
									</span>
									<div style={{ wordBreak: "break-word" }}>{sel.text}</div>
								</div>
							)}
							{sel.raw ? (
								<pre style={{ fontSize: 11, lineHeight: 1.6, margin: "8px 0 0" }}>
									{hexDump(sel.raw.bytes).join("\n")}
								</pre>
							) : (
								<p className="dim" style={{ fontSize: 11 }}>
									This frame arrived without its raw bytes — firmware older than
									the capture link sends only the decoded summary.
								</p>
							)}
						</div>
					</div>
				)}
			</div>
		</main>
	);
}
