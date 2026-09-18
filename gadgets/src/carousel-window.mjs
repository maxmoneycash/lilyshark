export const CAROUSEL_SLOTS = 8;
export const wrapIndex = (index, count) => ((index % count) + count) % count;

// Keep the original eight-card scene. Recycle only the farthest slot as the
// center moves, preserving Motion's keys, progress value and spring velocity.
export function carouselWindow(items, progress = 0) {
  if (!items.length) return [];
  const center = Math.round(progress), slots = Array(CAROUSEL_SLOTS);
  for (let offset = -3; offset <= 4; offset++) {
    const logical = center + offset;
    slots[wrapIndex(logical, CAROUSEL_SLOTS)] = items[wrapIndex(logical, items.length)];
  }
  return slots;
}
