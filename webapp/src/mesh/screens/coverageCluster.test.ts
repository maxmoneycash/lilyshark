import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clusterMapPoints } from './coverageCluster';

test('nearby points across bucket edges merge without dropping identities', () => {
  const points = [{ x: 43, y: 43, id: 1 }, { x: 45, y: 45, id: 2 }, { x: 90, y: 45, id: 3 }, { x: 86, y: 45, id: 4 }];
  const clusters = clusterMapPoints(points, point => point);
  assert.deepEqual(clusters.flatMap(cluster => cluster.items.map(point => point.id)).sort(), [1, 2, 3, 4]);
  for (const a of clusters) for (const b of clusters) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 44);
});
test('dense geographic data keeps distinct marker centers at least44px apart', () => {
  const points = Array.from({ length: 2400 }, (_, i) => ({ x: (i * 79.7) % 1400, y: (i * 47.3) % 700 }));
  const clusters = clusterMapPoints(points, point => point);
  assert.equal(clusters.reduce((sum, cluster) => sum + cluster.items.length, 0), points.length);
  for (const a of clusters) for (const b of clusters) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 44);
});
