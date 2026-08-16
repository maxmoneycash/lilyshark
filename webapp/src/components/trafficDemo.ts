export const TRAFFIC_DEMO_INTERVAL_MS = 2600;

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
