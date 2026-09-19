/**
 * Camera distance for the intro T-Deck.
 *
 * The device turns on its own, so the camera has to be placed once at a
 * distance that clears the widest moment of the whole turn. Refitting per
 * frame — which is what the scene used to do — makes the handset swell and
 * shrink as it rotates, which reads as the page jittering.
 */

export interface ScenePoint {
  x: number;
  y: number;
  z: number;
}

/** A little air around the silhouette so the chassis never touches the edge. */
export const FIT_MARGIN = 1.015;

/**
 * The smallest camera distance (along +Z, looking at the origin) that keeps
 * every point inside a perspective frustum described by its half-angle
 * tangents. `minDistance` is the framing floor: the caller's chosen subject
 * height, so a small model does not fill the canvas edge to edge.
 */
export function requiredDistance(
  points: readonly ScenePoint[],
  tanVertical: number,
  tanHorizontal: number,
  minDistance = 0,
): number {
  let distance = minDistance;
  for (const point of points) {
    distance = Math.max(
      distance,
      (Math.abs(point.x) * FIT_MARGIN) / tanHorizontal + point.z,
      (Math.abs(point.y) * FIT_MARGIN) / tanVertical + point.z,
    );
  }
  return distance;
}

/**
 * The distance that fits every sampled orientation, so one placement serves
 * the entire turn. `rotated(angle)` returns the model's corners at that
 * angle; the caller owns the rotation so the sampled maths is the same maths
 * the renderer uses.
 */
export function distanceAcrossTurn(
  rotated: (angle: number) => readonly ScenePoint[],
  samples: number,
  tanVertical: number,
  tanHorizontal: number,
  minDistance = 0,
): number {
  let distance = minDistance;
  for (let i = 0; i < samples; i += 1) {
    const angle = (i / samples) * Math.PI * 2;
    distance = Math.max(
      distance,
      requiredDistance(rotated(angle), tanVertical, tanHorizontal, minDistance),
    );
  }
  return distance;
}
