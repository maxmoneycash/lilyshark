/**
 * The Web Bluetooth transport for the LSK link.
 *
 * Read this first: **no Lilyshark firmware advertises the GATT service below
 * yet.** The device's analyzer link is USB CDC only — `loop()` in
 * `src/sim_main.cpp` drains `Serial`, and the `t-deck` PlatformIO environment
 * pulls in no BLE stack at all. So this file is one half of a contract, not a
 * working link: the browser half, written against the service documented in
 * `docs/lsk-ble-contract.md`, which is what the firmware must implement.
 *
 * It is shipped rather than stubbed because the contract is only real if
 * something holds it to a shape — chunking, reassembly, notify handling and
 * reconnect are all written and tested here, so the day the firmware
 * advertises the service the browser side is already correct. Until then
 * `bleLinkAvailability()` reports the honest truth and the connect sheet
 * refuses to offer a button that would always fail.
 *
 * Nothing here is the MeshCore companion BLE path (`src/mesh/radio.ts`, which
 * uses meshcore.js). That protocol is binary framing over its own service;
 * LSK is plain text over its own.
 */

import {
  chunkForMtu,
  type DeviceTransport,
  encodeLine,
  LineAssembler,
  type TransportOpenResult,
  type TransportSink,
} from './deviceTransport';

/* ── the contract ────────────────────────────────────────────────────────── */

/** Primary service the device advertises. See docs/lsk-ble-contract.md. */
export const LSK_BLE_SERVICE_UUID = '6c736b00-9c1d-4b7a-b3f2-1d0e5a7c4e10';
/** Browser → device. Write-without-response, MTU-chunked, newline-framed. */
export const LSK_BLE_RX_CHARACTERISTIC_UUID = '6c736b01-9c1d-4b7a-b3f2-1d0e5a7c4e10';
/** Device → browser. Notify, MTU-chunked, newline-framed. */
export const LSK_BLE_TX_CHARACTERISTIC_UUID = '6c736b02-9c1d-4b7a-b3f2-1d0e5a7c4e10';

/** The name prefix the firmware must advertise, so the browser picker can be
 *  filtered without the user reading UUIDs. */
export const LSK_BLE_NAME_PREFIX = 'Lilyshark';

/** Default ATT payload assumed for a write: 23-byte MTU minus the 3-byte
 *  ATT header, the floor every peripheral supports. The device may negotiate
 *  more; it must never require more. */
export const DEFAULT_BLE_CHUNK_BYTES = 20;

export type LskBleFirmwareStatus = 'absent' | 'advertised';

/**
 * Whether any released Lilyshark firmware advertises the service above.
 * Flip this to 'advertised' — in the same change that lands the firmware —
 * and the connect sheet starts offering Bluetooth. Lying here would produce
 * a button that always fails, which is worse than no button.
 */
export const LSK_BLE_FIRMWARE_STATUS: LskBleFirmwareStatus = 'absent';

export interface BleLinkAvailability {
  /** This browser exposes Web Bluetooth. */
  browserSupported: boolean;
  /** Firmware exists that speaks LSK over the service above. */
  firmwareSupported: boolean;
  /** Both, so the option can honestly be offered. */
  usable: boolean;
  /** One sentence naming the actual blocker, or why it works. */
  detail: string;
}

export function isWebBluetoothAvailable(navigatorLike: unknown = globalThis.navigator): boolean {
  return typeof navigatorLike === 'object' && navigatorLike !== null && 'bluetooth' in navigatorLike;
}

export function bleLinkAvailability(
  navigatorLike: unknown = globalThis.navigator,
  firmware: LskBleFirmwareStatus = LSK_BLE_FIRMWARE_STATUS,
): BleLinkAvailability {
  const browserSupported = isWebBluetoothAvailable(navigatorLike);
  const firmwareSupported = firmware === 'advertised';
  if (!browserSupported) {
    return {
      browserSupported,
      firmwareSupported,
      usable: false,
      detail:
        'this browser has no Web Bluetooth — use Chrome or Edge on a computer, or Chrome on Android',
    };
  }
  if (!firmwareSupported) {
    return {
      browserSupported,
      firmwareSupported,
      usable: false,
      detail:
        'the T-Deck firmware does not advertise the LSK Bluetooth service yet — the analyzer link is USB only. The browser side is written and tested against docs/lsk-ble-contract.md and turns on the day the firmware ships it.',
    };
  }
  return {
    browserSupported,
    firmwareSupported,
    usable: true,
    detail: 'Bluetooth is available and the firmware advertises the LSK service',
  };
}

/* ── the shapes of the GATT objects we touch ─────────────────────────────── */
/* Structural, not `@types/web-bluetooth`: the repo does not depend on that
 * package, and a structural type is exactly what a test needs to fake. */

export interface GattCharacteristicLike {
  readonly uuid?: string;
  readonly value?: DataView | null;
  writeValueWithoutResponse?(value: Uint8Array): Promise<void>;
  writeValue?(value: Uint8Array): Promise<void>;
  startNotifications(): Promise<unknown>;
  stopNotifications?(): Promise<unknown>;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface GattServiceLike {
  getCharacteristic(uuid: string): Promise<GattCharacteristicLike>;
}

export interface GattServerLike {
  readonly connected?: boolean;
  connect(): Promise<unknown>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<GattServiceLike>;
}

export interface BluetoothDeviceLike {
  readonly name?: string;
  readonly gatt?: GattServerLike;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface BluetoothLike {
  requestDevice(options: {
    filters?: Array<{ services?: string[]; namePrefix?: string }>;
    optionalServices?: string[];
  }): Promise<BluetoothDeviceLike>;
  getDevices?(): Promise<BluetoothDeviceLike[]>;
}

function bluetoothOf(navigatorLike: unknown): BluetoothLike | undefined {
  if (typeof navigatorLike !== 'object' || navigatorLike === null) return undefined;
  const candidate = (navigatorLike as { bluetooth?: unknown }).bluetooth;
  return typeof candidate === 'object' && candidate !== null
    ? (candidate as BluetoothLike)
    : undefined;
}

/** Open the browser's device picker, filtered to radios advertising LSK. */
export async function requestLskBleDevice(
  navigatorLike: unknown = globalThis.navigator,
): Promise<BluetoothDeviceLike> {
  const bluetooth = bluetoothOf(navigatorLike);
  if (!bluetooth) throw new Error('this browser has no Web Bluetooth');
  return bluetooth.requestDevice({
    filters: [{ services: [LSK_BLE_SERVICE_UUID] }, { namePrefix: LSK_BLE_NAME_PREFIX }],
    optionalServices: [LSK_BLE_SERVICE_UUID],
  });
}

/** Devices this origin was already granted, so a reconnect skips the picker.
 *  `getDevices()` is Chrome-only and permission-gated; an empty list is the
 *  normal answer, not a fault. */
export async function grantedLskBleDevices(
  navigatorLike: unknown = globalThis.navigator,
): Promise<BluetoothDeviceLike[]> {
  const bluetooth = bluetoothOf(navigatorLike);
  if (!bluetooth?.getDevices) return [];
  try {
    return await bluetooth.getDevices();
  } catch {
    return [];
  }
}

/* ── the transport ───────────────────────────────────────────────────────── */

function chunkBytesOf(event: Event): Uint8Array | undefined {
  const target = event.target as { value?: DataView | null } | null;
  const view = target?.value;
  if (!view) return undefined;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

export interface BleTransportOptions {
  /** Bytes per write. Defaults to the 20-byte ATT floor. */
  chunkBytes?: number;
}

/**
 * Wrap one picked device as an LSK transport. Calling open() again after
 * close() reconnects to the same device without a second picker prompt,
 * which is what makes the retry loop in deviceLink.ts behave identically to
 * the serial path.
 */
export function createBleTransport(
  device: BluetoothDeviceLike,
  options: BleTransportOptions = {},
): DeviceTransport {
  const chunkBytes = options.chunkBytes ?? DEFAULT_BLE_CHUNK_BYTES;
  const assembler = new LineAssembler();
  let server: GattServerLike | undefined;
  let rx: GattCharacteristicLike | undefined;
  let tx: GattCharacteristicLike | undefined;
  let sink: TransportSink | undefined;
  /** True between close() being asked for and the teardown finishing, so the
   *  disconnect we caused is not reported as a drop. */
  let closing = false;

  const onNotify = (event: Event): void => {
    const bytes = chunkBytesOf(event);
    if (!bytes) return;
    for (const line of assembler.push(bytes)) sink?.onLine(line);
  };

  const onDisconnected = (): void => {
    if (closing) return;
    sink?.onDrop();
  };

  async function detach(): Promise<void> {
    device.removeEventListener('gattserverdisconnected', onDisconnected);
    if (tx) {
      tx.removeEventListener('characteristicvaluechanged', onNotify);
      try {
        await tx.stopNotifications?.();
      } catch {
        /* the link is already gone */
      }
    }
    try {
      server?.disconnect();
    } catch {
      /* already gone */
    }
    server = undefined;
    rx = undefined;
    tx = undefined;
    sink = undefined;
    assembler.reset();
  }

  async function close(): Promise<void> {
    closing = true;
    try {
      await detach();
    } finally {
      closing = false;
    }
  }

  return {
    kind: 'ble',
    label: 'Bluetooth',
    async open(nextSink: TransportSink): Promise<TransportOpenResult> {
      closing = false;
      // A stale fragment from the previous connection must not be spliced
      // onto the first line of this one.
      assembler.reset();
      const gatt = device.gatt;
      if (!gatt) return 'busy';
      try {
        await gatt.connect();
        // Recorded before the service lookup so a radio that connects and
        // then turns out to speak something else is still let go of.
        server = gatt;
        const service = await gatt.getPrimaryService(LSK_BLE_SERVICE_UUID);
        const notify = await service.getCharacteristic(LSK_BLE_TX_CHARACTERISTIC_UUID);
        const write = await service.getCharacteristic(LSK_BLE_RX_CHARACTERISTIC_UUID);
        tx = notify;
        rx = write;
        sink = nextSink;
        notify.addEventListener('characteristicvaluechanged', onNotify);
        device.addEventListener('gattserverdisconnected', onDisconnected);
        await notify.startNotifications();
        return 'opened';
      } catch {
        // Wrong firmware, a radio that wandered off, or a GATT server that
        // refused: all "unavailable", none of them "wrong device".
        await close();
        return 'busy';
      }
    },
    async write(line: string): Promise<void> {
      const target = rx;
      if (!target) return;
      for (const chunk of chunkForMtu(encodeLine(line), chunkBytes)) {
        if (target.writeValueWithoutResponse) {
          await target.writeValueWithoutResponse(chunk);
        } else if (target.writeValue) {
          await target.writeValue(chunk);
        } else {
          throw new Error('LSK characteristic accepts no writes');
        }
      }
    },
    close,
  };
}
