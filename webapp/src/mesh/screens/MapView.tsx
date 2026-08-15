import L from "leaflet";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import "leaflet/dist/leaflet.css";
import { DEMO_CENTER } from "../demo";
import { ago, asciiBattery, fechaHora, useHourTick } from "../fmt";
import { t, useLangTick } from "../i18n";
import { deleteWaypoint, sendWaypoint } from "../radio";
import { getSnapshot, subscribe } from "../store";
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
	// the markers are drawn with fg(): they have to be redrawn on a theme change
	const tema = useThemeTick();
	const horaFmt = useHourTick();
	const idioma = useLangTick();
	const divRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<L.Map | null>(null);
	const layerRef = useRef<L.LayerGroup | null>(null);
	const fittedRef = useRef(false);
	const focusedRef = useRef<number | undefined>(undefined);
	const [draft, setDraft] = useState<Draft>();
	const [wpMsg, setWpMsg] = useState("");
	const [filter, setFilter] = useState<"all" | "fav" | "active">("all");
	// The parent passes a fresh arrow on every render; going through a ref keeps
	// it out of the marker effect's deps without ever calling a stale one.
	const openNodeRef = useRef(onOpenNode);
	openNodeRef.current = onOpenNode;

	useEffect(() => {
		if (!divRef.current || mapRef.current) return;
		// Opens on Palo Alto, where the demo mesh lives. Real nodes override this
		// immediately via the fitBounds pass below, so this only decides what an
		// empty map looks like.
		const map = L.map(divRef.current, { zoomControl: true }).setView(
			[DEMO_CENTER.lat, DEMO_CENTER.lon],
			12,
		);
		L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
			attribution: "© OpenStreetMap",
		}).addTo(map);
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
		return () => {
			map.remove();
			mapRef.current = null;
			fittedRef.current = false;
			// the new map starts blank: whatever was centered/fitted has to happen
			// again (StrictMode remounts twice in dev, and this ref outlives the map)
			focusedRef.current = undefined;
		};
	}, []);

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
			`<span style="font-size:10px;letter-spacing:2px;opacity:.85;">${t("NODO")} // ${n.shortName}</span>` +
			`<button data-num="${n.num}" style="font-size:10px;padding:0 6px;">[ +INFO ]</button>` +
			`</div>` +
			`<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 12px;">` +
			`<span style="opacity:.85;">ID</span><span>!${n.num.toString(16)}</span>` +
			`<span style="opacity:.85;">SNR</span><span>${n.snr !== undefined ? `${n.snr.toFixed(2)} dB` : "—"}</span>` +
			`<span style="opacity:.85;">BAT</span><span>${asciiBattery(n.batteryLevel)}</span>` +
			`<span style="opacity:.85;">${t("VISTO")}</span><span title="${fechaHora(n.lastHeard * 1000)}">${t("hace {0}", ago(n.lastHeard))}</span>` +
			`</div>`;

		for (const group of byCoord.values()) {
			const hasMe = group.some((n) => n.num === s.myNodeNum);
			const color = hasMe ? accent() : fg();
			const lat = group[0].lat as number;
			const lon = group[0].lon as number;
			const label =
				group.length > 1
					? `${group[0].shortName} +${group.length - 1}`
					: group[0].shortName;
			// Popup built in the DOM (not a string) so the [+INFO] onclick can be attached
			const box = document.createElement("div");
			box.innerHTML =
				`<div style="font-size:10px;letter-spacing:2px;opacity:.85;">POS ${lat.toFixed(4)}N ${lon.toFixed(4)}E · ${group.length} ${t("NODO")}${group.length > 1 ? "S" : ""}</div>` +
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
				`<div style="font-size:10px;letter-spacing:2px;opacity:.85;">WAYPOINT · ${w.lat.toFixed(4)}N ${w.lon.toFixed(4)}E</div>` +
				`<div style="font-weight:700;margin:4px 0;">${emoji} ${w.name || t("(sin nombre)")}</div>` +
				(w.description
					? `<div style="margin-bottom:4px;">${w.description}</div>`
					: "") +
				`<div style="opacity:.85;font-size:11px;">${t("de {0}", getSnapshot().nodes.get(w.from)?.shortName ?? w.from.toString(16))}` +
				(w.expire
					? ` · ${t("caduca {0}", fechaHora(w.expire * 1000))}`
					: ` · ${t("sin caducidad")}`) +
				`</div>`;
			const row = document.createElement("div");
			row.style.cssText = "display:flex;gap:8px;margin-top:8px;";
			const edit = document.createElement("button");
			edit.textContent = t("[ EDITAR ]");
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
			del.textContent = t("[ BORRAR ]");
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

		if (!fittedRef.current && positioned.length > 0) {
			map.fitBounds(
				L.latLngBounds(
					positioned.map((n) => [n.lat as number, n.lon as number]),
				).pad(0.3),
			);
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
		tema,
		horaFmt,
		idioma,
		filter,
		focusNode,
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
	const puntos = new Set(drawn.map((n) => `${n.lat},${n.lon}`)).size;

	return (
		<main>
			<div className="panel" style={{ flex: 1 }}>
				<div className="panel-title">
					<span>
						{t("PANEL // MAPA TÁCTICO")} · {t("{0} NODOS", s.nodes.size)} ·{" "}
						{t("{0} CON FIX", withFix)}
						{junk > 0 && ` · ${t("{0} DESCARTADOS (0,0)", junk)}`}
						{s.waypoints.size > 0 && ` · ${s.waypoints.size} WAYPOINTS`}
					</span>
					<span style={{ display: "flex", gap: 6, alignItems: "center" }}>
						{(
							[
								["all", t("TODOS")],
								["fav", t("★ FAV")],
								["active", t("ACTIVOS 1H")],
							] as const
						).map(([key, label]) => (
							<button
								key={key}
								className={filter === key ? "primary" : ""}
								style={{ fontSize: 10, padding: "0 6px" }}
								onClick={() => setFilter(key)}
							>
								{label}
							</button>
						))}
						<span style={{ marginLeft: 4 }}>{t("CAPA: OSCURA")}</span>
					</span>
				</div>
				<div className="map-wrap">
					<div ref={divRef} style={{ height: "100%" }} />
					<div className="map-hud" style={{ right: 10, top: 8 }}>
						{t("{0} NODOS · {1} PUNTOS", drawn.length, puntos)} · TILES © OSM
					</div>
					<div className="map-hud" style={{ left: 10, bottom: 10 }}>
						{wpMsg || t("CLIC DERECHO = NUEVO WAYPOINT")}
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
								{draft.id ? t("EDITAR WAYPOINT") : t("NUEVO WAYPOINT")}
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
									{draft.lat.toFixed(5)}N {draft.lon.toFixed(5)}E
								</span>
								<input
									placeholder={t("nombre")}
									maxLength={30}
									value={draft.name}
									onChange={(e) => setDraft({ ...draft, name: e.target.value })}
								/>
								<input
									placeholder={t("descripción")}
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
									<span className="dim">{t("h (0 = nunca)")}</span>
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
												setWpMsg(t("WAYPOINT EMITIDO ✓"));
												setDraft(undefined);
											} catch (e) {
												setWpMsg(`ERROR: ${e}`);
											}
										}}
									>
										{t("[ EMITIR ]")}
									</button>
									<button onClick={() => setDraft(undefined)}>
										{t("[ CANCELAR ]")}
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
