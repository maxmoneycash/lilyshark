/**
 * navigator.bluetooth for the iOS shell.
 *
 * iOS ships no Web Bluetooth — that is WebKit policy, not something the
 * webapp can code around — so this file rebuilds exactly the shapes
 * webapp/src/mesh/meshtasticBle.ts touches (requestDevice, gatt.connect,
 * getPrimaryService/getCharacteristic, and characteristic read / write /
 * notify) on top of the CoreBluetooth-backed @capacitor-community/bluetooth-le
 * plugin. The webapp bundle underneath is byte-for-byte the one lilyshark.com
 * serves; only this script, injected ahead of it by scripts/assemble-www.mjs,
 * is new.
 *
 * The facade is deliberately no wider than the webapp's own Characteristic
 * and BleDevice types. Anything more would be dead code pretending to be a
 * polyfill, and would drift from real Web Bluetooth without anyone noticing.
 */

import { BleClient } from "@capacitor-community/bluetooth-le";
import { Capacitor } from "@capacitor/core";
import { MESHTASTIC_SERVICE } from "../../webapp/src/mesh/meshtasticProto";

// ── the contract ────────────────────────────────────────────────────────────

/** Mirrors of the (unexported) shapes in webapp/src/mesh/meshtasticBle.ts.
 *  They are restated here because that module keeps them local, and the
 *  compile-time checks at the bottom of this file are how we notice if the
 *  two ever disagree. */
type WebappCharacteristic = {
	readValue(): Promise<DataView>;
	writeValueWithResponse?(data: BufferSource): Promise<void>;
	writeValue(data: BufferSource): Promise<void>;
	startNotifications(): Promise<unknown>;
	addEventListener(type: string, cb: () => void): void;
};

type WebappBleDevice = {
	name?: string;
	gatt?: {
		connected: boolean;
		connect(): Promise<{
			getPrimaryService(uuid: string): Promise<{
				getCharacteristic(uuid: string): Promise<WebappCharacteristic>;
			}>;
		}>;
		disconnect(): void;
	};
	addEventListener(type: string, cb: () => void): void;
};

type RequestDeviceFilter = { services?: string[]; name?: string; namePrefix?: string };
type RequestDeviceOptions = {
	filters?: RequestDeviceFilter[];
	optionalServices?: string[];
};

// ── plumbing ────────────────────────────────────────────────────────────────

/** BufferSource → the DataView the plugin's write() wants. The buffer cast is
 *  safe because nothing in the webapp hands us a SharedArrayBuffer view. */
function asDataView(data: BufferSource): DataView {
	if (data instanceof DataView) return data;
	if (ArrayBuffer.isView(data)) {
		return new DataView(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
	}
	return new DataView(data);
}

/** The plugin compares UUID strings verbatim on some paths, and Web Bluetooth
 *  canonicalizes to lowercase, so every UUID crossing this bridge is lowered
 *  once here rather than trusted to arrive in the right case. */
function lower(uuid: string): string {
	return String(uuid).toLowerCase();
}

class BridgedCharacteristic {
	private readonly valueChangedListeners: Array<() => void> = [];

	constructor(
		private readonly deviceId: string,
		private readonly serviceUuid: string,
		private readonly uuid: string,
	) {}

	async readValue(): Promise<DataView> {
		return BleClient.read(this.deviceId, this.serviceUuid, this.uuid);
	}

	async writeValueWithResponse(data: BufferSource): Promise<void> {
		await BleClient.write(this.deviceId, this.serviceUuid, this.uuid, asDataView(data));
	}

	/** The webapp only calls this when writeValueWithResponse is absent, but
	 *  both land on the acknowledged write regardless: a ToRadio frame dropped
	 *  silently by an unacknowledged write would look like a dead radio. */
	async writeValue(data: BufferSource): Promise<void> {
		await this.writeValueWithResponse(data);
	}

	async startNotifications(): Promise<unknown> {
		await BleClient.startNotifications(this.deviceId, this.serviceUuid, this.uuid, () => {
			// Web Bluetooth hands the new value on event.target.value, but the
			// webapp's drain loop re-reads FromRadio itself, so listeners only
			// need the nudge, not the payload.
			for (const listener of this.valueChangedListeners) listener();
		});
		return this;
	}

	addEventListener(type: string, cb: () => void): void {
		if (type === "characteristicvaluechanged") this.valueChangedListeners.push(cb);
	}
}

class BridgedDevice {
	readonly name?: string;
	readonly gatt: NonNullable<WebappBleDevice["gatt"]>;
	private readonly disconnectListeners: Array<() => void> = [];

	constructor(deviceId: string, name: string | undefined) {
		this.name = name;
		const device = this;
		this.gatt = {
			connected: false,
			async connect() {
				await BleClient.connect(deviceId, () => {
					device.gatt.connected = false;
					for (const listener of device.disconnectListeners) listener();
				});
				device.gatt.connected = true;
				return {
					async getPrimaryService(serviceUuid: string) {
						const service = lower(serviceUuid);
						return {
							async getCharacteristic(characteristicUuid: string) {
								return new BridgedCharacteristic(deviceId, service, lower(characteristicUuid));
							},
						};
					},
				};
			},
			disconnect() {
				device.gatt.connected = false;
				// Fire-and-forget because the Web Bluetooth signature is void;
				// the plugin's onDisconnect callback above reports the close.
				void BleClient.disconnect(deviceId).catch(() => {});
			},
		};
	}

	addEventListener(type: string, cb: () => void): void {
		if (type === "gattserverdisconnected") this.disconnectListeners.push(cb);
	}
}

// ── navigator.bluetooth ─────────────────────────────────────────────────────

const bridge = {
	async getAvailability(): Promise<boolean> {
		return true;
	},

	async requestDevice(options?: RequestDeviceOptions): Promise<BridgedDevice> {
		// initialize() is idempotent in the plugin, and this is the one entry
		// point every flow passes through, so initializing lazily here keeps
		// app startup free of a Bluetooth permission prompt.
		await BleClient.initialize();
		const filtered = (options?.filters ?? []).flatMap((f) => f.services ?? []).map(lower);
		// The webapp always filters on the Meshtastic service; if some future
		// caller forgets, scanning for that service is still the right default
		// on a phone — an unfiltered scan would list every BLE gadget nearby.
		const services = filtered.length > 0 ? filtered : [MESHTASTIC_SERVICE];
		const picked = await BleClient.requestDevice({
			services,
			optionalServices: options?.optionalServices?.map(lower),
		});
		return new BridgedDevice(picked.deviceId, picked.name);
	},
};

// This bundle is injected as a classic (non-module) script ahead of the app
// bundle, so it runs before any webapp code can probe navigator. The native
// check keeps it inert if someone loads www/ in an ordinary browser, where
// real Web Bluetooth (or its honest absence) must win.
if (
	typeof navigator !== "undefined" &&
	Capacitor.isNativePlatform() &&
	!("bluetooth" in navigator)
) {
	Object.defineProperty(navigator, "bluetooth", { value: bridge, configurable: true });
}

// ── compile-time proof the bridge satisfies the webapp ──────────────────────

/** Exists only so tsc rejects this file if the bridge stops being assignable
 *  to the shapes meshtasticBle.ts expects; carries no runtime behaviour. */
export function assertBridgeMatchesWebappShapes(
	device: BridgedDevice,
	characteristic: BridgedCharacteristic,
): [WebappBleDevice, WebappCharacteristic] {
	return [device, characteristic];
}
