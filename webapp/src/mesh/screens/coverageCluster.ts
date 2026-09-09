export interface MapCluster<T> { x: number; y: number; items: T[] }

/** Merge neighboring buckets too, so marker centers stay one touch target apart. */
export function clusterMapPoints<T>(items: T[], project: (item: T) => { x: number; y: number }, spacing = 44): MapCluster<T>[] {
  const buckets = new Map<string, MapCluster<T>>();
  for (const item of items) {
    const point = project(item);
    const key = `${Math.floor(point.x / spacing)}:${Math.floor(point.y / spacing)}`;
    const cluster = buckets.get(key);
    if (!cluster) buckets.set(key, { ...point, items: [item] });
    else {
      const size = cluster.items.length;
      cluster.x = (cluster.x * size + point.x) / (size + 1);
      cluster.y = (cluster.y * size + point.y) / (size + 1);
      cluster.items.push(item);
    }
  }
  let clusters = [...buckets.values()];
  let changed = true;
  while (changed) {
    changed = false;
    const merged: MapCluster<T>[] = [];
    const neighbors = new Map<string, MapCluster<T>[]>();
    const keyFor = (cluster: MapCluster<T>) => `${Math.floor(cluster.x / spacing)}:${Math.floor(cluster.y / spacing)}`;
    const insert = (cluster: MapCluster<T>) => {
      const key = keyFor(cluster), entries = neighbors.get(key) ?? [];
      entries.push(cluster); neighbors.set(key, entries);
    };
    for (const cluster of clusters) {
      const bx = Math.floor(cluster.x / spacing), by = Math.floor(cluster.y / spacing);
      let match: MapCluster<T> | undefined;
      for (let dx = -1; dx <= 1 && !match; dx++) for (let dy = -1; dy <= 1 && !match; dy++) {
        match = neighbors.get(`${bx + dx}:${by + dy}`)?.find(other => Math.hypot(other.x - cluster.x, other.y - cluster.y) < spacing);
      }
      if (!match) { merged.push(cluster); insert(cluster); continue; }
      const oldKey = keyFor(match);
      neighbors.set(oldKey, neighbors.get(oldKey)!.filter(other => other !== match));
      const size = match.items.length + cluster.items.length;
      match.x = (match.x * match.items.length + cluster.x * cluster.items.length) / size;
      match.y = (match.y * match.items.length + cluster.y * cluster.items.length) / size;
      match.items.push(...cluster.items); insert(match); changed = true;
    }
    clusters = merged;
  }
  return clusters;
}
