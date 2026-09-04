import { demoNextFrame, emptyDemoCapture } from '../mesh/demo';
import type { LscapCapture } from '../lib/lscap';
import type { CaptureSlot, SlotAction, SlotState } from '../lib/captureSlots';

export const TRAFFIC_DEMO_INTERVAL_MS = 2600;

/** The live table stops growing here; old frames age out on the left. */
export const LIVE_CAP = 250;

/**
 * The simulated stream's own slot. A fixed key so stopping and restarting
 * SIM LIVE continues in one tab instead of opening a new one each time.
 */
export const SIM_LIVE_KEY = 'sim-live';
export const SIM_LIVE_NAME = 'SIM LIVE';

type IntervalHandle = ReturnType<typeof setInterval>;
type IntervalStart = (callback: () => void, delayMs: number) => IntervalHandle;
type IntervalStop = (handle: IntervalHandle) => void;

/** Start the synthetic Traffic ticker only while the app is in demo mode. */
export function startTrafficDemoInterval(
  enabled: boolean,
  canInject: () => boolean,
  inject: () => void,
  start: IntervalStart = setInterval,
  stop: IntervalStop = clearInterval,
): (() => void) | undefined {
  if (!enabled) return undefined;
  const handle = start(() => {
    if (canInject()) inject();
  }, TRAFFIC_DEMO_INTERVAL_MS);
  return () => stop(handle);
}

/** What one tick of the simulated stream needs from the component. */
export interface SimLiveSlotView {
  capture: LscapCapture;
  selected: number;
  filterText: string;
  note: string | null;
  containsSynthetic: boolean;
  /**
   * The IO graph's time brush. A brush is a range on one capture's clock, so
   * a slot opening now has none -- typed here only so the object this module
   * builds is a complete view rather than one the cast happens to accept.
   * `unknown` because this module has no business knowing what a brush is --
   * only that a new slot starts without one.
   */
  brush: unknown;
}

/**
 * One tick of the simulated live stream.
 *
 * This lives out here rather than inside the effect because the decision it
 * makes — WHICH capture the generated frame is written into — is the whole
 * risk. It used to write into whichever slot happened to be open at the first
 * tick, and since the bundled sample and any file the operator opened are both
 * "whichever slot happened to be open", pressing SIM LIVE over a 20,000-frame
 * .lscap replaced that slot's frames with the last 250 and kept the file's
 * name on the tab. Nine seconds, no warning, no undo, and the only thing that
 * had ever tested it was a person watching the screen.
 *
 * So the rule is now a function with no React in it: the stream writes ONLY to
 * a slot keyed SIM_LIVE_KEY, opening it if absent, and every other slot in the
 * state is untouchable. `simLiveTick` returns the actions to dispatch and the
 * slot id it claimed, which is exactly what a test needs to assert both halves
 * — that the stream grows, and that the operator's capture does not shrink.
 *
 * Returns the id it is now feeding (or '' if it opened a slot this tick and
 * must read the reducer's id back on the next one).
 */
export function simLiveTick<V extends SimLiveSlotView>(
  state: SlotState<V>,
  claimedId: string,
  nextSequence: number,
  dispatch: (action: SlotAction<V>) => void,
): string {
  const bySlotKey = (s: CaptureSlot<V>) => s.key === SIM_LIVE_KEY;

  if (claimedId === '') {
    // Reopening under the same key is how the reducer finds an existing slot,
    // so a stream stopped and restarted continues in its own tab.
    const existing = state.slots.find(bySlotKey);
    if (existing) return feed(existing);
    dispatch({
      type: 'open',
      key: SIM_LIVE_KEY,
      origin: 'live',
      name: SIM_LIVE_NAME,
      view: {
        capture: emptyDemoCapture(),
        selected: 0,
        filterText: '',
        note: null,
        brush: null,
        // Every frame this slot will ever hold is generated, so it is
        // synthetic from the moment it exists — not once a frame lands. An
        // empty SIM tab still says SIM.
        containsSynthetic: true,
      } as unknown as V,
    });
    // The id is the reducer's to mint; read it back on the next tick.
    return '';
  }

  const open = state.slots.find((s) => s.id === claimedId);
  // The stream's own slot was closed or evicted. Drop the claim so the next
  // tick opens a fresh one, rather than reaching into whatever is on screen.
  if (!open) return '';
  // A slot id can be recycled by the reducer after a close. Feeding a slot
  // that is no longer the sim slot is the exact failure this function exists
  // to prevent, so the key is checked every tick, not just when claiming.
  if (!bySlotKey(open)) return '';
  return feed(open);

  function feed(target: CaptureSlot<V>): string {
    const c = target.view.capture;
    const last = c.frames[c.frames.length - 1];
    const frame = demoNextFrame(
      nextSequence,
      Number(last ? last.timestampUs : 0n) + 2_400_000 + (nextSequence % 5) * 640_000,
    );
    dispatch({
      type: 'patch',
      id: target.id,
      view: {
        // Bounded, because this slot is a live stream and a page cannot hold
        // an unbounded one. Nothing an operator opened is in here.
        capture: { ...c, frames: [...c.frames.slice(-(LIVE_CAP - 1)), frame] },
        containsSynthetic: true,
      } as Partial<V>,
    });
    return target.id;
  }
}
