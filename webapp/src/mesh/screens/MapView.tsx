import L from "leaflet";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import "leaflet/dist/leaflet.css";
import { DEMO_CENTER, isDemo } from "../demo";
import {
	contourIntervalForZoom,
	paintDarkContourTile,
	paintFieldChartTile,
	paintTerrariumContourPixels,
} from "../fieldChart";
import { ago, asciiBattery, dateTime, fmtHemisphere, useHourTick } from "../fmt";
import { t, useLangTick } from "../i18n";
import { useDeviceLink } from "../../lib/deviceLink";
import { deleteWaypoint, sendWaypoint } from "../radio";
import { getSnapshot, subscribe } from "../store";
import { SimulateBadge } from "../ThisDevice";
import { accent, fg, useThemeTick } from "../theme";

interface Draft {
	id?: number; // defined = editing
	lat: number;
	lon: number;
	name: string;
	desc: string;
	icon: string; // a single emoji
	expireH: number; // hours · 0 = never expires
}

export default function MapView({
	onOpenNode,
	focusNode,
}: {
	onOpenNode: (num: number) => void;
	focusNode?: number;
}) {
	const s = useSyncExternalStore(subscribe, getSnapshot);
	const deviceLink = useDeviceLink();
	const deviceFix =
		deviceLink.status === "linked" &&
		deviceLink.telemetry?.lat !== undefined &&
		deviceLink.telemetry.lon !== undefined &&
		(Math.abs(deviceLink.telemetry.lat) > 0.1 ||
			Math.abs(deviceLink.telemetry.lon) > 0.1)
			? { lat: deviceLink.telemetry.lat, lon: deviceLink.telemetry.lon }
			: undefined;
	// the markers are drawn with fg(): they have to be redrawn on a theme change
	const themeTick = useThemeTick();
	const timeFmt = useHourTick();
	const langTick = useLangTick();
	const divRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<L.Map | null>(null);
	const layerRef = useRef<L.LayerGroup | null>(null);
	const fittedRef = useRef(false);
	const focusedRef = useRef<number | undefined>(undefined);
	const [draft, setDraft] = useState<Draft>();
	const [wpMsg, setWpMsg] = useState("");
	const [filter, setFilter] = useState<"all" | "fav" | "active">("all");
	const [basemap, setBasemap] = useState<"sat" | "map" | "chart">("sat");
	const tileRef = useRef<L.Layer | null>(null);
	// The parent passes a fresh arrow on every render; going through a ref keeps
	// it out of the marker effect's deps without ever calling a stale one.
	const openNodeRef = useRef(onOpenNode);
	openNodeRef.current = onOpenNode;

	useEffect(() => {
		if (!divRef.current || mapRef.current) return;
		// Opens on Palo Alto, where the demo mesh lives. Real nodes override this
		// immediately via the fitBounds pass below, so this only decides what an
		// empty map looks like.
		// Canvas markers: with the neighbourhood layer the map draws dozens of
		// circle markers, and one canvas repaints far faster than that many
		// SVG elements -- most of the map's sluggishness was exactly this.
		const map = L.map(divRef.current, { zoomControl: true, preferCanvas: true }).setView(
			[DEMO_CENTER.lat, DEMO_CENTER.lon],
			12,
		);
		const tiles = L.tileLayer(
			"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
			{ attribution: "Esri" },
		).addTo(map);
		tileRef.current = tiles;
		layerRef.current = L.layerGroup().addTo(map);
		map.on("contextmenu", (e: L.LeafletMouseEvent) => {
			setWpMsg("");
			setDraft({
				lat: e.latlng.lat,
				lon: e.latlng.lng,
				name: "",
				desc: "",
				icon: "📍",
				expireH: 0,
			});
		});
		mapRef.current = map;
		// Leaflet caches the container size at creation; when the layout later
		// gives the map its real box (the phone window model does this after
		// mount), hit-testing runs against the stale size and taps land beside
		// the markers. Re-measure whenever the box changes.
		const ro = new ResizeObserver(() => map.invalidateSize());
		ro.observe(divRef.current);
		return () => {
			ro.disconnect();
			map.remove();
			mapRef.current = null;
			tileRef.current = null;
			fittedRef.current = false;
			// the new map starts blank: whatever was centered/fitted has to happen
			// again (StrictMode remounts twice in dev, and this ref outlives the map)
			focusedRef.current = undefined;
		};
	}, []);

	useEffect(() => {
		const map = mapRef.current;
		if (!map) return;
		if (tileRef.current) map.removeLayer(tileRef.current);
		// Every branch below builds the layer into `layer` and only then stores
		// it, so the basemap is provably non-null at the addTo. It used to
		// assign tileRef.current in each branch and call
		// `tileRef.current.addTo(map)` after -- which the compiler could not
		// prove, because a ref's field is not narrowed across the calls in
		// between. Getting that wrong leaves the map with no basemap at all,
		// which on this project reads as the blank map we have chased before.
		let layer: L.Layer;
		if (basemap === "chart") {
			const Chart = L.GridLayer.extend({
				createTile(coords: L.Coords) {
					const tile = document.createElement("canvas");
					tile.width = tile.height = 256;
					const ctx = tile.getContext("2d");
					if (ctx) paintFieldChartTile(ctx, coords.x, coords.y, coords.z, 256);
					return tile;
				},
			});
			layer = new (Chart as unknown as new (o: L.GridLayerOptions) => L.GridLayer)({
				attribution: "FIELD CHART",
			});
		} else if (basemap === "sat") {
			layer = L.tileLayer(
				"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
				{ attribution: "Esri" },
			);
		} else {
			const group = L.layerGroup();
			L.tileLayer(
				"https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
				{ attribution: "FIELD DARK" },
			).addTo(group);
			const Contours = L.GridLayer.extend({
				createTile(coords: L.Coords, done: (err: Error | null, tile: HTMLElement) => void) {
					const tile = document.createElement("canvas");
					tile.width = tile.height = 256;
					const ctx = tile.getContext("2d");
					const srcZ = Math.min(coords.z, 15);
					const shift = coords.z - srcZ;
					const srcX = coords.x >> shift;
					const srcY = coords.y >> shift;
					const url =
						`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${srcZ}/${srcX}/${srcY}.png`;
					fetch(url)
						.then((res) => {
							if (!res.ok) throw new Error("terrarium");
							return res.blob();
						})
						.then((blob) => createImageBitmap(blob))
						.then((bmp) => {
							if (!ctx) {
								done(null, tile);
								return;
							}
							const scratch = document.createElement("canvas");
							scratch.width = scratch.height = 256;
							const sctx = scratch.getContext("2d");
							if (!sctx) {
								done(null, tile);
								return;
							}
							if (shift === 0) {
								sctx.drawImage(bmp, 0, 0, 256, 256);
							} else {
								const q = 256 >> shift;
								const sx = (coords.x - (srcX << shift)) * q;
								const sy = (coords.y - (srcY << shift)) * q;
								sctx.drawImage(bmp, sx, sy, q, q, 0, 0, 256, 256);
							}
							const src = sctx.getImageData(0, 0, 256, 256);
							const out = ctx.createImageData(256, 256);
							paintTerrariumContourPixels(
								out.data,
								src.data,
								256,
								contourIntervalForZoom(coords.z),
							);
							ctx.putImageData(out, 0, 0);
							done(null, tile);
						})
						.catch(() => {
							if (ctx) {
								paintDarkContourTile(ctx, coords.x, coords.y, coords.z, 256);
							}
							done(null, tile);
						});
					return tile;
				},
			});
			new (Contours as unknown as new (o: L.GridLayerOptions) => L.GridLayer)({
				opacity: 0.9,
			}).addTo(group);
			layer = group;
		}
		tileRef.current = layer;
		layer.addTo(map);
	}, [basemap]);

	useEffect(() => {
		const layer = layerRef.current;
		const map = mapRef.current;
		if (!layer || !map) return;
		layer.clearLayers();

		const nowS = Date.now() / 1000;
		const positioned = [...s.nodes.values()].filter(
			(n) =>
				n.lat !== undefined &&
				n.lon !== undefined &&
				// junk GPS: positions stuck at (0,0)
				(Math.abs(n.lat) > 0.1 || Math.abs(n.lon) > 0.1) &&
				(filter === "all" ||
					(filter === "fav" && n.fav) ||
					(filter === "active" && nowS - n.lastHeard < 3600)),
		);

		// The firmware reduces position precision → MANY nodes share the exact
		// same coordinate and would be drawn on top of each other. One marker per
		// coordinate, with a counter and a popup listing every node at that point.
		const byCoord = new Map<string, typeof positioned>();
		for (const n of positioned) {
			const key = `${n.lat},${n.lon}`;
			const arr = byCoord.get(key) ?? [];
			arr.push(n);
			byCoord.set(key, arr);
		}

		const nodeRows = (n: (typeof positioned)[number]) =>
			`<div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0 2px;">` +
			`<span style="font-size:10px;letter-spacing:2px;opacity:.85;">${t("NODE")} // ${n.shortName}${n.viaNet ? " · NET" : ""}</span>` +
			`<button data-num="${n.num}" style="font-size:10px;padding:0 6px;">[ +INFO ]</button>` +
			`</div>` +
			`<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 12px;">` +
			`<span style="opacity:.85;">ID</span><span>!${n.num.toString(16)}</span>` +
			`<span style="opacity:.85;">SNR</span><span>${n.snr !== undefined ? `${n.snr.toFixed(2)} dB` : "—"}</span>` +
			`<span style="opacity:.85;">BAT</span><span>${asciiBattery(n.batteryLevel)}</span>` +
			`<span style="opacity:.85;">${t("SEEN")}</span><span title="${dateTime(n.lastHeard * 1000)}">${t("{0} ago", ago(n.lastHeard))}</span>` +
			`</div>`;

		for (const group of byCoord.values()) {
			const hasMe = group.some((n) => n.num === s.myNodeNum);
			// A marker every one of whose nodes arrived over the internet is a
			// rumour, and rumours are amber -- the same provenance colour the
			// deck itself uses for bridged traffic.
			const allNet = group.every((n) => n.viaNet);
			const color = hasMe ? accent() : allNet ? "#d99000" : fg();
			const lat = group[0].lat as number;
			const lon = group[0].lon as number;
			const label =
				group.length > 1
					? `${group[0].shortName} +${group.length - 1}`
					: group[0].shortName;
			// Popup built in the DOM (not a string) so the [+INFO] onclick can be attached
			const box = document.createElement("div");
			box.innerHTML =
				`<div style="font-size:10px;letter-spacing:2px;opacity:.85;">POS ${fmtHemisphere(lat, lon)} · ${group.length} ${t("NODE")}${group.length > 1 ? "S" : ""}</div>` +
				group.map(nodeRows).join("");
			for (const btn of box.querySelectorAll<HTMLButtonElement>(
				"button[data-num]",
			)) {
				btn.onclick = () => openNodeRef.current(Number(btn.dataset.num));
			}
			const marker = L.circleMarker([lat, lon], {
				radius: group.length > 1 ? 8 : 6,
				color,
				fillColor: color,
				fillOpacity: 0.85,
				weight: group.length > 1 ? 2 : 1,
			})
				.bindPopup(box, { maxHeight: 260 })
				.bindTooltip(label, { permanent: false, direction: "right" })
				.addTo(layer);

			// Arriving from a message "view on map": ring the node, center on it and
			// open its popup, once per focus value (don't re-center on store updates).
			if (focusNode !== undefined && group.some((n) => n.num === focusNode)) {
				L.circleMarker([lat, lon], {
					radius: 14,
					color,
					weight: 2,
					dashArray: "4 4",
					fill: false,
				}).addTo(layer);
				if (focusedRef.current !== focusNode) {
					focusedRef.current = focusNode;
					map.setView([lat, lon], 13);
					marker.openPopup();
					// fitBounds below runs in this same pass and would undo the centering
					fittedRef.current = true;
				}
			}
		}

		// Waypoints: emoji pin. Popup in the DOM (not HTML) so the edit/delete
		// buttons can be attached directly.
		for (const w of s.waypoints.values()) {
			const emoji = w.icon ? String.fromCodePoint(w.icon) : "📍";
			const box = document.createElement("div");
			box.innerHTML =
				`<div style="font-size:10px;letter-spacing:2px;opacity:.85;">WAYPOINT · ${fmtHemisphere(w.lat, w.lon)}</div>` +
				`<div style="font-weight:700;margin:4px 0;">${emoji} ${w.name || t("(unnamed)")}</div>` +
				(w.description
					? `<div style="margin-bottom:4px;">${w.description}</div>`
					: "") +
				`<div style="opacity:.85;font-size:11px;">${t("from {0}", getSnapshot().nodes.get(w.from)?.shortName ?? w.from.toString(16))}` +
				(w.expire
					? ` · ${t("expires {0}", dateTime(w.expire * 1000))}`
					: ` · ${t("no expiry")}`) +
				`</div>`;
			const row = document.createElement("div");
			row.style.cssText = "display:flex;gap:8px;margin-top:8px;";
			const edit = document.createElement("button");
			edit.textContent = t("[ EDIT ]");
			edit.onclick = () => {
				map.closePopup();
				setWpMsg("");
				setDraft({
					id: w.id,
					lat: w.lat,
					lon: w.lon,
					name: w.name,
					desc: w.description,
					icon: emoji,
					expireH: 0,
				});
			};
			const del = document.createElement("button");
			del.className = "danger";
			del.textContent = t("[ DELETE ]");
			del.onclick = () => {
				map.closePopup();
				deleteWaypoint(w.id).catch((e: unknown) => setWpMsg(`ERROR: ${e}`));
			};
			row.append(edit, del);
			box.append(row);
			L.marker([w.lat, w.lon], {
				icon: L.divIcon({
					className: "",
					html: `<div style="font-size:22px;line-height:22px;text-shadow:0 0 4px #000;">${emoji}</div>`,
					iconSize: [22, 22],
					iconAnchor: [11, 22],
				}),
			})
				.bindPopup(box)
				.bindTooltip(w.name || "waypoint", { direction: "top" })
				.addTo(layer);
		}

		if (deviceFix) {
			const color = accent();
			const box = document.createElement("div");
			box.innerHTML =
				`<div style="font-size:10px;letter-spacing:2px;opacity:.85;">THIS DEVICE</div>` +
				`<div style="font-weight:700;margin:4px 0;">LILYSHARK USB</div>` +
				`<div>${fmtHemisphere(deviceFix.lat, deviceFix.lon, 5, 5)}</div>` +
				`<div style="opacity:.85;margin-top:4px;">${deviceLink.telemetry?.gps ?? ""} · ${deviceLink.telemetry?.bat ?? ""}</div>` +
				(deviceLink.telemetry?.sim
					? `<div style="margin-top:4px;letter-spacing:1px;">SIMULATE MODE · SYNTHETIC</div>`
					: "");
			L.circleMarker([deviceFix.lat, deviceFix.lon], {
				radius: 9,
				color,
				fillColor: color,
				fillOpacity: 0.2,
				weight: 3,
				dashArray: "4 3",
			})
				.bindPopup(box)
				.bindTooltip("THIS DEVICE", {
					permanent: true,
					direction: "right",
				})
				.addTo(layer);
		}

		const fitPoints = [
			...positioned.map((n) => [n.lat as number, n.lon as number] as [number, number]),
			...(deviceFix ? ([[deviceFix.lat, deviceFix.lon]] as [number, number][]) : []),
		];
		if (!fittedRef.current && fitPoints.length > 0) {
			map.fitBounds(L.latLngBounds(fitPoints).pad(0.3));
			fittedRef.current = true;
		}
		// What the map is drawing is stated in the HUD below rather than logged:
		// writing to the store from inside a commit re-entered this same effect.
		// Only the slices this effect actually reads: keying it on the whole
		// snapshot rebuilt every marker on every packet, which closed any popup
		// the reader had open.
	}, [
		s.nodes,
		s.waypoints,
		s.myNodeNum,
		themeTick,
		timeFmt,
		langTick,
		filter,
		focusNode,
		deviceFix?.lat,
		deviceFix?.lon,
		deviceLink.telemetry?.gps,
		deviceLink.telemetry?.bat,
		deviceLink.telemetry?.sim,
	]);

	// A focused node must be visible: drop any active filter when one arrives
	useEffect(() => {
		if (focusNode !== undefined) setFilter("all");
	}, [focusNode]);

	const all = [...s.nodes.values()];
	const withFix = all.filter(
		(n) =>
			n.lat !== undefined &&
			n.lon !== undefined &&
			(Math.abs(n.lat) > 0.1 || Math.abs(n.lon) > 0.1),
	).length;
	const junk = all.filter(
		(n) =>
			n.lat !== undefined &&
			n.lon !== undefined &&
			Math.abs(n.lat) <= 0.1 &&
			Math.abs(n.lon) <= 0.1,
	).length;

	// What the marker pass just drew, stated on the map itself. The firmware
	// reduces position precision, so several nodes routinely land on one point;
	// showing both numbers is the only way to read a thin map correctly.
	const nowS = Date.now() / 1000;
	const drawn = all.filter(
		(n) =>
			n.lat !== undefined &&
			n.lon !== undefined &&
			(Math.abs(n.lat) > 0.1 || Math.abs(n.lon) > 0.1) &&
			(filter === "all" ||
				(filter === "fav" && n.fav) ||
				(filter === "active" && nowS - n.lastHeard < 3600)),
	);
	const points = new Set(drawn.map((n) => `${n.lat},${n.lon}`)).size;

	// map-main: on phones this screen becomes a full app-window (the page does
	// not scroll), so the map takes everything between header and footer and a
	// swipe pans the map instead of fighting the page.
	return (
		<main className="map-main">
			<div className="panel" style={{ flex: 1 }}>
				<div className="panel-title">
					<span>
						{t("PANEL // TACTICAL MAP")} · {t("{0} NODES", s.nodes.size)} ·{" "}
						{t("{0} WITH FIX", withFix)}
						{junk > 0 && ` · ${t("{0} DISCARDED (0,0)", junk)}`}
						{s.waypoints.size > 0 && ` · ${s.waypoints.size} WAYPOINTS`}
					</span>
					<span className="map-toolbar">
						<span className="map-chip-row">
							{(
								[
									["all", t("ALL")],
									["fav", t("★ FAV")],
									["active", t("ACTIVE 1H")],
								] as const
							).map(([key, label]) => (
								<button
									key={key}
									className={filter === key ? "primary" : ""}
									onClick={() => setFilter(key)}
								>
									{label}
								</button>
							))}
						</span>
						<span className="map-chip-row">
							{(
								[
									["sat", t("SAT I")],
									["map", t("MAP D")],
									["chart", t("CHT G")],
								] as const
							).map(([key, label]) => (
								<button
									key={key}
									className={basemap === key ? "primary" : ""}
									onClick={() => setBasemap(key)}
								>
									{label}
								</button>
							))}
						</span>
					</span>
				</div>
				<div className="map-wrap">
					<div ref={divRef} style={{ height: "100%" }} />
					{isDemo() && (
						<div className="panel map-wait">
							<div className="panel-title">DEMO MAP · PALO ALTO</div>
							<div className="map-wait-body">
								<p>
									These pins are invented. They are not your T-Deck. Your
									device last locked at a real GPS fix on its own screen.
									This website only plots that fix after USB says{" "}
									<strong>T-DECK LINKED</strong> and telemetry includes lat/lon.
								</p>
								<p>
									Press CONNECT in the header. Pick the T-Deck. The demo mesh
									clears. The map jumps to the coordinates on the device.
								</p>
							</div>
						</div>
					)}
					{deviceLink.status === "linked" && !deviceFix && (
						<div className="panel map-wait">
							<div className="panel-title">THIS T-DECK IS NOT ON THE MAP YET</div>
							<div className="map-wait-body">
								<p>
									USB is linked. The map will not invent a pin. It plots this
									radio only after GPS reads <strong>GPS FIX</strong> (not SEARCH).
								</p>
								<p>
									Right now: <strong>{deviceLink.telemetry?.gps ?? "GPS"}</strong>
									{deviceLink.telemetry?.sat !== undefined
										? ` · ${deviceLink.telemetry.sat} satellites`
										: ""}
									. Put this T-Deck by a window or outside, leave the USB
									link alone, and wait. A cold start after a flash can take a
									few minutes with sky.
								</p>
								<p>
									The second T-Deck shows up here only if this one hears it on
									the air (it must be transmitting Meshtastic, including a
									position). Two Lilyshark listeners do not see each other.
								</p>
							</div>
						</div>
					)}
					<div className="map-hud" style={{ right: 10, top: 8 }}>
						{t("{0} NODES · {1} POINTS", drawn.length, points)} ·{" "}
						{basemap === "sat"
							? "ESRI SAT"
							: basemap === "map"
								? "FIELD DARK"
								: "FIELD CHART"}
						{deviceLink.status === "linked" && !deviceFix && (
							<>
								{" · "}
								THIS DEVICE · {deviceLink.telemetry?.gps ?? "GPS"} ·{" "}
								{deviceLink.telemetry?.gps?.includes("SEARCH")
									? "WAITING FOR SATELLITES · NO MAP DOT UNTIL FIX"
									: "NO FIX · NO MAP DOT"}
							</>
						)}
						{deviceFix && (
							<>
								{" · "}
								THIS DEVICE
								<SimulateBadge on={deviceLink.telemetry?.sim} />
							</>
						)}
					</div>
					<div className="map-hud" style={{ left: 10, bottom: 10 }}>
						{wpMsg ||
							(deviceLink.status === "linked" && drawn.length === 0
								? "Listening. Your T-Deck plots when GPS has a fix. Other nodes plot when they transmit a position."
								: t("RIGHT CLICK = NEW WAYPOINT"))}
					</div>
					{draft && (
						<div
							className="panel"
							style={{
								position: "absolute",
								zIndex: 1000,
								right: 10,
								top: 34,
								width: 260,
								fontSize: 12,
							}}
						>
							<div className="panel-title">
								{draft.id ? t("EDIT WAYPOINT") : t("NEW WAYPOINT")}
							</div>
							<div
								style={{
									padding: 12,
									display: "flex",
									flexDirection: "column",
									gap: 8,
								}}
							>
								<span className="dim">
									{fmtHemisphere(draft.lat, draft.lon, 5, 5)}
								</span>
								<input
									placeholder={t("name")}
									maxLength={30}
									value={draft.name}
									onChange={(e) => setDraft({ ...draft, name: e.target.value })}
								/>
								<input
									placeholder={t("description")}
									maxLength={100}
									value={draft.desc}
									onChange={(e) => setDraft({ ...draft, desc: e.target.value })}
								/>
								<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
									<input
										style={{ width: 50, textAlign: "center" }}
										value={draft.icon}
										onChange={(e) =>
											setDraft({
												...draft,
												icon: [...e.target.value].pop() ?? "",
											})
										}
									/>
									<input
										type="number"
										min={0}
										style={{ width: 70 }}
										value={draft.expireH}
										onChange={(e) =>
											setDraft({ ...draft, expireH: Number(e.target.value) })
										}
									/>
									<span className="dim">{t("h (0 = never)")}</span>
								</div>
								<div style={{ display: "flex", gap: 8 }}>
									<button
										className="primary"
										onClick={async () => {
											try {
												await sendWaypoint({
													id: draft.id,
													lat: draft.lat,
													lon: draft.lon,
													name: draft.name,
													description: draft.desc,
													icon: draft.icon.codePointAt(0) ?? 0,
													expire: draft.expireH
														? Math.floor(Date.now() / 1000) +
															draft.expireH * 3600
														: 0,
													lockedTo: 0,
												});
												setWpMsg(t("WAYPOINT SENT ✓"));
												setDraft(undefined);
											} catch (e) {
												setWpMsg(`ERROR: ${e}`);
											}
										}}
									>
										{t("[ SEND ]")}
									</button>
									<button onClick={() => setDraft(undefined)}>
										{t("[ CANCEL ]")}
									</button>
								</div>
							</div>
						</div>
					)}
				</div>
			</div>
		</main>
	);
}
