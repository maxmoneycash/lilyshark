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
import "./config.css";

// MeshCore channels live in fixed slots on the radio; the companion protocol
// exposes at least these four.
const CHANNEL_SLOTS = [0, 1, 2, 3];

function Section(props: {
	title: string;
	children: React.ReactNode;
	onSave?: () => Promise<void>;
	saveLabel?: string;
}) {
	const [msg, setMsg] = useState("");
	const [cls, setCls] = useState("");
	const [busy, setBusy] = useState(false);
	return (
		<div className="panel">
			<h2 className="panel-title">{props.title}</h2>
			{props.children}
			{props.onSave && (
				<div className="panel-actions">
					<button
						type="button"
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
								setMsg(t("Saved"));
								setCls("");
							} catch (e) {
								setMsg(`ERROR: ${e instanceof Error ? e.message : e}`);
								setCls("err");
							} finally {
								setBusy(false);
							}
						}}
					>
						{props.saveLabel ?? t("SAVE")}
					</button>
					<span className={cls} role="status">
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
	const backupFile = useRef<HTMLInputElement>(null);
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
			setBkMsg(t("Backup downloaded"));
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
			setBkMsg(t("{0} settings applied (the node may reboot)", n));
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
			setBkMsg(t("Private key downloaded"));
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
			setChMsg(t("Channel {0} saved", index));
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
			setImportMsg(t("{0} channels imported", n));
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
		<main className="config-screen">
			<div className="cfg-grid">
				<div className="cfg-col">
					<Section title="CONFIG // NET RELAY">
						<div className="form-grid">
							<label htmlFor="cfg-relay">RELAY</label>
							<select
								id="cfg-relay"
								value={net.enabled ? "on" : "off"}
								onChange={(e) => setNetEnabled(e.target.value === "on")}
							>
								<option value="on">ON</option>
								<option value="off">OFF</option>
							</select>
							<span className="cfg-label">STATUS</span>
							<span className={net.enabled && !net.connected ? "warn" : "cfg-relay-status"} title={net.connected ? net.via : undefined}>
								{!net.enabled
									? "OFF"
									: net.connected
										? <><span>CONNECTED · {net.room}</span><span className="dim">{net.published} SENT / {net.received} HEARD</span></>
										: "CONNECTING…"}
							</span>
						</div>
						<p className="cfg-help">
							Share received packets over the internet with other Lilyshark
							analyzers. Remote packets are marked NET. The default room is public.
						</p>
					</Section>
					<Section title={t("CONFIG // APPLICATION")}>
						<div className="form-grid">
							<label htmlFor="cfg-time">{t("TIME")}</label>
							<select
								id="cfg-time"
								value={timeFmt}
								onChange={(e) => {
									const v = e.target.value as HourPref;
									setHourPref(v);
									setTimeFmt(v);
								}}
							>
								<option value="auto">
									{t("AUTO")} · {is12h() ? "12 H" : "24 H"}
								</option>
								<option value="24">24 H · 15:04</option>
								<option value="12">12 H · 3:04 PM</option>
							</select>
							<label htmlFor="cfg-theme">{t("COLOR")}</label>
							<div className="cfg-appearance">
								<select
									id="cfg-theme"
									value={theme}
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
									className="cfg-check"
									title={t(
										"Same color, pure black background and a more vivid stroke",
									)}
								>
									<input
										type="checkbox"
										checked={hc}
										onChange={(e) => {
											setHiContrast(e.target.checked);
											setHcSel(e.target.checked);
										}}
									/>
									{t("HIGH CONTRAST")}
								</label>
							</div>

							<span
								className="cfg-label"
								title={t(
									"System notifications about nodes marked as favorites",
								)}
							>
								{t("FAVORITE ALERTS")}
							</span>
							<label className="cfg-check" htmlFor="cfg-alerts">
								<input
									id="cfg-alerts"
									type="checkbox"
									checked={alerts.on}
									onChange={(e) => saveAlerts({ on: e.target.checked })}
								/>
								{t("ON")}
							</label>
							<label htmlFor="cfg-battery">{t("BATTERY BELOW")}</label>
							<div className="cfg-unit-field">
								<input
									id="cfg-battery"
									type="number"
									min={1}
									max={100}
									disabled={!alerts.on}
									value={alerts.battery}
									onChange={(e) =>
										saveAlerts({ battery: Number(e.target.value) })
									}
								/>
								<span className="dim">%</span>
							</div>
							<label htmlFor="cfg-silence">{t("SILENT FOR")}</label>
							<div className="cfg-unit-field">
								<input
									id="cfg-silence"
									type="number"
									min={1}
									disabled={!alerts.on}
									value={alerts.silentH}
									onChange={(e) =>
										saveAlerts({ silentH: Number(e.target.value) })
									}
								/>
								<span className="dim">{t("h")}</span>
							</div>
							<label
								htmlFor="cfg-runtime"
								title={t(
									"Warns before the battery is low, based on the discharge rate. 0 = no warning",
								)}
							>
								{t("RUNTIME BELOW")}
							</label>
							<div className="cfg-unit-field">
								<input
									id="cfg-runtime"
									type="number"
									min={0}
									disabled={!alerts.on}
									value={alerts.runtimeH}
									onChange={(e) =>
										saveAlerts({ runtimeH: Number(e.target.value) })
									}
								/>
								<span className="dim">{t("h")}</span>
							</div>
						</div>
						<p className="cfg-help">
							{t(
								"Alerts cover favorite nodes. Each warning repeats at most once every 6 hours per node.",
							)}
						</p>
					</Section>

					<Section
						title={t("CONFIG // USER")}
						onSave={saveUser}
						saveLabel={t("SAVE NAME")}
					>
						<div className="form-grid">
							<label htmlFor="cfg-advert-name">{t("ADVERT NAME")}</label>
							<input
								id="cfg-advert-name"
								value={advertName}
								maxLength={31}
								onChange={(e) => setAdvertName(e.target.value)}
							/>
							<span className="cfg-label">{t("NODE ID")}</span>
							<span className="dim" title={self?.publicKey ?? ""}>
								{self
									? `${self.publicKey.slice(0, 16)}… · ${t("READ ONLY")}`
									: "—"}
							</span>
						</div>
					</Section>

					<Section
						title="CONFIG // RADIO"
						onSave={saveRadio}
						saveLabel={t("SAVE RADIO")}
					>
						<div className="form-grid">
							<label htmlFor="cfg-frequency">FREQ (kHz)</label>
							<input
								id="cfg-frequency"
								type="number"
								min={0}
								value={freq}
								onChange={(e) => setFreq(Number(e.target.value))}
							/>
							<label htmlFor="cfg-bandwidth" title="Bandwidth">
								BW
							</label>
							<input
								id="cfg-bandwidth"
								aria-label="Bandwidth"
								type="number"
								min={0}
								value={bw}
								onChange={(e) => setBw(Number(e.target.value))}
							/>
							<label htmlFor="cfg-spreading-factor" title="Spreading factor">
								SF
							</label>
							<input
								id="cfg-spreading-factor"
								aria-label="Spreading factor"
								type="number"
								min={5}
								max={12}
								value={sf}
								onChange={(e) => setSf(Number(e.target.value))}
							/>
							<label htmlFor="cfg-coding-rate" title="Coding rate">
								CR
							</label>
							<input
								id="cfg-coding-rate"
								aria-label="Coding rate"
								type="number"
								min={5}
								max={8}
								value={cr}
								onChange={(e) => setCr(Number(e.target.value))}
							/>
							<label htmlFor="cfg-tx-power">TX POWER (dBm)</label>
							<input
								id="cfg-tx-power"
								type="number"
								min={0}
								max={self?.maxTxPower || 30}
								value={txp}
								onChange={(e) => setTxp(Number(e.target.value))}
							/>
						</div>
						<p className="cfg-help">
							{t(
								"To hear each other, nodes need matching frequency, bandwidth (BW), spreading factor (SF), and coding rate (CR).",
							)}
						</p>
					</Section>
				</div>
				<div className="cfg-col">
					<Section title={t("CONFIG // FIXED POSITION")}>
						<div className="cfg-body">
							<span className="dim">
								{t(
									"For nodes without GPS: the firmware broadcasts this position to the mesh.",
								)}
							</span>
							<div className="cfg-coordinates">
								<label>
									LATITUDE
									<input
										placeholder={self?.advLat ? String(self.advLat) : "37.4419"}
										value={posLat}
										onChange={(e) => setPosLat(e.target.value)}
									/>
								</label>
								<label>
									LONGITUDE
									<input
										placeholder={
											self?.advLon ? String(self.advLon) : "-122.1430"
										}
										value={posLon}
										onChange={(e) => setPosLon(e.target.value)}
									/>
								</label>
							</div>
							<div className="cfg-actions">
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
											setPosMsg(t("Fixed position sent"));
											setPosCls("");
										} catch (e) {
											setPosMsg(`ERROR: ${e}`);
											setPosCls("err");
										}
									}}
								>
									{t("SET POSITION")}
								</button>
								<button
									onClick={async () => {
										setPosMsg("");
										try {
											await clearFixedPosition();
											setPosMsg(t("Fixed position cleared"));
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
								<span className={posCls} role="status">
									{posMsg}
								</span>
							)}
						</div>
					</Section>

					<Section title={t("CONFIG // CHANNELS")}>
						<div className="cfg-body">
							<div className="cfg-toolbar">
								<input
									aria-label={t("Channels JSON")}
									placeholder={t("Paste JSON")}
									value={chJson}
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
								<span className={importCls || "warn"} role="status">
									{importMsg}
								</span>
							)}
							<div className="cfg-toolbar">
								<button
									className="primary"
									disabled={s.channels.size === 0}
									onClick={onExportChannels}
								>
									{t("EXPORT JSON")}
								</button>
								<span className="dim">
									{t(
										"Includes channel keys. Share only with people joining your channels.",
									)}
								</span>
							</div>
							{chMsg && (
								<span className={chCls || "warn"} role="status">
									{chMsg}
								</span>
							)}
							{CHANNEL_SLOTS.map((index) => {
								const ch = s.channels.get(index);
								return (
									<div key={index} className={`cfg-channel${ch ? "" : " dim"}`}>
										<div className="cfg-channel-row">
											<span className="cfg-channel-index" aria-hidden="true">
												{index}
											</span>
											<input
												className="cfg-channel-name"
												aria-label={t("Channel {0} name", index)}
												placeholder={
													index === 0 ? "public" : t("— free slot —")
												}
												value={chNames[index] ?? ch?.name ?? ""}
												onChange={(e) =>
													setChNames({ ...chNames, [index]: e.target.value })
												}
											/>
											<button
												aria-label={t("Save channel {0}", index)}
												onClick={() => saveChannel(index)}
											>
												{t("SAVE")}
											</button>
										</div>
										<div className="cfg-channel-row">
											<label
												className="dim"
												htmlFor={`cfg-channel-key-${index}`}
											>
												PSK
											</label>
											<input
												id={`cfg-channel-key-${index}`}
												aria-label={t(
													"Channel {0} pre-shared key (base64)",
													index,
												)}
												spellCheck={false}
												autoCapitalize="off"
												autoCorrect="off"
												placeholder={t("— no key —")}
												value={chPsks[index] ?? pskToB64(ch?.secret)}
												onChange={(e) =>
													setChPsks({ ...chPsks, [index]: e.target.value })
												}
											/>
											<button
												title={t("Generate a random 128-bit key")}
												aria-label={t("Generate key for channel {0}", index)}
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
						<div className="cfg-body">
							<span className="dim">
								{t(
									"Announce your node to the mesh. ZERO HOP reaches direct neighbors; FLOOD ADVERT travels through repeaters.",
								)}
							</span>
							<div className="cfg-actions">
								<button
									className="primary"
									onClick={() => {
										setAdvMsg("");
										sendAdvert(true)
											.then(() => {
												setAdvMsg(t("Advert sent"));
												setAdvCls("");
											})
											.catch((e) => {
												setAdvMsg(`ERROR: ${e}`);
												setAdvCls("err");
											});
									}}
								>
									FLOOD ADVERT
								</button>
								<button
									onClick={() => {
										setAdvMsg("");
										sendAdvert(false)
											.then(() => {
												setAdvMsg(t("Advert sent"));
												setAdvCls("");
											})
											.catch((e) => {
												setAdvMsg(`ERROR: ${e}`);
												setAdvCls("err");
											});
									}}
								>
									ZERO HOP
								</button>
							</div>
							{advMsg && (
								<span className={advCls} role="status">
									{advMsg}
								</span>
							)}
						</div>
					</Section>

					<Section title={t("CONFIG // DEVICE")}>
						<div className="form-grid">
							<span className="cfg-label">{t("MODEL")}</span>
							<span className="dim">{s.deviceInfo?.model || "—"}</span>
							<span className="cfg-label">FIRMWARE</span>
							<span className="dim">
								{s.deviceInfo
									? `v${s.deviceInfo.firmwareVer} · ${s.deviceInfo.buildDate}`
									: "—"}
							</span>
							<span className="cfg-label">{t("BATTERY")}</span>
							<span className="dim">
								{s.deviceInfo?.batteryMv !== undefined
									? `${s.deviceInfo.batteryMv} mV`
									: "—"}
							</span>
						</div>
						<div className="cfg-body cfg-body-continued">
							<div className="cfg-actions">
								<button className="primary" onClick={onReboot}>
									{rebootArm ? t("CONFIRM REBOOT") : t("REBOOT")}
								</button>
								<span className="dim">
									{t("Radio offline for about 8 seconds.")}
								</span>
							</div>
							{maint && (
								<span className="warn" role="status">
									{maint}
								</span>
							)}
						</div>
					</Section>

					<Section title={t("CONFIG // BACKUP")}>
						<div className="cfg-body">
							<span className="dim">
								{t(
									"Save the node name, radio settings, and channels with their keys as JSON.",
								)}
							</span>
							<div className="cfg-actions">
								<button className="primary" onClick={onBackup}>
									{t("SAVE BACKUP")}
								</button>
								<button onClick={() => backupFile.current?.click()}>
									{t("RESTORE…")}
								</button>
								<input
									ref={backupFile}
									type="file"
									accept=".json,application/json"
									hidden
									onChange={(e) => {
										const f = e.target.files?.[0];
										if (f) onRestore(f);
										e.target.value = "";
									}}
								/>
								<button onClick={onExportKey}>{t("EXPORT PRIVATE KEY")}</button>
							</div>
							<span className="dim">
								{t(
									"Your private key identifies your node. Anyone with the key can impersonate it; store it encrypted.",
								)}
							</span>
							{bkMsg && (
								<span className={bkCls} role="status">
									{bkMsg}
								</span>
							)}
						</div>
					</Section>

					<Section title={t("CONFIG // DATABASE")}>
						<div className="cfg-body">
							<span className="dim">
								{stats
									? t(
											"{0} messages · {1} telemetry samples · {2} nodes",
											stats.messages,
											stats.telemetry,
											stats.nodes,
										)
									: t("reading…")}
							</span>
							<div className="cfg-retention">
								<label htmlFor="cfg-purge-days">{t("DELETE OLDER THAN")}</label>
								<div className="cfg-unit-field">
									<input
										id="cfg-purge-days"
										type="number"
										min={1}
										value={purgeDays}
										onChange={(e) => {
											setPurgeDays(Number(e.target.value));
											setPurgeArm(false);
										}}
									/>
									<span>{t("days")}</span>
								</div>
								<button className="danger" onClick={onPurge}>
									{purgeArm ? t("CONFIRM PURGE") : t("PURGE")}
								</button>
							</div>
							<span className="dim">
								{t("Deletes stored messages and telemetry. Keeps nodes.")}
							</span>
							{purgeMsg && (
								<span className="warn" role="status">
									{purgeMsg}
								</span>
							)}
							<div className="cfg-auto-retention">
								<label className="cfg-check">
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
								<div className="cfg-unit-field">
									<input
										aria-label={t("Days to keep on startup")}
										type="number"
										min={1}
										disabled={autoPurge === 0}
										value={autoPurge || purgeDays}
										onChange={(e) => {
											const v = Number(e.target.value);
											setAutoPurge(v);
											setAutoPurgeDays(v);
										}}
									/>
									<span>{t("days")}</span>
								</div>
							</div>
						</div>
					</Section>
				</div>
			</div>
		</main>
	);
}
