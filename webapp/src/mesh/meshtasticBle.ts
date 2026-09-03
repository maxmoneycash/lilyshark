/**
 * lilyshark.com talking to a Lilyshark T-Deck over Web Bluetooth.
 *
 * The deck's firmware presents Meshtastic's client service, so this link
 * speaks the same conversation the official phone app does: want_config,
 * read FromRadio until the nonce echoes, then packets both ways. Everything
 * lands in the same store the MeshCore companion link fills, which is why
 * CHAT, NODES and MAP light up identically no matter which radio is on the
 * other end.
 *
 * Web Bluetooth exists in Chromium browsers only, and nowhere on iOS — that
 * is a policy wall, not a missing feature here. On an iPhone the Meshtastic
 * app is the way to reach the deck.
 */

import {
	BROADCAST,
	FROMNUM_CHARACTERISTIC,
	FROMRADIO_CHARACTERISTIC,
	MESHTASTIC_SERVICE,
	TORADIO_CHARACTERISTIC,
	encodeTextPacket,
	encodeWantConfig,
	parseFromRadio,
	type FromRadio,
} from "./meshtasticProto";
import {
	DeviceStatus,
	addLog,
	convoKey,
	getSnapshot,
	markUnread,
	mutate,
	type Message,
} from "./store";
import { t } from "./i18n";

type Characteristic = {
	readValue(): Promise<DataView>;
	writeValueWithResponse?(data: BufferSource): Promise<void>;
	writeValue(data: BufferSource): Promise<void>;
	startNotifications(): Promise<unknown>;
	addEventListener(type: string, cb: () => void): void;
};

type BleDevice = {
	name?: string;
	gatt?: {
		connected: boolean;
		connect(): Promise<{
			getPrimaryService(uuid: string): Promise<{
				getCharacteristic(uuid: string): Promise<Characteristic>;
			}>;
		}>;
		disconnect(): void;
	};
	addEventListener(type: string, cb: () => void): void;
};

let bleDevice: BleDevice | undefined;
let toRadio: Characteristic | undefined;
let fromRadio: Characteristic | undefined;
let active = false;
let deliberateDisconnect = false;
let draining = false;
let drainAgain = false;

/** Our packet id → the local Message id it carries, for the routing result. */
const pending = new Map<number, number>();

let lastLocalId = 0;
function nextLocalId(): number {
	lastLocalId = Math.max(Date.now(), lastLocalId + 1);
	return lastLocalId;
}

function randomPacketId(): number {
	const buf = new Uint32Array(1);
	crypto.getRandomValues(buf);
	// Zero is "no packet" on the wire; never send it.
	return buf[0] === 0 ? 1 : buf[0];
}

export function meshtasticBleAvailable(): boolean {
	return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

export function meshtasticBleActive(): boolean {
	return active;
}

function nowS(): number {
	return Math.floor(Date.now() / 1000);
}

function upsertNode(
	num: number,
	patch: { longName?: string; shortName?: string; snr?: number; lat?: number; lon?: number },
): void {
	mutate((s) => {
		const prior = s.nodes.get(num);
		const entry = prior ?? {
			num,
			longName: `!${num.toString(16).padStart(8, "0")}`,
			shortName: num.toString(16).slice(-4).toUpperCase(),
			lastHeard: nowS(),
		};
		if (patch.longName) entry.longName = patch.longName;
		if (patch.shortName) entry.shortName = patch.shortName;
		if (patch.snr !== undefined) entry.snr = patch.snr;
		if (patch.lat !== undefined) entry.lat = patch.lat;
		if (patch.lon !== undefined) entry.lon = patch.lon;
		entry.lastHeard = nowS();
		s.nodes = new Map(s.nodes).set(num, entry);
		if (patch.lat !== undefined) {
			s.posUpdates = new Map(s.posUpdates).set(num, Date.now());
		}
	});
}

function handle(message: FromRadio): void {
	switch (message.kind) {
		case "myInfo":
			mutate((s) => {
				s.myNodeNum = message.num;
			});
			break;
		case "metadata":
			mutate((s) => {
				s.deviceInfo = {
					firmwareVer: 0,
					buildDate: "",
					model: `Lilyshark T-Deck (${message.firmware})`,
				};
			});
			break;
		case "nodeInfo":
			upsertNode(message.num, {
				longName: message.longName || message.id,
				shortName: message.shortName,
				snr: message.snr,
				lat: message.lat,
				lon: message.lon,
			});
			break;
		case "position":
			upsertNode(message.from, { lat: message.lat, lon: message.lon });
			break;
		case "text": {
			const { myNodeNum } = getSnapshot();
			if (message.from === myNodeNum) break; // our own transmissions
			upsertNode(message.from, { snr: message.rxSnr });
			const msg: Message = {
				id: nextLocalId(),
				convo: "",
				from: message.from,
				to: message.to,
				channel: message.channel,
				text: message.text,
				ts: Date.now(),
				mine: false,
				state: "sent",
				snr: message.rxSnr,
			};
			msg.convo = convoKey(msg);
			mutate((s) => {
				s.messages = [...s.messages, msg];
			});
			markUnread(msg.convo);
			break;
		}
		case "routing": {
			const localId = pending.get(message.requestId);
			if (localId === undefined) break;
			pending.delete(message.requestId);
			mutate((s) => {
				s.messages = s.messages.map((m) =>
					m.id === localId ? { ...m, state: message.error === 0 ? "sent" : "failed" } : m,
				);
			});
			if (message.error !== 0) {
				addLog("T-Deck could not transmit (error {0})", message.error);
			}
			break;
		}
		case "configComplete":
		case "other":
			break;
	}
}

/** Read FromRadio until it answers empty. Reentrant calls coalesce, because a
 *  FromNum notification landing mid-drain must trigger one more pass, not a
 *  concurrent reader interleaving reads with itself. */
async function drain(): Promise<void> {
	if (!fromRadio) return;
	if (draining) {
		drainAgain = true;
		return;
	}
	draining = true;
	try {
		for (let guard = 0; guard < 256; ++guard) {
			const view = await fromRadio.readValue();
			if (view.byteLength === 0) {
				if (!drainAgain) break;
				drainAgain = false;
				continue;
			}
			const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
			const parsed = parseFromRadio(bytes);
			if (parsed) handle(parsed);
		}
	} finally {
		draining = false;
	}
}

function setStatus(status: DeviceStatus): void {
	mutate((s) => {
		s.status = status;
	});
}

async function writeToRadio(bytes: Uint8Array): Promise<void> {
	if (!toRadio) throw new Error("not connected");
	// Copied into a fresh buffer: TypeScript's BufferSource wants a plain
	// ArrayBuffer behind the view, and the copy is a few dozen bytes.
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	if (toRadio.writeValueWithResponse) await toRadio.writeValueWithResponse(copy);
	else await toRadio.writeValue(copy);
}

export async function connectMeshtasticBle(): Promise<void> {
	if (!meshtasticBleAvailable()) {
		throw new Error(t("Web Bluetooth is not available in this browser"));
	}
	const bluetooth = (navigator as unknown as { bluetooth: { requestDevice(o: unknown): Promise<BleDevice> } })
		.bluetooth;
	const device = await bluetooth.requestDevice({
		filters: [{ services: [MESHTASTIC_SERVICE] }],
	});
	setStatus(DeviceStatus.Connecting);
	addLog("BLE: connecting to {0}", device.name ?? "T-Deck");
	const server = await device.gatt?.connect();
	if (!server) throw new Error("no GATT server");
	const service = await server.getPrimaryService(MESHTASTIC_SERVICE);
	toRadio = await service.getCharacteristic(TORADIO_CHARACTERISTIC);
	fromRadio = await service.getCharacteristic(FROMRADIO_CHARACTERISTIC);
	const fromNum = await service.getCharacteristic(FROMNUM_CHARACTERISTIC);
	bleDevice = device;
	deliberateDisconnect = false;
	device.addEventListener("gattserverdisconnected", () => {
		const wasDeliberate = deliberateDisconnect;
		active = false;
		toRadio = undefined;
		fromRadio = undefined;
		setStatus(DeviceStatus.Disconnected);
		if (!wasDeliberate) addLog("BLE link lost");
	});

	setStatus(DeviceStatus.Configuring);
	fromNum.addEventListener("characteristicvaluechanged", () => {
		void drain();
	});
	await fromNum.startNotifications();

	active = true;
	await writeToRadio(encodeWantConfig(Date.now() & 0x7fffffff));
	await drain();
	setStatus(DeviceStatus.Configured);
	addLog("BLE: configured — {0} nodes known", getSnapshot().nodes.size);
}

export async function meshtasticBleSendText(text: string, convo: string): Promise<void> {
	const to = convo.startsWith("dm:") ? Number(convo.slice(3)) : BROADCAST;
	const channel = convo.startsWith("ch:") ? Number(convo.slice(3)) : 0;
	const packetId = randomPacketId();
	const { myNodeNum } = getSnapshot();
	const msg: Message = {
		id: nextLocalId(),
		convo,
		from: myNodeNum ?? 0,
		to,
		channel,
		text,
		ts: Date.now(),
		mine: true,
		state: "queued",
	};
	mutate((s) => {
		s.messages = [...s.messages, msg];
	});
	pending.set(packetId, msg.id);
	await writeToRadio(
		encodeTextPacket({ to, channel, packetId, text, wantAck: to !== BROADCAST }),
	);
}

/** Resend a failed message as a fresh packet that still resolves to the
 *  same chat row, so RETRY updates the message it retried. */
export async function meshtasticBleRetry(msg: {
	id: number;
	convo: string;
	text: string;
}): Promise<void> {
	const to = msg.convo.startsWith("dm:") ? Number(msg.convo.slice(3)) : BROADCAST;
	const channel = msg.convo.startsWith("ch:") ? Number(msg.convo.slice(3)) : 0;
	const packetId = randomPacketId();
	pending.set(packetId, msg.id);
	await writeToRadio(
		encodeTextPacket({ to, channel, packetId, text: msg.text, wantAck: to !== BROADCAST }),
	);
}

export function disconnectMeshtasticBle(): void {
	deliberateDisconnect = true;
	active = false;
	bleDevice?.gatt?.disconnect();
	setStatus(DeviceStatus.Disconnected);
}
