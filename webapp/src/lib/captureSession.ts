/**
 * A capture session in the browser.
 *
 * The device streams every frame it hears over the USB link, including the raw
 * payload and the RF measurements a record needs. Arming a session marks a
 * start point and keeps those records; stopping it hands back a real `.lscap`
 * — the same format the firmware writes to microSD — which the analyzer opens
 * like any other capture.
 *
 * Only frames carrying a complete record are kept. Firmware older than the
 * capture link sends a decoded summary with no payload, and a capture built
 * from those would look complete while carrying nothing the radio heard.
 */
import { useSyncExternalStore } from 'react';
import type { HeardFrame, RawFrameFields } from './deviceLink';
import { buildLscap, lscapByteLength } from './lscapWrite';

export interface CaptureSessionState {
  recording: boolean;
  /** Records kept so far, or the completed set once stopped. */
  frames: RawFrameFields[];
  startedAtMs?: number;
  stoppedAtMs?: number;
  /** Frames seen while recording that carried no payload to store. */
  skippedNoPayload: number;
  /** True when any kept frame came from the device's simulate mode. */
  containsSynthetic: boolean;
}

/** A session is bounded so a forgotten recording cannot exhaust memory. */
export const CAPTURE_FRAME_LIMIT = 5000;

const SYNTHETIC_FLAG = 1 << 2;

const empty: CaptureSessionState = {
  recording: false,
  frames: [],
  skippedNoPayload: 0,
  containsSynthetic: false,
};

let state: CaptureSessionState = empty;
const listeners = new Set<() => void>();

function set(next: Partial<CaptureSessionState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function getCaptureSession(): CaptureSessionState {
  return state;
}

export function useCaptureSession(): CaptureSessionState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

export function startCapture(nowMs = Date.now()): void {
  set({
    recording: true,
    frames: [],
    startedAtMs: nowMs,
    stoppedAtMs: undefined,
    skippedNoPayload: 0,
    containsSynthetic: false,
  });
}

export function stopCapture(nowMs = Date.now()): CaptureSessionState {
  if (state.recording) set({ recording: false, stoppedAtMs: nowMs });
  return state;
}

export function clearCapture(): void {
  state = empty;
  for (const l of listeners) l();
}

/** Called for every frame the link parses. A no-op unless recording. */
export function recordFrame(frame: HeardFrame): void {
  if (!state.recording) return;
  if (!frame.raw) {
    set({ skippedNoPayload: state.skippedNoPayload + 1 });
    return;
  }
  if (state.frames.length >= CAPTURE_FRAME_LIMIT) {
    set({ recording: false, stoppedAtMs: Date.now() });
    return;
  }
  set({
    frames: [...state.frames, frame.raw],
    containsSynthetic:
      state.containsSynthetic || (frame.raw.metadataFlags & SYNTHETIC_FLAG) !== 0,
  });
}

/** Seconds the session ran, live while recording. */
export function captureElapsedMs(s: CaptureSessionState, nowMs = Date.now()): number {
  if (s.startedAtMs === undefined) return 0;
  return (s.stoppedAtMs ?? nowMs) - s.startedAtMs;
}

export function captureByteLength(s: CaptureSessionState): number {
  return lscapByteLength(s.frames);
}

/** The session as a `.lscap` file. */
export function captureToLscap(s: CaptureSessionState): Uint8Array {
  return buildLscap(s.frames);
}

// Dev only: the store is module state inside the app bundle, so a browser
// test cannot reach it by importing the module — Vite hands the test a second
// instance. This exposes the app's own instance for driving the UI without a
// radio on the cable. Absent from production builds and inert under node.
declare global {
  interface Window {
    __lilysharkCapture?: {
      startCapture: typeof startCapture;
      stopCapture: typeof stopCapture;
      clearCapture: typeof clearCapture;
      recordFrame: typeof recordFrame;
      getCaptureSession: typeof getCaptureSession;
    };
  }
}
if (typeof window !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
  window.__lilysharkCapture = {
    startCapture,
    stopCapture,
    clearCapture,
    recordFrame,
    getCaptureSession,
  };
}

/** `lilyshark-capture-20260817-142530.lscap` */
export function captureFileName(s: CaptureSessionState): string {
  const d = new Date(s.startedAtMs ?? Date.now());
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `lilyshark-capture-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.lscap`
  );
}
