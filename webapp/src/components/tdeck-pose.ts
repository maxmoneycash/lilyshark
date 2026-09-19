/** Rest pose: a three-quarter view so the chassis has volume before the first drag. */
export const REST_YAW = 0.58;
export const REST_PITCH = 0.36;
export const REST_ROLL = -0.05;
export const PITCH_MIN = -Math.PI;
export const PITCH_MAX = Math.PI;
export const YAW_DRAG = 0.016;

/**
 * Radians per second the device turns on its own: one full turn in about
 * twenty-eight seconds. Slow enough to read as a considered object rather
 * than a spinning logo, fast enough that a glance catches it moving.
 */
export const SPIN_RATE = (Math.PI * 2) / 28;

/** The next resting angle, wrapped so it never grows without bound. */
export function spinYaw(yaw: number, seconds: number, rate = SPIN_RATE): number {
  const turned = yaw + rate * seconds;
  const wrapped = turned % (Math.PI * 2);
  return wrapped < 0 ? wrapped + Math.PI * 2 : wrapped;
}
export const PITCH_DRAG = 0.011;

export function clampPitch(pitch: number): number {
  // Allow full 360 degree rotation, keep it bounded between -PI and PI
  // for mathematical simplicity, but they can spin it forever if we wrap it.
  let p = pitch % (2 * Math.PI);
  if (p > Math.PI) p -= 2 * Math.PI;
  if (p < -Math.PI) p += 2 * Math.PI;
  return p;
}
