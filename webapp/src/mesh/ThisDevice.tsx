import { disconnectDeviceLink, useDeviceLink, type DeviceTelemetry } from "../lib/deviceLink";

export function SimulateBadge({ on }: { on?: boolean }) {
	if (!on) return null;
	return <span className="sim-badge">SIMULATE MODE · SYNTHETIC</span>;
}

function batteryPct(bat: string): number | undefined {
	const m = bat.match(/(\d+)\s*%/);
	return m ? Number(m[1]) : undefined;
}

function Spark({ values }: { values: number[] }) {
	if (values.length < 2) return null;
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min || 1;
	const w = 72;
	const h = 16;
	const pts = values
		.map((v, i) => {
			const x = (i / (values.length - 1)) * w;
			const y = h - ((v - min) / span) * (h - 2) - 1;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(" ");
	return (
		<svg className="spark" width={w} height={h} aria-hidden="true">
			<polyline
				fill="none"
				stroke="currentColor"
				strokeWidth="1.2"
				points={pts}
			/>
		</svg>
	);
}

function rssi(t0: DeviceTelemetry): number {
	return t0.rssiX10 / 10;
}

function snr(t0: DeviceTelemetry): number {
	return t0.snrX10 / 10;
}

export function ThisDevicePanel() {
	const link = useDeviceLink();
	if (link.status !== "linked") return null;
	const telem = link.telemetry;
	const hist = link.history;
	const batSeries = hist
		.map((h) => batteryPct(h.bat))
		.filter((n): n is number => n !== undefined);
	const rssiSeries = hist.map(rssi);
	const snrSeries = hist.map(snr);
	return (
		<div className="panel this-device">
			<div className="panel-title">
				<span>
					THIS DEVICE
					<SimulateBadge on={telem?.sim} />
				</span>
				<span>LILYSHARK {link.firmware ?? "—"} OVER USB</span>
			</div>
			{telem ? (
				<>
					<div className="device-readout">
						<div className="stat-tile">
							<div className="label">BATTERY</div>
							<div className="value">
								{telem.bat}
								{telem.mv !== undefined && (
									<small>{(telem.mv / 1000).toFixed(2)} V</small>
								)}
								<Spark values={batSeries} />
							</div>
						</div>
						<div className="stat-tile">
							<div className="label">GPS</div>
							<div className="value">
								{telem.gps}
								{telem.sat !== undefined && <small>{telem.sat} SAT</small>}
								{telem.lat !== undefined && telem.lon !== undefined ? (
									<small>
										{telem.lat.toFixed(5)}N {telem.lon.toFixed(5)}E
									</small>
								) : telem.gps.includes("SEARCH") ? (
									<small>RECEIVER FOUND · WAITING FOR SATELLITES · NEEDS SKY</small>
								) : (
									<small>NO FIX YET</small>
								)}
							</div>
						</div>
						<div className="stat-tile">
							<div className="label">RADIO</div>
							<div className="value">
								{telem.profile}
								<small>
									{telem.freqHz
										? `${(telem.freqHz / 1e6).toFixed(3)} MHz`
										: "freq —"}
									{telem.sf !== undefined ? ` · SF${telem.sf}` : ""}
									{telem.bwHz ? ` · ${(telem.bwHz / 1000).toFixed(0)} kHz` : ""}
								</small>
							</div>
						</div>
						<div className="stat-tile">
							<div className="label">HEARD</div>
							<div className="value">
								{(telem.rx ?? telem.frames) === 0
									? "NONE YET"
									: `#${telem.frames}`}
								<small>
									{(telem.rx ?? 0) === 0
										? "listening · nothing on this profile yet"
										: `RX ${telem.rx} · CRC ${telem.crc ?? 0}`}
								</small>
							</div>
						</div>
						<div className="stat-tile">
							<div className="label">RSSI</div>
							<div className="value">
								{(telem.rx ?? 0) === 0 && telem.frames === 0
									? "—"
									: `${rssi(telem).toFixed(1)} dBm`}
								<Spark values={rssiSeries} />
							</div>
						</div>
						<div className="stat-tile">
							<div className="label">SNR</div>
							<div className="value">
								{(telem.rx ?? 0) === 0 && telem.frames === 0
									? "—"
									: `${snr(telem).toFixed(1)} dB`}
								<Spark values={snrSeries} />
							</div>
						</div>
					</div>
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
						This firmware now transmits on Meshtastic LongFast (default key)
						from CHAT. MeshCore send still needs a MeshCore identity — same
						radio, next encoder. Heard default-key texts also land in CHAT.
					</p>
					{link.frames.length > 0 && (
						<div className="device-heard">
							<div className="label">LAST HEARD ON AIR</div>
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
											{(f.rssiX10 / 10).toFixed(0)} dBm
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
	const heard = (telem?.rx ?? 0) > 0 || (telem?.frames ?? 0) > 0;
	return (
		<tr className="this-device-row">
			<td>
				THIS DEVICE · LILYSHARK {link.firmware ?? "—"} OVER USB
				<SimulateBadge on={telem?.sim} />
			</td>
			<td style={{ fontWeight: 700 }}>USB</td>
			<td className={heard ? "" : "dim"}>
				{heard && telem ? `${snr(telem).toFixed(2)} dB` : "—"}
			</td>
			<td>{telem?.bat ?? "—"}</td>
			<td>—</td>
			<td>
				{telem?.lat !== undefined && telem.lon !== undefined
					? `${telem.lat.toFixed(4)}N ${telem.lon.toFixed(4)}E`
					: telem?.gps === "GPS SEARCH"
						? "GPS SEARCH · NO FIX"
						: (telem?.gps ?? "NO GPS FIX")}
			</td>
			<td>LIVE</td>
		</tr>
	);
}
