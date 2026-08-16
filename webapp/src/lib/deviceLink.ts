/**
 * The Lilyshark analyzer link: lilyshark.com talking to a T-Deck running
 * Lilyshark firmware over Web Serial.
 *
 * This is not the MeshCore companion protocol — Lilyshark is the instrument,
 * not the messenger, so its link is the instrument's: a "LSK HELLO"
 * handshake, then newline-delimited telemetry lines ("LSK T {...}") every
 * couple of seconds and a full-coordinates pointer line ("LSK P {...}")
 * whenever the device decodes a Shelby pointer off the air. Plain text, so a
 * serial monitor shows a human exactly what the browser sees.
 */

import { useSyncExternalStore } from 'react';

export interface DeviceTelemetry {
  bat: string;
  gps: string;
  profile: string;
  frames: number;
  rssiX10: number;
  snrX10: number;
  sim: boolean;
}

export interface DevicePointer {
  sizeBytes: number;
  expiresAtUnix: number;
  owner: string;
  commitment: string;
  atMs: number;
}

export interface DeviceLinkState {
  status: 'off' | 'connecting' | 'linked' | 'error';
  firmware?: string;
  error?: string;
  telemetry?: DeviceTelemetry;
  pointer?: DevicePointer;
}

let state: DeviceLinkState = { status: 'off' };
const listeners = new Set<() => void>();
let port: SerialPort | undefined;
let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
let reading = false;

function set(next: Partial<DeviceLinkState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function useDeviceLink(): DeviceLinkState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

async function send(line: string): Promise<void> {
  await writer?.write(new TextEncoder().encode(line + '\n'));
}

function handleLine(line: string): void {
  const sp = line.indexOf(' ', 4);
  if (!line.startsWith('LSK ') || sp < 0) return;
  const kind = line.slice(4, sp);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(line.slice(sp + 1)) as Record<string, unknown>;
  } catch {
    return;
  }
  if (kind === 'ID') {
    set({ status: 'linked', firmware: String(body.fw ?? ''), error: undefined });
  } else if (kind === 'T') {
    set({
      status: 'linked',
      telemetry: {
        bat: String(body.bat ?? ''),
        gps: String(body.gps ?? ''),
        profile: String(body.profile ?? ''),
        frames: Number(body.frames ?? 0),
        rssiX10: Number(body.rssi_x10 ?? 0),
        snrX10: Number(body.snr_x10 ?? 0),
        sim: body.sim === true,
      },
    });
  } else if (kind === 'P') {
    set({
      pointer: {
        sizeBytes: Number(body.size ?? 0),
        expiresAtUnix: Number(body.expires ?? 0),
        owner: String(body.owner ?? ''),
        commitment: String(body.commit ?? ''),
        atMs: Date.now(),
      },
    });
  }
}

/**
 * Open the port and run the link session. Opening the CDC port can flick the
 * ESP32-S3's USB-JTAG reset lines, which reboots the device and drops its
 * USB enumeration mid-handshake — so the signals are lowered immediately
 * after open, and a drop during connection triggers a bounded reopen against
 * the already-granted port once the device re-enumerates.
 */
async function openAndRun(attempt: number): Promise<void> {
  const granted = await navigator.serial.getPorts();
  port = granted[0];
  if (!port) {
    // First contact only: the picker needs the user's gesture.
    if (attempt > 0) throw new Error('no granted serial port');
    port = await navigator.serial.requestPort();
  }
  await port.open({ baudRate: 115200 });
  try {
    // Hold reset and boot lines released; without this the open itself can
    // restart (or worse, bootloader-trap) the device.
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch {
    /* not every platform exposes setSignals; the retry below still covers us */
  }
  writer = port.writable?.getWriter();
  reading = true;

  // The firmware may be mid-line (or mid-reboot) when we attach; repeat the
  // hello until the identity answer lands.
  const hello = setInterval(() => {
    if (state.status === 'connecting' || state.status === 'linked') {
      if (state.status === 'connecting') void send('LSK HELLO');
    } else {
      clearInterval(hello);
    }
  }, 1200);
  void send('LSK HELLO');

  const reader = port.readable?.getReader();
  if (!reader) throw new Error('port is not readable');
  const decoder = new TextDecoder();
  let pending = '';
  void (async () => {
    try {
      while (reading) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let nl = pending.indexOf('\n');
        while (nl >= 0) {
          handleLine(pending.slice(0, nl).trim());
          pending = pending.slice(nl + 1);
          nl = pending.indexOf('\n');
        }
      }
    } catch {
      /* device unplugged or rebooted mid-read */
    } finally {
      clearInterval(hello);
      try {
        reader.releaseLock();
        writer?.releaseLock();
        await port?.close();
      } catch {
        /* already gone */
      }
      if (!reading) return; // deliberate disconnect
      if (attempt < 2) {
        // Likely the open-reset: the device is rebooting and will
        // re-enumerate. Give it time, then reopen the granted port.
        set({ status: 'connecting', error: undefined });
        await new Promise((r) => setTimeout(r, 9000));
        try {
          await openAndRun(attempt + 1);
        } catch (e) {
          set({
            status: 'error',
            error: e instanceof Error ? e.message : 'reconnect failed',
          });
        }
      } else {
        set({ status: 'error', error: 'link dropped — replug the device and retry' });
      }
    }
  })();
}

export async function connectDeviceLink(): Promise<void> {
  if (!('serial' in navigator)) {
    set({ status: 'error', error: 'this browser has no Web Serial' });
    return;
  }
  try {
    set({ status: 'connecting', error: undefined });
    await openAndRun(0);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'connection failed';
    set({
      status: 'error',
      error: /Failed to open/i.test(message)
        ? 'port is busy — close other lilyshark.com tabs or serial monitors, then retry'
        : message,
    });
  }
}

export async function disconnectDeviceLink(): Promise<void> {
  reading = false;
  try {
    await send('LSK BYE');
  } catch {
    /* already gone */
  }
  try {
    writer?.releaseLock();
    await port?.close();
  } catch {
    /* already gone */
  }
  port = undefined;
  writer = undefined;
  set({ status: 'off', telemetry: undefined, pointer: undefined, firmware: undefined });
}
