/**
 * Rest pose: the device stands upright and turns on its own axis, like a
 * piece on a turntable. A small tilt and bank keep it from reading as a flat
 * picture; anything more and it looks like it is falling towards the reader.
 */
export const REST_YAW = 0.58;
export const REST_PITCH = 0.1;
export const REST_ROLL = -0.02;

/**
 * How far a drag may tilt it. Free tilt let a stray diagonal swipe flip the
 * handset onto its back, where a sideways drag turns it the wrong way and it
 * feels stuck. Bounded, every drag does the obvious thing.
 */
export const PITCH_MIN = -0.42;
export const PITCH_MAX = 0.42;
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
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch));
}
