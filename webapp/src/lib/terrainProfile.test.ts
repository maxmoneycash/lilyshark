import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTerrain, distanceMeters, samplePath, terrariumElevation, terrainSampleCount } from './terrainProfile';
import { parseDirectory } from './communityDirectory';

test('distance uses the short path across the date line', () => {
  assert.equal(distanceMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }), 0);
  assert.ok(Math.abs(distanceMeters({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 }) - 22238.99) < 1);
  const points = samplePath({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 }, 3);
  assert.equal(points.length, 3);
  assert.ok(Math.abs(Math.abs(points[1].lon) - 180) < 0.001);
  assert.throws(() => samplePath({ lat: 91, lon: 0 }, { lat: 0, lon: 0 }));
  const arc = samplePath({ lat: 60, lon: -1 }, { lat: 60, lon: 1 }, 3);
  assert.ok(arc[1].lat > 60); // great-circle path curves north of the latitude line
  assert.ok(Math.abs(distanceMeters(arc[0], arc[1]) - distanceMeters(arc[1], arc[2])) < 0.01);
  assert.throws(() => samplePath({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }));
});
test('terrain samples preserve endpoints and signed elevation', () => {
  assert.equal(terrariumElevation(128, 0, 0), 0);
  assert.equal(terrariumElevation(127, 246, 128), -9.5);
  const points = samplePath({ lat: 37.8, lon: -122.2 }, { lat: 37.9, lon: -122.1 });
  assert.equal(points.length, 65);
  assert.equal(points[0].lat, 37.8); assert.equal(points[64].lat, 37.9);
  assert.equal(terrainSampleCount(150000), 500);
  assert.equal(terrainSampleCount(2000), 50);
});
test('line of sight includes curvature and Fresnel radius and detects obstruction', () => {
  const flat = analyzeTerrain([0, 0, 0], 1000, 7, 7, 910.525);
  assert.equal(flat[0].clearance, 7);
  assert.equal(flat[0].fresnel, 0);
  assert.ok(flat[1].bulge > 0);
  assert.ok(flat[1].clearance > flat[1].fresnel * 0.6);
  const blocked = analyzeTerrain([0, 100, 0], 1000, 7, 7, 910.525);
  assert.ok(blocked[1].clearance < 0);
  assert.throws(() => analyzeTerrain([0, NaN, 0], 1000, 7, 7, 910));
  assert.throws(() => analyzeTerrain([0, 0], 0, 7, 7, 910));
  assert.throws(() => analyzeTerrain([0, 0], 1000, -1, 7, 910));
});
test('directory pins only include located repeaters/rooms and do not become coverage', () => {
  const nodes = parseDirectory([
    { type: 2, adv_lat: 37.8, adv_lon: -122.2, adv_name: '<script>name</script>', public_key: 'ab', last_advert: '2026-09-01T00:00:00Z', params: { freq: 910.525 } },
    { type: 1, adv_lat: 37.8, adv_lon: -122.2 },
    { type: 2, adv_lat: 0, adv_lon: 0 },
    { type: 2, adv_lat: 91, adv_lon: 0 },
    { type: 3, adv_lat: 37.9, adv_lon: -122.1 },
  ]);
  assert.equal(nodes.length, 2);
  assert.ok(nodes.every(n => n.directory));
  assert.equal(nodes[0].name, '<script>name</script>'); // consumers must render text, not HTML
  assert.equal(nodes[0].frequencyMHz, 910.525);
  assert.equal(nodes[1].last_heard, null);
});
