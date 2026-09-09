/** Rest pose: a three-quarter view so the chassis has volume before the first drag. */
export const REST_YAW = 0.58;
export const REST_PITCH = 0.36;
export const REST_ROLL = -0.05;
export const PITCH_MIN = -1.35;
export const PITCH_MAX = 1.35;
export const YAW_DRAG = 0.016;
export const PITCH_DRAG = 0.011;

export function clampPitch(pitch: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch));
}
