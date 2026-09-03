/**
 * The SNIFFER screen's frame log.
 *
 * The device link keeps only the newest few heard frames for the header and
 * map; a sniffer wants the session. This store is fed the same parsed frames
 * the link produces (deviceLink calls recordSnifferFrame for every "LSK F"
 * line) and keeps a longer bounded ring that survives tab switches and even
 * unplugging the deck, so a session can still be inspected and exported after
 * the cable is out.
 *
 * Pause freezes the list, it does not stop the radio: frames that arrive
 * while paused are counted and reported, never silently dropped from the
 * totals.
 */
import { useSyncExternalStore } from 'react';
import type { HeardFrame } from './deviceLink';

export interface SnifferSessionState {
  paused: boolean;
  /** Newest last. Bounded by SNIFFER_FRAME_LIMIT. */
  frames: HeardFrame[];
  /** Every frame the link parsed this session, listed or not. */
  totalHeard: number;
  /** Frames that arrived while paused and are therefore not listed. */
  missedWhilePaused: number;
}

/** Rows kept. Enough for a real listening session; small enough that the
 *  table and an export stay instant. */
export const SNIFFER_FRAME_LIMIT = 500;

export function appendSnifferFrame(
  frames: HeardFrame[],
  frame: HeardFrame,
  limit = SNIFFER_FRAME_LIMIT,
): HeardFrame[] {
  const next =
    frames.length >= limit ? frames.slice(frames.length - limit + 1) : frames.slice();
  next.push(frame);
  return next;
}

const empty: SnifferSessionState = {
  paused: false,
  frames: [],
  totalHeard: 0,
  missedWhilePaused: 0,
};

let state: SnifferSessionState = empty;
const listeners = new Set<() => void>();

function set(next: Partial<SnifferSessionState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function getSnifferSession(): SnifferSessionState {
  return state;
}

export function useSnifferSession(): SnifferSessionState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

/** Called for every heard frame the link parses. */
export function recordSnifferFrame(frame: HeardFrame): void {
  if (state.paused) {
    set({
      totalHeard: state.totalHeard + 1,
      missedWhilePaused: state.missedWhilePaused + 1,
    });
    return;
  }
  set({
    totalHeard: state.totalHeard + 1,
    frames: appendSnifferFrame(state.frames, frame),
  });
}

/** Resuming clears the missed counter: those frames are gone from the list
 *  for good, and the count only means something while it explains the gap. */
export function setSnifferPaused(paused: boolean): void {
  if (paused === state.paused) return;
  set(paused ? { paused } : { paused, missedWhilePaused: 0 });
}

export function clearSnifferSession(): void {
  state = empty;
  for (const l of listeners) l();
}
