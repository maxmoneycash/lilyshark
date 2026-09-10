/** Rest pose: a three-quarter view so the chassis has volume before the first drag. */
export const REST_YAW = 0.58;
export const REST_PITCH = 0.36;
export const REST_ROLL = -0.05;
export const PITCH_MIN = -Math.PI;
export const PITCH_MAX = Math.PI;
export const YAW_DRAG = 0.016;
export const PITCH_DRAG = 0.011;

export function clampPitch(pitch: number): number {
  // Allow full 360 degree rotation, keep it bounded between -PI and PI
  // for mathematical simplicity, but they can spin it forever if we wrap it.
  let p = pitch % (2 * Math.PI);
  if (p > Math.PI) p -= 2 * Math.PI;
  if (p < -Math.PI) p += 2 * Math.PI;
  return p;
}
