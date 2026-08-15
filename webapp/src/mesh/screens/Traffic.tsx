import { useMemo, useRef, useState } from "react";
import {
	findShelbyPointer,
	hasField,
	hexDump,
	type LscapCapture,
	type LscapFrame,
	LscapParseError,
	parseLscap,
	RF_FIELD,
	summarize,
} from "../../lib/lscap";
import { t, useLangTick } from "../i18n";

/**
 * TRÁFICO — the .lscap analyzer as a terminal screen. Opens captures written
 * by the T-Deck firmware (from disk, from the bundled sample, or from Shelby
 * by blob name) and reads them the way a protocol analyzer does: frames on
 * top, the selected frame's radio measurements and bytes below, and an inline
 * decode when a frame carries a Shelby off-grid pointer.
 */

const fmtFreq = (hz: number) =>
	hz >= 1_000_000
		? `${(hz / 1_000_000).toFixed(3)} MHz`
		: `${(hz / 1000).toFixed(1)} kHz`;

const crcClass = (c: LscapFrame["crc"]) =>
	c === "valid" ? "ok" : c === "invalid" ? "err" : "dim";

export default function Traffic() {
	useLangTick();
	const [capture, setCapture] = useState<LscapCapture | null>(null);
	const [name, setName] = useState("");
	const [selected, setSelected] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [blob, setBlob] = useState("");
	const [busy, setBusy] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const load = (buf: ArrayBuffer, from: string) => {
		try {
			const c = parseLscap(buf);
			setCapture(c);
			setName(from);
			setSelected(0);
			setError(
				c.trailingBytes > 0
					? t(
							"{0} byte(s) sueltos al final — la captura pudo cortarse a mitad de escritura.",
							c.trailingBytes,
						)
					: null,
			);
		} catch (e) {
			setCapture(null);
			setError(
				e instanceof LscapParseError
					? e.message
					: t("Ese archivo no es una captura .lscap"),
			);
		}
	};

	const openFile = async (f: File) => {
		setBusy(true);
		try {
			load(await f.arrayBuffer(), f.name);
		} finally {
			setBusy(false);
		}
	};

	const fetchUrl = async (url: string, from: string, fail: string) => {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			load(await res.arrayBuffer(), from);
		} catch (e) {
			setCapture(null);
			setError(e instanceof Error ? e.message : fail);
		} finally {
			setBusy(false);
		}
	};

	const fetchBlob = () => {
		const n = blob.trim();
		if (!n) return;
		void fetchUrl(
			`/api/share/view/${encodeURIComponent(n)}`,
			n,
			t("No se pudo descargar ese blob"),
		);
	};

	// The bundled demo capture: 24 frames of LongFast traffic with a Shelby
	// pointer at sequence 9. No device, no upload — always works.
	const openSample = () =>
		void fetchUrl(
			"/sample-mesh-traffic.lscap",
			"sample-mesh-traffic.lscap",
			t("No se pudo cargar la captura de muestra"),
		);

	const frames = capture?.frames ?? [];
	const stats = useMemo(() => summarize(frames), [frames]);
	// A pointer rides behind whatever protocol header enclosed it, so any frame
	// may carry one; scan every payload once per capture.
	const pointers = useMemo(
		() => frames.map((f) => findShelbyPointer(f.bytes)),
		[frames],
	);
	const pointerCount = pointers.reduce((n, p) => n + (p ? 1 : 0), 0);
	const t0 = frames.length ? frames[0].timestampUs : 0n;
	const f = frames[selected];
	const ptr = f ? pointers[selected] : null;

	return (
		<>
			{/* ── source ─────────────────────────────────────────────── */}
			<div className="panel">
				<div className="panel-title">
					<span>{t("CAPTURA")}</span>
					{name && (
						<span className="dim" style={{ marginLeft: "auto" }}>
							{name}
						</span>
					)}
				</div>
				<div className="panel-actions">
					<button
						type="button"
						onClick={() => fileRef.current?.click()}
						disabled={busy}
					>
						{t("ABRIR .LSCAP")}
					</button>
					<button type="button" onClick={openSample} disabled={busy}>
						{t("MUESTRA")}
					</button>
					<input
						ref={fileRef}
						type="file"
						accept=".lscap,application/octet-stream"
						hidden
						onChange={(e) => {
							const x = e.target.files?.[0];
							if (x) void openFile(x);
						}}
					/>
					<input
						placeholder={t("…o nombre de blob en Shelby")}
						value={blob}
						onChange={(e) => setBlob(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && fetchBlob()}
					/>
					<button
						type="button"
						onClick={fetchBlob}
						disabled={busy || !blob.trim()}
					>
						{t("BUSCAR")}
					</button>
				</div>
				{error && (
					<div className="panel-foot">
						<span className="err">{error}</span>
					</div>
				)}
				{!capture && !busy && !error && (
					<div className="panel-foot">
						<span className="dim">
							{t(
								"El T-Deck escribe capturas .lscap en la microSD. Abre una para leer sus tramas, medidas de radio y bytes — o pulsa MUESTRA para explorar la captura incluida, que lleva un puntero Shelby en la trama 9.",
							)}
						</span>
					</div>
				)}
			</div>

			{capture && (
				<>
					{/* ── readouts ─────────────────────────────────────────── */}
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
							gap: 8,
							margin: "8px 0",
						}}
					>
						{(
							[
								[t("TRAMAS"), stats.frames.toLocaleString()],
								[t("BYTES"), `${stats.bytes.toLocaleString()} B`],
								[
									"CRC",
									`${stats.crcValid} / ${stats.crcInvalid}`,
									stats.crcInvalid ? "err" : "ok",
								],
								[
									t("MEJOR SNR"),
									stats.bestSnrDb === null ? "—" : `${stats.bestSnrDb.toFixed(1)} dB`,
								],
								[
									t("RSSI MED."),
									stats.medianRssiDbm === null
										? "—"
										: `${stats.medianRssiDbm.toFixed(1)} dBm`,
								],
								[t("PUNTEROS"), String(pointerCount), pointerCount ? "ok" : undefined],
							] as [string, string, string?][]
						).map(([label, value, cls]) => (
							<div key={label} className="panel stat-tile">
								<div className="label">{label}</div>
								<div className={`value${cls ? ` ${cls}` : ""}`}>{value}</div>
							</div>
						))}
					</div>

					{/* ── frame table ────────────────────────────────────────── */}
					<div className="panel" style={{ maxHeight: "42vh", overflowY: "auto" }}>
						<table>
							<thead>
								<tr>
									<th>#</th>
									<th>{t("HORA")}</th>
									<th>{t("DIR")}</th>
									<th>{t("LON")}</th>
									<th>{t("FREC")}</th>
									<th>SF/CR</th>
									<th>RSSI</th>
									<th>SNR</th>
									<th>CRC</th>
									<th>SHLB</th>
								</tr>
							</thead>
							<tbody>
								{frames.map((fr, i) => (
									<tr
										key={fr.sequence}
										onClick={() => setSelected(i)}
										style={{
											cursor: "pointer",
											background:
												i === selected ? "var(--glow)" : undefined,
										}}
									>
										<td>{Number(fr.sequence)}</td>
										<td>{(Number(fr.timestampUs - t0) / 1_000_000).toFixed(3)}</td>
										<td>{fr.direction.toUpperCase()}</td>
										<td>
											{fr.capturedLength}
											{fr.truncated ? "*" : ""}
										</td>
										<td>
											{hasField(fr, RF_FIELD.frequency)
												? fmtFreq(fr.centerFrequencyHz)
												: "—"}
										</td>
										<td>
											{fr.spreadingFactor}/{fr.codingRateDenominator}
										</td>
										<td>
											{hasField(fr, RF_FIELD.rssi) ? fr.rssiDbm.toFixed(1) : "—"}
										</td>
										<td>
											{hasField(fr, RF_FIELD.snr) ? fr.snrDb.toFixed(1) : "—"}
										</td>
										<td className={crcClass(fr.crc)}>{fr.crc}</td>
										<td className="ok">{pointers[i] ? "◆" : ""}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{/* ── detail + hex ─────────────────────────────────────── */}
					{f && (
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
								gap: 8,
								marginTop: 8,
							}}
						>
							<div className="panel">
								<div className="panel-title">
									<span>
										{t("TRAMA {0}", Number(f.sequence))}
									</span>
								</div>
								<div className="kv">
									<span className="k">{t("MODULACIÓN")}</span>
									<span>{f.modulation.toUpperCase()}</span>
									<span className="k">{t("DIRECCIÓN")}</span>
									<span>{f.direction.toUpperCase()}</span>
									<span className="k">{t("CAPT./ORIG.")}</span>
									<span>
										{f.capturedLength} / {f.originalLength} B
									</span>
									<span className="k">{t("FRECUENCIA")}</span>
									<span>
										{hasField(f, RF_FIELD.frequency)
											? fmtFreq(f.centerFrequencyHz)
											: t("no informada")}
									</span>
									<span className="k">{t("ANCHO DE BANDA")}</span>
									<span>
										{hasField(f, RF_FIELD.bandwidth)
											? fmtFreq(f.bandwidthHz)
											: t("no informado")}
									</span>
									<span className="k">SF / CR</span>
									<span>
										SF{f.spreadingFactor} · 4/{f.codingRateDenominator}
									</span>
									<span className="k">RSSI</span>
									<span>
										{hasField(f, RF_FIELD.rssi)
											? `${f.rssiDbm.toFixed(1)} dBm`
											: t("no informado")}
									</span>
									<span className="k">SNR</span>
									<span>
										{hasField(f, RF_FIELD.snr)
											? `${f.snrDb.toFixed(1)} dB`
											: t("no informado")}
									</span>
									<span className="k">{t("ERROR FREC.")}</span>
									<span>
										{hasField(f, RF_FIELD.frequencyError)
											? `${f.frequencyErrorHz} Hz`
											: t("no informado")}
									</span>
									<span className="k">{t("TIEMPO AIRE")}</span>
									<span>
										{hasField(f, RF_FIELD.airtime)
											? `${(f.airtimeUs / 1000).toFixed(1)} ms`
											: t("no informado")}
									</span>
									<span className="k">{t("INTEGRIDAD")}</span>
									<span className={crcClass(f.crc)}>{f.crc}</span>
								</div>
							</div>

							<div className="panel">
								<div className="panel-title">
									<span>{t("BYTES EN BRUTO")}</span>
								</div>
								<pre style={{ margin: 0, padding: 12, overflowX: "auto", fontSize: 11 }}>
									{f.capturedLength > 0
										? hexDump(f.bytes)
										: t("(sin carga capturada)")}
								</pre>
							</div>

							{ptr && (
								<div className="panel">
									<div className="panel-title">
										<span>SHELBY POINTER</span>
										<span className="ok" style={{ marginLeft: "auto" }}>
											{t("en el desplazamiento {0}", ptr.offset)}
										</span>
									</div>
									<div className="kv">
										<span className="k">{t("TAMAÑO")}</span>
										<span>{ptr.pointer.sizeBytes.toLocaleString()} B</span>
										<span className="k">{t("CADUCA")}</span>
										<span>
											{new Date(ptr.pointer.expiresAtUnix * 1000).toISOString()}
										</span>
										<span className="k">{t("PARTE")}</span>
										<span>
											{ptr.pointer.chunked
												? `${ptr.pointer.chunkIndex + 1} / ${ptr.pointer.chunkCount}`
												: t("blob completo")}
										</span>
										<span className="k">{t("MARCAS")}</span>
										<span>
											{[
												ptr.pointer.encrypted && t("cifrado"),
												ptr.pointer.capture && t("captura lilyshark"),
											]
												.filter(Boolean)
												.join(", ") || t("ninguna")}
										</span>
										<span className="k">{t("COMPROMISO")}</span>
										<span style={{ wordBreak: "break-all" }}>
											{ptr.pointer.commitment}
										</span>
										<span className="k">{t("PROPIETARIO")}</span>
										<span style={{ wordBreak: "break-all" }}>
											{ptr.pointer.owner}
										</span>
									</div>
								</div>
							)}
						</div>
					)}
				</>
			)}
		</>
	);
}
