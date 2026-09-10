import { disconnectDeviceLink, useDeviceLink } from "../lib/deviceLink";
import { RF_FIELD } from "../lib/lscap";
import { reportedLabel, telemetryBattery, telemetryCount, telemetrySignal, telemetryVoltage, unattributedFrames } from "./deviceTelemetry";
import { fmtHemisphere } from "./fmt";

export function SimulateBadge({ on }: { on?: boolean }) {
	if (!on) return null;
	return <span className="sim-badge">SIMULATE MODE · SYNTHETIC</span>;
}

function Spark({ values }: { values: number[] }) {
	const w = 120;
	const h = 24;
	if (values.length < 2) {
		return (
			<svg
				className="spark spark-empty"
				viewBox={`0 0 ${w} ${h}`}
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				<line
					x1="0"
					y1={h / 2}
					x2={w}
					y2={h / 2}
					stroke="currentColor"
					strokeWidth="1.5"
					strokeDasharray="4 3"
					vectorEffect="nonScalingStroke"
				/>
			</svg>
		);
	}
	const min = Math.min(...values);
	const max = Math.max(...values);
	const flat = max === min;
	const pts = values
		.map((v, i) => {
			const x = (i / (values.length - 1)) * w;
			const y = flat ? h / 2 : h - ((v - min) / (max - min)) * (h - 2) - 1;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(" ");
	return (
		<svg
			className="spark"
			viewBox={`0 0 ${w} ${h}`}
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<polyline
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinejoin="round"
				strokeLinecap="round"
				vectorEffect="nonScalingStroke"
				points={pts}
			/>
		</svg>
	);
}

export function ThisDevicePanel() {
	const link = useDeviceLink();
	if (link.status !== "linked") return null;
	const telem = link.telemetry;
	const hist = link.history;
	const batSeries = hist
		.map(telemetryBattery)
		.filter((n): n is number => n !== undefined);
	const rssiSeries = hist.map((h) => telemetrySignal(h, "rssi")).filter((n): n is number => n !== undefined);
	const snrSeries = hist.map((h) => telemetrySignal(h, "snr")).filter((n): n is number => n !== undefined);
	const rssi = telem ? telemetrySignal(telem, "rssi") : undefined;
	const snr = telem ? telemetrySignal(telem, "snr") : undefined;
	const voltage = telem ? telemetryVoltage(telem) : undefined;
	const dropped = telem ? unattributedFrames(telem) : undefined;
	const count = (n: number | undefined) => telemetryCount(n)?.toLocaleString() ?? "Not reported";
	const batLabel = telem ? reportedLabel(telem.bat) : "Not reported";
	const gpsLabel = telem ? reportedLabel(telem.gps) : "Not reported";
	const gpsSearching = telem ? /search/i.test(telem.gps) : false;
	const rxNote = (measured: number | undefined) =>
		telem?.direction === 2
			? "Transmitted frame · no receive signal"
			: measured === undefined
				? "No receive measurement."
				: undefined;
	const rssiNote = rxNote(rssi);
	const snrNote = rxNote(snr);
	return (
		<div className="panel this-device">
			<div className="panel-title">
				<span>
					THIS DEVICE
					<SimulateBadge on={telem?.sim} />
				</span>
				<span className="device-id">
					LILYSHARK {link.firmware || "VERSION NOT REPORTED"} OVER USB · {link.node !== undefined ? `!${link.node.toString(16).padStart(8, "0")}` : "NODE ID NOT REPORTED"}
				</span>
			</div>
			{telem ? (
				<>
					<div className="device-readout">
						<div className="stat-tile">
							<div className="label">BATTERY</div>
							<div className="value">
								{batLabel}
								{voltage !== undefined && (
									<small>{voltage.toFixed(2)} V</small>
								)}
								{voltage === undefined && batLabel === "Not reported" && (
									<small>The deck has not reported a battery reading.</small>
								)}
								<Spark values={batSeries} />
							</div>
						</div>
						<div className="stat-tile">
							<div className="label">GPS</div>
							<div className="value">
								{gpsLabel}
								{telem.sat !== undefined && <small>{telem.sat} SAT</small>}
								{telem.lat !== undefined && telem.lon !== undefined ? (
									<small>
										{fmtHemisphere(telem.lat, telem.lon, 5, 5)}
									</small>
								) : (
									<small>
										{gpsSearching
											? "Waiting for a GPS fix."
											: "The deck has not reported a position."}
									</small>
								)}
							</div>
						</div>
						<div className="stat-tile">
							<div className="label">RADIO</div>
							<div className="value">
								{reportedLabel(telem.profile)}
								<small>
									{telem.freqHz
										? `${(telem.freqHz / 1e6).toFixed(3)} MHz`
										: "Frequency not reported"}
									{telem.sf !== undefined ? ` · SF${telem.sf}` : ""}
									{telem.bwHz ? ` · ${(telem.bwHz / 1000).toFixed(0)} kHz` : ""}
								</small>
							</div>
						</div>
						<div className="stat-tile">
							<div className="label">RADIO RX</div>
							<div className="value">
								{count(telem.rx)}
								<small>Frames received by the radio</small>
							</div>
						</div>
						<div className="stat-tile">
							<div className="label">LATEST FRAME RSSI</div>
							<div className="value">
								{rssi === undefined ? "Not reported" : `${rssi.toFixed(1)} DBM`}
								{rssiNote && <small>{rssiNote}</small>}
								<Spark values={rssiSeries} />
							</div>
						</div>
						<div className="stat-tile">
							<div className="label">LATEST FRAME SNR</div>
							<div className="value">
								{snr === undefined ? "Not reported" : `${snr.toFixed(1)} DB`}
								{snrNote && <small>{snrNote}</small>}
								<Spark values={snrSeries} />
							</div>
						</div>
					</div>
					<div className="device-counters" aria-label="Capture and attribution counters">
						<span>LATEST CAPTURE SEQUENCE <b>{count(telem.frames)}</b></span>
						<span>RADIO CRC ERRORS <b>{count(telem.crc)}</b></span>
						<span>CRC REJECTED <b>{count(telem.dropCrc)}</b></span>
						<span>MALFORMED <b>{count(telem.dropMalformed)}</b></span>
						<span>NO SOURCE <b>{count(telem.dropNoSource)}</b></span>
					</div>
					<p className="dim device-note">
						{dropped === undefined ? "The full count of frames without node attribution is not reported."
							: `${dropped.toLocaleString()} analyzer frames have no node attribution.`}{" "}
						These frames do not appear as nodes. The capture sequence includes transmissions.
					</p>
					<div className="device-actions">
						<button
							className="primary"
							onClick={() =>
								window.dispatchEvent(
									new CustomEvent("lilyshark-tab", { detail: "TRAFFIC" }),
								)
							}
						>
							LIVE AIR
						</button>
						<button
							onClick={() =>
								window.dispatchEvent(
									new CustomEvent("lilyshark-tab", { detail: "MAP" }),
								)
							}
						>
							MAP
						</button>
						<button
							onClick={() =>
								window.dispatchEvent(
									new CustomEvent("lilyshark-tab", { detail: "NODES" }),
								)
							}
						>
							HEARD NODES
						</button>
						<button onClick={() => void disconnectDeviceLink()}>UNLINK</button>
					</div>
					<p className="dim device-note">
						Use Chat to send Meshtastic messages through the deck. Choose a node
						for a direct message. A successful transmission leaves delivery unconfirmed.
					</p>
					{link.frames.length > 0 && (
						<div className="device-heard">
							<div className="label">RECENT ANALYZER FRAMES</div>
							{link.frames
								.slice(-6)
								.reverse()
								.map((f) => (
									<div key={`${f.atMs}-${f.src}-${f.kind}`} className="heard-line">
										<span className="k">{f.proto}</span>
										<span>
											{f.short ?? `!${f.src.toString(16)}`} · {f.kind}
											{f.text ? ` · ${f.text}` : ""}
											{f.lat !== undefined ? " · POS" : ""}
										</span>
										<span className="dim">
											{f.raw?.direction === 2 ? "TX · delivery unconfirmed"
												: f.raw?.direction === 1 && (f.raw.presentFields & RF_FIELD.rssi) !== 0
													? `${(f.rssiX10 / 10).toFixed(0)} DBM` : "RSSI not reported"}
										</span>
									</div>
								))}
						</div>
					)}
				</>
			) : (
				<p className="dim" style={{ padding: 12, margin: 0 }}>
					LINKED · WAITING FOR TELEMETRY_
				</p>
			)}
		</div>
	);
}

export function ThisDeviceRow() {
	const link = useDeviceLink();
	if (link.status !== "linked") return null;
	const telem = link.telemetry;
	return (
		<tr className="this-device-row">
			<td>
				THIS DEVICE · {link.node !== undefined ? `!${link.node.toString(16).padStart(8, "0")}` : "NODE ID NOT REPORTED"} · LILYSHARK {link.firmware || "VERSION NOT REPORTED"} OVER USB
				<SimulateBadge on={telem?.sim} />
			</td>
			<td style={{ fontWeight: 700 }}>USB</td>
			<td className="dim">Not measured</td>
			<td>{reportedLabel(telem?.bat)}</td>
			<td>Local</td>
			<td>
				{telem?.lat !== undefined && telem.lon !== undefined
					? fmtHemisphere(telem.lat, telem.lon)
					: telem?.gps === "GPS SEARCH"
						? "GPS SEARCH · NO FIX"
						: reportedLabel(telem?.gps)}
			</td>
			<td>LIVE</td>
		</tr>
	);
}
