import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type AlertCfg, getAlertCfg, setAlertCfg } from "../alerts";
import {
	dbStats,
	getAutoPurgeDays,
	purgeOlderThan,
	setAutoPurgeDays,
} from "../db";
import { saveText, stamp } from "../export";
import { getHourPref, type HourPref, is12h, setHourPref } from "../fmt";
import { t } from "../i18n";
import {
	applyRadioParams,
	applyTxPower,
	clearFixedPosition,
	device,
	exportConfigJson,
	exportPrivateKeyB64,
	genChannelSecret,
	importConfigJson,
	rebootRadio,
	refreshChannels,
	sendAdvert,
	setAdvertNameCfg,
	setChannelCfg,
	setFixedPosition,
} from "../radio";
import { getSnapshot, mutate, subscribe } from "../store";
import { setNetEnabled, useNetState } from "../net";
import {
	getHiContrast,
	getTheme,
	setHiContrast,
	setTheme,
	THEME_LABELS,
	THEMES,
	type Theme,
} from "../theme";

// MeshCore channels live in fixed slots on the radio; the companion protocol
// exposes at least these four.
const CHANNEL_SLOTS = [0, 1, 2, 3];

function Section(props: {
	title: string;
	children: React.ReactNode;
	onSave?: () => Promise<void>;
}) {
	const [msg, setMsg] = useState("");
	const [cls, setCls] = useState("");
	const [busy, setBusy] = useState(false);
	return (
		<div className="panel">
			<div className="panel-title">{props.title}</div>
			{props.children}
			{props.onSave && (
				<div className="panel-actions">
					<button
						className="primary"
						disabled={busy}
						onClick={async () => {
							setMsg(t("SAVING…"));
							setCls("warn");
							setBusy(true);
							try {
								// the radio's ack can get lost: don't hang the UI forever
								await Promise.race([
									props.onSave?.(),
									new Promise((_, rej) =>
										setTimeout(
											() =>
												rej(new Error(t("no response from the radio (20 s)"))),
											20_000,
										),
									),
								]);
								setMsg(t("Saved ✓"));
								setCls("");
							} catch (e) {
								setMsg(`ERROR: ${e instanceof Error ? e.message : e}`);
								setCls("err");
							} finally {
								setBusy(false);
							}
						}}
					>
						[ EXECUTE ]
					</button>
					<span className={cls} style={{ fontSize: 12 }}>
						{msg}
					</span>
				</div>
			)}
		</div>
	);
}

export default function Config() {
	const s = useSyncExternalStore(subscribe, getSnapshot);
	const self = s.selfInfo;

	const net = useNetState();
	const [advertName, setAdvertName] = useState("");
	// radio params round-trip the exact units SelfInfo reports
	const [freq, setFreq] = useState(0);
	const [bw, setBw] = useState(0);
	const [sf, setSf] = useState(0);
	const [cr, setCr] = useState(0);
	const [txp, setTxp] = useState(0);
	const [chNames, setChNames] = useState<Record<number, string>>({});
	const [chPsks, setChPsks] = useState<Record<number, string>>({}); // base64
	const [theme, setThemeSel] = useState<Theme>(getTheme);
	const [hc, setHcSel] = useState(getHiContrast);
	const [timeFmt, setTimeFmt] = useState<HourPref>(getHourPref);
	const [alerts, setAlerts] = useState<AlertCfg>(getAlertCfg);
	const saveAlerts = (patch: Partial<AlertCfg>) => {
		const next = { ...alerts, ...patch };
		setAlerts(next);
		setAlertCfg(next);
	};
	const [chMsg, setChMsg] = useState("");
	const [chCls, setChCls] = useState("");
	const [maint, setMaint] = useState("");
	const [rebootArm, setRebootArm] = useState(false);
	// database
	const [stats, setStats] = useState<{
		messages: number;
		telemetry: number;
		nodes: number;
	}>();
	const [purgeDays, setPurgeDays] = useState(30);
	const [purgeArm, setPurgeArm] = useState(false);
	const [autoPurge, setAutoPurge] = useState(getAutoPurgeDays);
	const [purgeMsg, setPurgeMsg] = useState("");
	// backup / import
	const [bkMsg, setBkMsg] = useState("");
	const [bkCls, setBkCls] = useState("");
	const [importPending, setImportPending] = useState("");
	// advert
	const [advMsg, setAdvMsg] = useState("");
	const [advCls, setAdvCls] = useState("");

	const [posLat, setPosLat] = useState("");
	const [posLon, setPosLon] = useState("");
	const [posMsg, setPosMsg] = useState("");
	const [posCls, setPosCls] = useState("");
	const [chJson, setChJson] = useState("");
	const [importMsg, setImportMsg] = useState("");
	const [importCls, setImportCls] = useState("");

	useEffect(() => {
		if (self) {
			setAdvertName(self.name);
			setFreq(self.radioFreq);
			setBw(self.radioBw);
			setSf(self.radioSf);
			setCr(self.radioCr);
			setTxp(self.txPower);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [self?.publicKey]);

	useEffect(() => {
		dbStats()
			.then(setStats)
			.catch(() => {});
		if (device) refreshChannels().catch(() => {});
	}, []);

	// The two 3 s "are you sure?" disarms. Leaving CONFIG while one is armed
	// used to leave a timer running against an unmounted screen.
	const purgeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const rebootTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	useEffect(
		() => () => {
			clearTimeout(purgeTimer.current);
			clearTimeout(rebootTimer.current);
		},
		[],
	);

	const onPurge = async () => {
		if (!purgeArm) {
			setPurgeArm(true);
			setPurgeMsg(t("press again to confirm"));
			clearTimeout(purgeTimer.current);
			purgeTimer.current = setTimeout(() => setPurgeArm(false), 3000);
			return;
		}
		clearTimeout(purgeTimer.current);
		setPurgeArm(false);
		const days = Math.max(1, purgeDays);
		try {
			const n = await purgeOlderThan(days);
			const cut = Date.now() - days * 86_400_000;
			mutate((st) => {
				st.messages = st.messages.filter((m) => m.ts >= cut);
			});
			setPurgeMsg(t("{0} rows deleted", n));
			setStats(await dbStats());
		} catch (e) {
			setPurgeMsg(`ERROR: ${e instanceof Error ? e.message : e}`);
		}
	};

	const saveUser = async () => {
		const name = advertName.trim();
		if (!name) throw new Error(t("the name cannot be empty"));
		await setAdvertNameCfg(name);
	};

	const saveRadio = async () => {
		if (!self) throw new Error(t("radio config not received yet"));
		await applyRadioParams(freq, bw, sf, cr);
		if (txp !== self.txPower) await applyTxPower(txp);
	};

	// Channel key in standard base64. Always 128 bits on MeshCore.
	const pskToB64 = (b?: Uint8Array) =>
		b && b.length ? btoa(String.fromCharCode(...b)) : "";
	const pskFromB64 = (str: string): Uint8Array => {
		const b64 = str.trim();
		const bytes = b64
			? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
			: new Uint8Array(0);
		if (bytes.length !== 16) {
			throw new Error(
				t("The key must be 16 base64 bytes ({0} bytes)", bytes.length),
			);
		}
		return bytes;
	};

	const onBackup = async () => {
		try {
			await saveText(`lilyshark-backup-${stamp()}.json`, exportConfigJson());
			setBkMsg(t("Backup downloaded ✓"));
			setBkCls("");
		} catch (e) {
			setBkMsg(`ERROR: ${e}`);
			setBkCls("err");
		}
	};

	const onRestore = async (file: File) => {
		setBkMsg("");
		try {
			const n = await importConfigJson(await file.text());
			setBkMsg(t("{0} settings applied ✓ (the node may reboot)", n));
			setBkCls("");
		} catch (e) {
			setBkMsg(`ERROR: ${e}`);
			setBkCls("err");
		}
	};

	const onExportKey = async () => {
		setBkMsg("");
		try {
			const b64 = await exportPrivateKeyB64();
			await saveText(`meshcore-privatekey-${stamp()}.txt`, b64);
			setBkMsg(t("Private key downloaded ✓"));
			setBkCls("");
		} catch (e) {
			setBkMsg(`ERROR: ${e}`);
			setBkCls("err");
		}
	};

	const saveChannel = async (index: number) => {
		setChMsg("");
		try {
			const cur = s.channels.get(index);
			const name = (chNames[index] ?? cur?.name ?? "").trim();
			const secret = pskFromB64(chPsks[index] ?? pskToB64(cur?.secret));
			await setChannelCfg(index, name, secret);
			setChMsg(t("Channel {0} saved ✓", index));
			setChCls("");
		} catch (e) {
			setChMsg(`ERROR: ${e instanceof Error ? e.message : e}`);
			setChCls("err");
		}
	};

	const genPsk = (index: number) => {
		setChPsks({ ...chPsks, [index]: pskToB64(genChannelSecret()) });
	};

	const onExportChannels = async () => {
		try {
			const json = JSON.stringify(
				{
					channels: [...s.channels.values()]
						.sort((a, b) => a.index - b.index)
						.map((ch) => ({
							index: ch.index,
							name: ch.name,
							secret: pskToB64(ch.secret),
						})),
				},
				null,
				2,
			);
			const f = `meshcore-channels-${stamp()}.json`;
			await saveText(f, json);
			setImportMsg(t("EXPORTED → {0}", f));
			setImportCls("");
		} catch (e) {
			setImportMsg(`ERROR: ${e}`);
			setImportCls("err");
		}
	};

	const parseChannelJson = (raw: string) => {
		const data = JSON.parse(raw) as {
			channels?: { index: number; name: string; secret: string }[];
		};
		if (!Array.isArray(data.channels) || data.channels.length === 0) {
			throw new Error(t("the JSON carries no channels"));
		}
		return data.channels;
	};

	const onImportChannels = async () => {
		setImportMsg("");
		// 1st click: show what the JSON brings; 2nd click: apply
		if (!importPending) {
			try {
				const chans = parseChannelJson(chJson);
				const names = chans
					.map((c) => c.name || t("Channel {0}", c.index))
					.join(", ");
				setImportPending(chJson);
				setImportMsg(
					t("Will overwrite {0} channels ({1})", chans.length, names) +
						t(". Press CONFIRM."),
				);
				setImportCls("warn");
			} catch (e) {
				setImportMsg(`ERROR: ${e}`);
				setImportCls("err");
			}
			return;
		}
		try {
			const chans = parseChannelJson(importPending);
			let n = 0;
			for (const c of chans) {
				await setChannelCfg(c.index, c.name, pskFromB64(c.secret));
				n++;
			}
			setImportMsg(t("{0} channels imported ✓", n));
			setImportCls("");
			setChJson("");
		} catch (e) {
			setImportMsg(`ERROR: ${e}`);
			setImportCls("err");
		} finally {
			setImportPending("");
		}
	};

	const onReboot = async () => {
		if (!rebootArm) {
			setRebootArm(true);
			setMaint(t("press again to confirm"));
			clearTimeout(rebootTimer.current);
			rebootTimer.current = setTimeout(() => setRebootArm(false), 3000);
			return;
		}
		clearTimeout(rebootTimer.current);
		setRebootArm(false);
		try {
			await rebootRadio();
			setMaint(t("REBOOT sent · ~8 s offline"));
		} catch (e) {
			setMaint(`ERROR: ${e}`);
		}
	};

	return (
		<main style={{ overflowY: "auto", alignItems: "start" }}>
			<div className="cfg-grid">
				<div className="cfg-col">
					<Section title="CONFIG // NET RELAY">
						<div className="form-grid">
							<label>RELAY</label>
							<select
								value={net.enabled ? "on" : "off"}
								style={{ width: 140 }}
								onChange={(e) => setNetEnabled(e.target.value === "on")}
							>
								<option value="on">ON</option>
								<option value="off">OFF</option>
							</select>
							<label>STATUS</label>
							<span className={net.enabled && !net.connected ? "warn" : ""}>
								{!net.enabled
									? "OFF"
									: net.connected
										? `CONNECTED · ${net.via.toUpperCase()} · ROOM ${net.room} · ${net.published} SENT / ${net.received} HEARD`
										: "CONNECTING…"}
							</span>
						</div>
						<div className="hint">
							Frames your deck hears are shared with other Lilyshark analyzers
							over the internet, and theirs appear here and on your deck marked
							NET. The default room is public — the same standing as the
							LongFast radio channel it mirrors. Turn it off and the mesh is
							radio-only.
						</div>
					</Section>
					<Section title={t("CONFIG // APPLICATION")}>
						<div className="form-grid">
							<label>{t("TIME")}</label>
							<select
								value={timeFmt}
								style={{ width: 140 }}
								onChange={(e) => {
									const v = e.target.value as HourPref;
									setHourPref(v);
									setTimeFmt(v);
								}}
							>
								<option value="auto">
									{t("AUTOMATIC")} · {is12h() ? "12 H" : "24 H"}
								</option>
								<option value="24">24 H · 15:04</option>
								<option value="12">12 H · 3:04 PM</option>
							</select>
							<label>{t("COLOR")}</label>
							<div style={{ display: "flex", gap: 10, alignItems: "center" }}>
								<select
									value={theme}
									style={{ width: 140 }}
									onChange={(e) => {
										const v = e.target.value as Theme;
										setTheme(v);
										setThemeSel(v);
									}}
								>
									{(Object.keys(THEMES) as Theme[]).map((name) => (
										<option key={name} value={name}>
											{t(THEME_LABELS[name])}
										</option>
									))}
								</select>
								<label
									style={{
										display: "flex",
										gap: 6,
										alignItems: "center",
										whiteSpace: "nowrap",
									}}
									title={t("Same color, pure black background and a more vivid stroke")}
								>
									<input
										type="checkbox"
										checked={hc}
										style={{ width: "auto" }}
										onChange={(e) => {
											setHiContrast(e.target.checked);
											setHcSel(e.target.checked);
										}}
									/>
									{t("HIGH CONTRAST")}
								</label>
							</div>

							<label
								title={t("System notifications about nodes marked as favorites",
								)}
							>
								{t("FAVORITE ALERTS")}
							</label>
							<input
								type="checkbox"
								checked={alerts.on}
								style={{ justifySelf: "start", width: "auto" }}
								onChange={(e) => saveAlerts({ on: e.target.checked })}
							/>
							<label>{t("WARN BATTERY <")}</label>
							<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
								<input
									type="number"
									min={1}
									max={100}
									disabled={!alerts.on}
									value={alerts.battery}
									style={{ width: 80 }}
									onChange={(e) =>
										saveAlerts({ battery: Number(e.target.value) })
									}
								/>
								<span className="dim">%</span>
							</div>
							<label>{t("WARN NO SIGNAL")}</label>
							<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
								<input
									type="number"
									min={1}
									disabled={!alerts.on}
									value={alerts.silentH}
									style={{ width: 80 }}
									onChange={(e) =>
										saveAlerts({ silentH: Number(e.target.value) })
									}
								/>
								<span className="dim">{t("h")}</span>
							</div>
							<label
								title={t("Warns before the battery is low, based on the discharge rate. 0 = no warning",
								)}
							>
								{t("WARN RUNTIME <")}
							</label>
							<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
								<input
									type="number"
									min={0}
									disabled={!alerts.on}
									value={alerts.runtimeH}
									style={{ width: 80 }}
									onChange={(e) =>
										saveAlerts({ runtimeH: Number(e.target.value) })
									}
								/>
								<span className="dim">{t("h")}</span>
							</div>
						</div>
						<p className="dim" style={{ padding: "0 14px 12px", fontSize: 11 }}>
							{t("Only warns about nodes marked ★ in NODES, and at most once every 6 h per node and reason.",
							)}
						</p>
					</Section>

					<Section title={t("CONFIG // USER")} onSave={saveUser}>
						<div className="form-grid">
							<label>{t("ADVERT NAME")}</label>
							<input
								value={advertName}
								maxLength={31}
								onChange={(e) => setAdvertName(e.target.value)}
							/>
							<label>{t("NODE ID")}</label>
							<span className="dim" title={self?.publicKey ?? ""}>
								{self
									? `${self.publicKey.slice(0, 16)}… · ${t("READ ONLY")}`
									: "—"}
							</span>
						</div>
					</Section>

					<Section title="CONFIG // RADIO" onSave={saveRadio}>
						<div className="form-grid">
							<label>FREQ (kHz)</label>
							<input
								type="number"
								min={0}
								value={freq}
								style={{ width: 120 }}
								onChange={(e) => setFreq(Number(e.target.value))}
							/>
							<label>BW</label>
							<input
								type="number"
								min={0}
								value={bw}
								style={{ width: 120 }}
								onChange={(e) => setBw(Number(e.target.value))}
							/>
							<label>SF</label>
							<input
								type="number"
								min={5}
								max={12}
								value={sf}
								style={{ width: 70 }}
								onChange={(e) => setSf(Number(e.target.value))}
							/>
							<label>CR</label>
							<input
								type="number"
								min={5}
								max={8}
								value={cr}
								style={{ width: 70 }}
								onChange={(e) => setCr(Number(e.target.value))}
							/>
							<label>TX POWER (dBm)</label>
							<input
								type="number"
								min={0}
								max={self?.maxTxPower || 30}
								value={txp}
								style={{ width: 70 }}
								onChange={(e) => setTxp(Number(e.target.value))}
							/>
						</div>
						<p className="dim" style={{ padding: "0 14px 12px", fontSize: 11 }}>
							{t("Changing FREQ/BW/SF/CR moves you off your mesh preset: only nodes with the same radio parameters can hear each other.",
							)}
						</p>
					</Section>
				</div>
				<div className="cfg-col">
					<Section title={t("CONFIG // FIXED POSITION")}>
						<div
							style={{
								padding: 14,
								display: "flex",
								flexDirection: "column",
								gap: 10,
								fontSize: 12,
							}}
						>
							<span className="dim">
								{t("For nodes without GPS: the firmware broadcasts this position to the mesh.",
								)}
							</span>
							<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
								<label>LAT</label>
								<input
									placeholder={self?.advLat ? String(self.advLat) : "37.4419"}
									value={posLat}
									style={{ width: 120 }}
									onChange={(e) => setPosLat(e.target.value)}
								/>
								<label>LON</label>
								<input
									placeholder={self?.advLon ? String(self.advLon) : "-122.1430"}
									value={posLon}
									style={{ width: 120 }}
									onChange={(e) => setPosLon(e.target.value)}
								/>
								<button
									className="primary"
									disabled={!posLat.trim() || !posLon.trim()}
									onClick={async () => {
										setPosMsg("");
										const lat = Number(posLat.replace(",", "."));
										const lon = Number(posLon.replace(",", "."));
										if (
											!Number.isFinite(lat) ||
											!Number.isFinite(lon) ||
											Math.abs(lat) > 90 ||
											Math.abs(lon) > 180
										) {
											setPosMsg(t("ERROR: invalid coordinates"));
											setPosCls("err");
											return;
										}
										try {
											await setFixedPosition(lat, lon);
											setPosMsg(t("Fixed position sent ✓"));
											setPosCls("");
										} catch (e) {
											setPosMsg(`ERROR: ${e}`);
											setPosCls("err");
										}
									}}
								>
									{t("SET")}
								</button>
								<button
									onClick={async () => {
										setPosMsg("");
										try {
											await clearFixedPosition();
											setPosMsg(t("Fixed position cleared ✓"));
											setPosCls("");
										} catch (e) {
											setPosMsg(`ERROR: ${e}`);
											setPosCls("err");
										}
									}}
								>
									{t("CLEAR")}
								</button>
							</div>
							{posMsg && (
								<span className={posCls} style={{ fontSize: 11 }}>
									{posMsg}
								</span>
							)}
						</div>
					</Section>

					<Section title={t("CONFIG // CHANNELS")}>
						<div
							style={{
								padding: 14,
								display: "flex",
								flexDirection: "column",
								gap: 8,
								fontSize: 12,
							}}
						>
							<div
								style={{
									display: "flex",
									gap: 8,
									alignItems: "center",
									borderBottom: "1px solid var(--border)",
									paddingBottom: 10,
									marginBottom: 2,
								}}
							>
								<input
									placeholder={t("PASTE exported channels JSON…")}
									value={chJson}
									style={{ flex: 1 }}
									onChange={(e) => {
										setChJson(e.target.value);
										setImportPending(""); // JSON changed → invalidates the confirmation
									}}
								/>
								<button
									className="primary"
									disabled={!chJson.trim()}
									onClick={onImportChannels}
								>
									{importPending ? t("CONFIRM") : t("IMPORT")}
								</button>
							</div>
							{importMsg && (
								<span className={importCls || "warn"} style={{ fontSize: 11 }}>
									{importMsg}
								</span>
							)}
							<div
								style={{
									display: "flex",
									gap: 8,
									alignItems: "center",
									borderBottom: "1px solid var(--border)",
									paddingBottom: 10,
									marginBottom: 2,
								}}
							>
								<button
									className="primary"
									disabled={s.channels.size === 0}
									onClick={onExportChannels}
								>
									{t("EXPORT JSON")}
								</button>
								<span className="dim" style={{ fontSize: 11 }}>
									{t("channels travel with their key: share with care")}
								</span>
							</div>
							{chMsg && (
								<span className={chCls || "warn"} style={{ fontSize: 11 }}>
									{chMsg}
								</span>
							)}
							{CHANNEL_SLOTS.map((index) => {
								const ch = s.channels.get(index);
								return (
									<div
										key={index}
										className={ch ? "" : "dim"}
										style={{
											display: "flex",
											flexDirection: "column",
											gap: 6,
											border: "1px solid var(--border)",
											padding: "6px 10px",
										}}
									>
										<div
											style={{ display: "flex", alignItems: "center", gap: 10 }}
										>
											<span style={{ fontWeight: 700 }}>{index}</span>
											<input
												placeholder={
													index === 0 ? "public" : t("— free slot —")
												}
												value={chNames[index] ?? ch?.name ?? ""}
												style={{
													flex: 1,
													border: "none",
													background: "transparent",
												}}
												onChange={(e) =>
													setChNames({ ...chNames, [index]: e.target.value })
												}
											/>
											<button onClick={() => saveChannel(index)}>
												{t("SAVE")}
											</button>
										</div>
										<div
											style={{ display: "flex", alignItems: "center", gap: 8 }}
										>
											<span
												className="dim"
												style={{ fontSize: 10, letterSpacing: 1 }}
											>
												PSK
											</span>
											<input
												placeholder={t("— no key —")}
												value={chPsks[index] ?? pskToB64(ch?.secret)}
												style={{ flex: 1, fontFamily: "inherit", fontSize: 11 }}
												onChange={(e) =>
													setChPsks({ ...chPsks, [index]: e.target.value })
												}
											/>
											<button
												title={t("Generate a random 128-bit key")}
												onClick={() => genPsk(index)}
											>
												GEN
											</button>
										</div>
									</div>
								);
							})}
						</div>
					</Section>
				</div>
				<div className="cfg-col">
					<Section title={t("MODULE // ADVERT")}>
						<div
							style={{
								padding: 14,
								display: "flex",
								flexDirection: "column",
								gap: 10,
								fontSize: 12,
							}}
						>
							<span className="dim">
								{t("An advert announces your node to the mesh. ZERO HOP reaches only direct neighbors; FLOOD is repeated by repeaters and crosses the whole mesh.",
								)}
							</span>
							<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
								<button
									className="primary"
									onClick={() => {
										setAdvMsg("");
										sendAdvert(true)
											.then(() => {
												setAdvMsg(t("Advert sent ✓"));
												setAdvCls("");
											})
											.catch((e) => {
												setAdvMsg(`ERROR: ${e}`);
												setAdvCls("err");
											});
									}}
								>
									[ FLOOD ADVERT ]
								</button>
								<button
									onClick={() => {
										setAdvMsg("");
										sendAdvert(false)
											.then(() => {
												setAdvMsg(t("Advert sent ✓"));
												setAdvCls("");
											})
											.catch((e) => {
												setAdvMsg(`ERROR: ${e}`);
												setAdvCls("err");
											});
									}}
								>
									[ ZERO HOP ]
								</button>
							</div>
							{advMsg && (
								<span className={advCls} style={{ fontSize: 11 }}>
									{advMsg}
								</span>
							)}
						</div>
					</Section>

					<Section title={t("CONFIG // DEVICE")}>
						<div className="form-grid">
							<label>{t("MODEL")}</label>
							<span className="dim">{s.deviceInfo?.model || "—"}</span>
							<label>FIRMWARE</label>
							<span className="dim">
								{s.deviceInfo
									? `v${s.deviceInfo.firmwareVer} · ${s.deviceInfo.buildDate}`
									: "—"}
							</span>
							<label>{t("BATTERY")}</label>
							<span className="dim">
								{s.deviceInfo?.batteryMv !== undefined
									? `${s.deviceInfo.batteryMv} mV`
									: "—"}
							</span>
						</div>
						<div
							style={{
								padding: "0 14px 14px",
								display: "flex",
								flexDirection: "column",
								gap: 10,
								fontSize: 12,
							}}
						>
							<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
								<button
									className="primary"
									style={{ width: 180 }}
									onClick={onReboot}
								>
									{rebootArm ? t("[ SURE? ]") : "[ REBOOT ]"}
								</button>
								<span className="dim">
									{t("reboots the device · ~8 s offline")}
								</span>
							</div>
							{maint && <span className="warn">{maint}</span>}
						</div>
					</Section>

					<Section title={t("CONFIG // BACKUP")}>
						<div
							style={{
								padding: 14,
								display: "flex",
								flexDirection: "column",
								gap: 10,
								fontSize: 12,
							}}
						>
							<span className="dim">
								{t("Full node config (name, radio and channels with keys) to JSON.",
								)}
							</span>
							<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
								<button className="primary" onClick={onBackup}>
									{t("SAVE BACKUP")}
								</button>
								<label
									className="btn"
									style={{
										border: "1px solid var(--border)",
										padding: "4px 10px",
										cursor: "pointer",
									}}
								>
									{t("RESTORE…")}
									<input
										type="file"
										accept=".json,application/json"
										style={{ display: "none" }}
										onChange={(e) => {
											const f = e.target.files?.[0];
											if (f) onRestore(f);
											e.target.value = "";
										}}
									/>
								</label>
								<button onClick={onExportKey}>
									{t("EXPORT PRIVATE KEY")}
								</button>
							</div>
							<span className="dim err" style={{ fontSize: 11 }}>
								{t("The private key IS the node's identity: whoever holds it can impersonate it. Store it encrypted.",
								)}
							</span>
							{bkMsg && (
								<span className={bkCls} style={{ fontSize: 11 }}>
									{bkMsg}
								</span>
							)}
						</div>
					</Section>

					<Section title={t("CONFIG // DATABASE")}>
						<div
							style={{
								padding: 14,
								display: "flex",
								flexDirection: "column",
								gap: 10,
								fontSize: 12,
							}}
						>
							<span className="dim">
								{stats
									? t("{0} messages · {1} telemetry samples · {2} nodes",
											stats.messages,
											stats.telemetry,
											stats.nodes,
										)
									: t("reading…")}
							</span>
							<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
								<span>{t("delete anything older than")}</span>
								<input
									type="number"
									min={1}
									value={purgeDays}
									style={{ width: 80 }}
									onChange={(e) => {
										setPurgeDays(Number(e.target.value));
										setPurgeArm(false);
									}}
								/>
								<span>{t("days")}</span>
								<button
									className="danger"
									style={{ width: 180 }}
									onClick={onPurge}
								>
									{purgeArm ? t("[ SURE? ]") : t("[ PURGE ]")}
								</button>
							</div>
							<span className="dim">
								{t("affects messages and telemetry · nodes are untouched")}
							</span>
							{purgeMsg && <span className="warn">{purgeMsg}</span>}
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 12,
									borderTop: "1px solid var(--border)",
									paddingTop: 10,
								}}
							>
								<label
									style={{ display: "flex", alignItems: "center", gap: 6 }}
								>
									<input
										type="checkbox"
										checked={autoPurge > 0}
										onChange={(e) => {
											const v = e.target.checked ? purgeDays : 0;
											setAutoPurge(v);
											setAutoPurgeDays(v);
										}}
									/>
									{t("PURGE ON STARTUP")}
								</label>
								<input
									type="number"
									min={1}
									disabled={autoPurge === 0}
									value={autoPurge || purgeDays}
									style={{ width: 80 }}
									onChange={(e) => {
										const v = Number(e.target.value);
										setAutoPurge(v);
										setAutoPurgeDays(v);
									}}
								/>
								<span>{t("days")}</span>
							</div>
						</div>
					</Section>
				</div>
			</div>
		</main>
	);
}
